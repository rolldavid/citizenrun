import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { Hex64Schema, IsoInstantSchema, StateCodeSchema, newId } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { z } from 'zod';
import type { PipelineEnv } from '../env.ts';
import { bucketKeys } from './bucket.ts';
import type { DataBucket } from './bucket.ts';
import type { Fetcher } from './fetch/types.ts';
import { NdjsonGzWriter, readNdjsonGz } from './ndjson.ts';
import { repoRoot } from './paths.ts';

export type StageId =
  | 's01-base'
  | 's02-known'
  | 's02-coops'
  | 's03-templates'
  | 's04-expand'
  | 's05-deadlines'
  | 's06-crawl'
  | 's06-extract'
  | 's07-results'
  | 's07-money'
  | 's08-filings'
  | 's09-people'
  | 's11-lean'
  | 's12-forms'
  | 's10-bundle';

/** A two-letter state code, validated with StateCodeSchema; `US` is the code of the national steps. */
export type StateCode = string;

export type RunContext = {
  readonly runId: string; // PIPELINE_RUN_ID
  readonly now: Date; // fixed at run start; every stage uses it
  readonly today: string; // 'YYYY-MM-DD' in UTC of `now`
  readonly env: PipelineEnv;
  readonly log: Logger;
  readonly bucket: DataBucket;
  readonly fetcher: Fetcher;
  readonly isCi: boolean;
};

export type StageModule = {
  readonly id: StageId;
  readonly milestone: number;
  /** Check names whose failure keeps the state's last good output (run semantics 2): a name matches a check named exactly so, or named so followed by `:` (`geometry_valid` matches `geometry_valid:NC`). */
  readonly blockingChecks: readonly string[];
  /** States this stage processes when called with --state all. */
  states(ctx: RunContext): Promise<readonly StateCode[]>;
  /** Process one state (or 'US' for national steps); write stage-out files; return counts. */
  run(ctx: RunContext, state: StateCode, opts: StageOptions): Promise<StageResult>;
};

export type StageResult = {
  readonly files: readonly { name: string; rows: number; sha256: string }[];
  readonly checks: readonly { name: string; passed: boolean; detail: string }[];
  readonly datasets: Readonly<
    Record<string, { edition: string; downloaded_on: string; source_url: string }>
  >;
};

export type StageOptions = {
  readonly dryRun: boolean; // --dry-run: everything except bucket writes
  readonly out: StageOutput; // the runner's writer: parts, then final names, then _meta.json
};

export interface StageOutput {
  /** Writes <name>.ndjson.gz for the state; a stage writes every NDJSON file through it. */
  writeRows(
    name: string,
    rows:
      | AsyncIterable<Readonly<Record<string, unknown>>>
      | Iterable<Readonly<Record<string, unknown>>>,
  ): Promise<{ name: string; rows: number; sha256: string }>;
}

const FileEntrySchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9_]+$/),
  rows: z.int().min(0),
  sha256: Hex64Schema,
});

const CheckSchema = z.strictObject({
  name: z.string().min(1).max(80),
  passed: z.boolean(),
  detail: z.string().max(2000),
});

const StageIdSchema = z.enum([
  's01-base',
  's02-known',
  's02-coops',
  's03-templates',
  's04-expand',
  's05-deadlines',
  's06-crawl',
  's06-extract',
  's07-results',
  's07-money',
  's08-filings',
  's09-people',
  's11-lean',
  's12-forms',
  's10-bundle',
]);

/** `stage-out/<stage>/<ST>/_meta.json`, written last (run semantics 1). */
export const StageMetaSchema = z.strictObject({
  stage: StageIdSchema,
  state: StateCodeSchema,
  run_id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  started_at: IsoInstantSchema,
  finished_at: IsoInstantSchema,
  git_sha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable(),
  files: z.array(FileEntrySchema),
  checks: z.array(CheckSchema),
  datasets: z.record(
    z.string(),
    z.strictObject({ edition: z.string(), downloaded_on: z.string(), source_url: z.string() }),
  ),
});
export type StageMeta = z.infer<typeof StageMetaSchema>;

/** `stage-out/<stage>/<ST>/_failed-<run id>.json`, for the coverage report (run semantics 2). */
export const StageFailedSchema = z.strictObject({
  stage: StageIdSchema,
  state: StateCodeSchema,
  run_id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  started_at: IsoInstantSchema,
  finished_at: IsoInstantSchema,
  /** The class name of the error that stopped the state; null when a blocking check failed. */
  error: z.string().max(100).nullable(),
  checks: z.array(CheckSchema),
});
export type StageFailed = z.infer<typeof StageFailedSchema>;

export type StateRunSummary = {
  readonly state: string;
  readonly status: 'done' | 'failed';
  readonly durationMs: number;
  readonly files: readonly { name: string; rows: number; sha256: string }[];
  readonly failedChecks: readonly string[];
  readonly errorClass: string | null;
};

/** A command that makes no request was given a fetcher call. */
export class FetcherUnavailableError extends Error {
  override readonly name = 'FetcherUnavailableError';

  constructor() {
    super('this command makes no outside request');
  }
}

/** A stage file whose bytes differ from the sha256 its `_meta.json` lists. */
export class StageOutputMismatchError extends Error {
  override readonly name = 'StageOutputMismatchError';

  constructor(stage: StageId, state: string, file: string) {
    super(`stage output ${stage}/${state}/${file} does not match its _meta.json`);
  }
}

/** A stage output that `_meta.json` does not list, or a state with no `_meta.json`. */
export class StageOutputMissingError extends Error {
  override readonly name = 'StageOutputMissingError';

  constructor(stage: StageId, state: string, file: string) {
    super(`stage output ${stage}/${state}/${file} is not listed`);
  }
}

/** A stage wrote one file name twice, or a name that is not a file name. */
export class StageOutputNameError extends Error {
  override readonly name = 'StageOutputNameError';
}

/** The fetcher of a command that makes no outside request: both methods throw. */
export const NO_FETCHER: Fetcher = Object.freeze({
  fetch(): Promise<never> {
    return Promise.reject(new FetcherUnavailableError());
  },
  download(): Promise<never> {
    return Promise.reject(new FetcherUnavailableError());
  },
});

/** PIPELINE_RUN_ID when set (a workflow's run), else `local-` and a new id. */
export function newRunId(env: PipelineEnv): string {
  return env.PIPELINE_RUN_ID ?? `local-${newId()}`;
}

export function createRunContext(opts: {
  env: PipelineEnv;
  now: Date;
  bucket: DataBucket;
  fetcher: Fetcher;
  log: Logger;
}): RunContext {
  return Object.freeze({
    runId: newRunId(opts.env),
    now: opts.now,
    today: opts.now.toISOString().slice(0, 10),
    env: opts.env,
    log: opts.log,
    bucket: opts.bucket,
    fetcher: opts.fetcher,
    isCi: opts.env.isCi,
  });
}

const FILE_SUFFIX = '.ndjson.gz';
const NDJSON_GZ_TYPE = 'application/gzip';
const FILE_NAME = /^[a-z0-9_]+$/;

function gitSha(): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

function isBlocking(module: StageModule, check: { name: string }): boolean {
  return module.blockingChecks.some(
    (name) => check.name === name || check.name.startsWith(`${name}:`),
  );
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 100) : 'UnknownError';
}

type Written = { name: string; rows: number; sha256: string; partKey: string };

function createOutput(
  bucket: DataBucket,
  stage: StageId,
  state: string,
  runId: string,
  written: Written[],
): StageOutput {
  return {
    async writeRows(name, rows) {
      if (!FILE_NAME.test(name) || written.some((file) => file.name === name)) {
        throw new StageOutputNameError(`a stage writes each file name once: ${name}`);
      }
      const partKey = bucketKeys.stagePart(stage, state, `${name}${FILE_SUFFIX}`, runId);
      const writer = new NdjsonGzWriter();
      const upload = bucket.putStream(partKey, writer.readable, NDJSON_GZ_TYPE);
      const entry: Written = { name, rows: 0, sha256: '', partKey };
      written.push(entry);
      const fill = async () => {
        for await (const row of rows as AsyncIterable<Readonly<Record<string, unknown>>>) {
          writer.write(row);
          if (writer.needsDrain) {
            await writer.drained();
          }
        }
        return writer.end();
      };
      const [result] = await Promise.all([fill(), upload]);
      entry.rows = result.rows;
      entry.sha256 = result.sha256;
      return { name, rows: result.rows, sha256: result.sha256 };
    },
  };
}

async function deleteParts(bucket: DataBucket, written: readonly Written[]): Promise<void> {
  await bucket.delete(written.map((file) => file.partKey));
}

/**
 * Runs `module` for each state, one after another, with the run semantics of PIPE-runner: parts,
 * then final names, then `_meta.json` last; a thrown error or a failed blocking check keeps the
 * state's last good output and writes `_failed-<run id>.json`. Exit code 1 when any state failed.
 * No row content is logged.
 */
export async function runStage(
  module: StageModule,
  ctx: RunContext,
  states: readonly string[] | 'all',
  opts: { dryRun: boolean },
): Promise<{ exitCode: 0 | 1; summaries: readonly StateRunSummary[] }> {
  const list = states === 'all' ? await module.states(ctx) : states;
  const sha = gitSha();
  const summaries: StateRunSummary[] = [];
  for (const state of list) {
    StateCodeSchema.parse(state);
    const started = new Date();
    const written: Written[] = [];
    const out = createOutput(ctx.bucket, module.id, state, ctx.runId, written);
    const base = { stage: module.id, state, runId: ctx.runId };
    let result: StageResult;
    try {
      result = await module.run(ctx, state, { dryRun: opts.dryRun, out });
    } catch (error) {
      const finished = new Date();
      const durationMs = finished.getTime() - started.getTime();
      if (!opts.dryRun) {
        await deleteParts(ctx.bucket, written);
        const failed: StageFailed = {
          stage: module.id,
          state,
          run_id: ctx.runId,
          started_at: started.toISOString(),
          finished_at: finished.toISOString(),
          error: errorClass(error),
          checks: [],
        };
        await ctx.bucket.putJson(
          bucketKeys.stageFailed(module.id, state, ctx.runId),
          failed,
          StageFailedSchema,
        );
      }
      ctx.log.error('stage.failed', { ...base, durationMs, errorClass: errorClass(error) });
      summaries.push({
        state,
        status: 'failed',
        durationMs,
        files: [],
        failedChecks: [],
        errorClass: errorClass(error),
      });
      continue;
    }

    const files = written.map(({ name, rows, sha256 }) => ({ name, rows, sha256 }));
    const failedBlocking = result.checks
      .filter((check) => !check.passed && isBlocking(module, check))
      .map((check) => check.name);
    if (failedBlocking.length > 0) {
      const finished = new Date();
      const durationMs = finished.getTime() - started.getTime();
      if (!opts.dryRun) {
        await deleteParts(ctx.bucket, written);
        await ctx.bucket.putJson(
          bucketKeys.stageFailed(module.id, state, ctx.runId),
          {
            stage: module.id,
            state,
            run_id: ctx.runId,
            started_at: started.toISOString(),
            finished_at: finished.toISOString(),
            error: null,
            checks: [...result.checks],
          },
          StageFailedSchema,
        );
      }
      ctx.log.error('stage.failed', { ...base, durationMs, failedChecks: failedBlocking });
      summaries.push({
        state,
        status: 'failed',
        durationMs,
        files,
        failedChecks: failedBlocking,
        errorClass: null,
      });
      continue;
    }

    if (!opts.dryRun) {
      for (const file of written) {
        const part = await ctx.bucket.getStream(file.partKey);
        if (part === null) {
          throw new StageOutputMissingError(module.id, state, file.name);
        }
        await ctx.bucket.putStream(
          bucketKeys.stageOut(module.id, state, `${file.name}${FILE_SUFFIX}`),
          part.body,
          NDJSON_GZ_TYPE,
        );
      }
      await deleteParts(ctx.bucket, written);
    }
    const finished = new Date();
    const durationMs = finished.getTime() - started.getTime();
    if (!opts.dryRun) {
      const meta: StageMeta = {
        stage: module.id,
        state,
        run_id: ctx.runId,
        started_at: started.toISOString(),
        finished_at: finished.toISOString(),
        git_sha: sha,
        files,
        checks: [...result.checks],
        datasets: { ...result.datasets },
      };
      await ctx.bucket.putJson(bucketKeys.stageMeta(module.id, state), meta, StageMetaSchema);
    }
    const fileRows: Record<string, number> = {};
    for (const file of files) {
      fileRows[file.name] = file.rows;
    }
    ctx.log.info('stage.done', { ...base, durationMs, fileRows, dryRun: opts.dryRun });
    summaries.push({
      state,
      status: 'done',
      durationMs,
      files,
      failedChecks: [],
      errorClass: null,
    });
  }
  const exitCode = summaries.some((summary) => summary.status === 'failed') ? 1 : 0;
  return { exitCode, summaries };
}

/** A state's `_meta.json`, or null when it has none. */
export async function readStageMeta(
  bucket: DataBucket,
  stage: StageId,
  state: string,
): Promise<StageMeta | null> {
  return bucket.getJson(bucketKeys.stageMeta(stage, state), StageMetaSchema);
}

class HashingPass extends Transform {
  readonly hash = createHash('sha256');

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.hash.update(chunk);
    done(null, chunk);
  }
}

/**
 * The rows of one stage file, parsed with `schema`. The file's sha256 is checked against
 * `_meta.json` while it streams; StageOutputMismatchError at the end when it differs.
 */
export async function* readStageRows<T>(
  bucket: DataBucket,
  stage: StageId,
  state: string,
  name: string,
  schema: z.ZodType<T>,
): AsyncIterable<T> {
  const meta = await readStageMeta(bucket, stage, state);
  const entry = meta?.files.find((file) => file.name === name);
  if (entry === undefined) {
    throw new StageOutputMissingError(stage, state, name);
  }
  const found = await bucket.getStream(bucketKeys.stageOut(stage, state, `${name}${FILE_SUFFIX}`));
  if (found === null) {
    throw new StageOutputMissingError(stage, state, name);
  }
  const hasher = new HashingPass();
  found.body.on('error', (error) => {
    hasher.destroy(error);
  });
  found.body.pipe(hasher);
  // The gunzip stream ends only after every byte has passed through the hasher.
  yield* readNdjsonGz(hasher, schema);
  if (hasher.hash.digest('hex') !== entry.sha256) {
    throw new StageOutputMismatchError(stage, state, name);
  }
}

/** True when the state has `_meta.json` and every file it lists has its sha256. */
export async function verifyStageOutput(
  bucket: DataBucket,
  stage: StageId,
  state: string,
): Promise<boolean> {
  const meta = await readStageMeta(bucket, stage, state);
  if (meta === null) {
    return false;
  }
  for (const file of meta.files) {
    const found = await bucket.getStream(
      bucketKeys.stageOut(stage, state, `${file.name}${FILE_SUFFIX}`),
    );
    if (found === null) {
      return false;
    }
    const hash = createHash('sha256');
    for await (const chunk of found.body as AsyncIterable<Buffer>) {
      hash.update(chunk);
    }
    if (hash.digest('hex') !== file.sha256) {
      return false;
    }
  }
  return true;
}
