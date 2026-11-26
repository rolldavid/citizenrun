// Reading other stages' outputs: complete outputs only, checked against their `_meta.json`.
import type { z } from 'zod';
import { bucketKeys } from '../../lib/bucket.ts';
import { NdjsonLineError } from '../../lib/ndjson.ts';
import {
  StageFailedSchema,
  StageOutputMismatchError,
  StageOutputMissingError,
  readStageMeta,
  readStageRows,
} from '../../lib/runner.ts';
import type { RunContext, StageId } from '../../lib/runner.ts';

/** A listed stage file that is missing, differs from its `_meta.json` or holds a bad line. */
export class StageFileInvalid extends Error {
  override readonly name = 'StageFileInvalid';
  readonly lineNumber: number | null;

  constructor(stage: StageId, state: string, file: string, lineNumber: number | null) {
    super(
      lineNumber === null
        ? `the stage file ${stage}/${state}/${file} does not match its _meta.json`
        : `the stage file ${stage}/${state}/${file} has an invalid line ${String(lineNumber)}`,
    );
    this.lineNumber = lineNumber;
  }
}

/**
 * Every row of a complete output's file (`_meta.json` present and listing it), or null when the
 * state has no complete output or the file is not listed. Throws StageFileInvalid, naming the
 * stage, state, file and line number but never the content.
 */
export async function loadStageRows<T>(
  ctx: RunContext,
  stage: StageId,
  state: string,
  name: string,
  schema: z.ZodType<T>,
): Promise<readonly T[] | null> {
  const meta = await readStageMeta(ctx.bucket, stage, state);
  if (meta === null || !meta.files.some((file) => file.name === name)) {
    return null;
  }
  const rows: T[] = [];
  try {
    for await (const row of readStageRows(ctx.bucket, stage, state, name, schema)) {
      rows.push(row);
    }
  } catch (error) {
    if (error instanceof NdjsonLineError) {
      throw new StageFileInvalid(stage, state, name, error.lineNumber);
    }
    if (error instanceof StageOutputMismatchError || error instanceof StageOutputMissingError) {
      throw new StageFileInvalid(stage, state, name, null);
    }
    throw error;
  }
  return rows;
}

/** `stage-out/<stage>/`, the prefix of every state's output of the stage. */
function stagePrefix(stage: StageId): string {
  const sample = bucketKeys.stageMeta(stage, 'US');
  return sample.slice(0, sample.length - 'US/_meta.json'.length);
}

const STATE_META = /^([A-Z]{2})\/_meta\.json$/;

/** The states (and `US`) that have a `_meta.json` for the stage, sorted. */
export async function listStageStates(ctx: RunContext, stage: StageId): Promise<readonly string[]> {
  const prefix = stagePrefix(stage);
  const states: string[] = [];
  for await (const info of ctx.bucket.list(prefix)) {
    const match = STATE_META.exec(info.key.slice(prefix.length));
    if (match?.[1] !== undefined) {
      states.push(match[1]);
    }
  }
  return states.sort();
}

const FAILED_FILE = /^_failed-([A-Za-z0-9-]{1,64})\.json$/;

/** The newest `_failed-<run id>.json` of the state, by its finish time, or null. */
export async function newestFailure(
  ctx: RunContext,
  stage: StageId,
  state: string,
): Promise<{
  runId: string;
  finishedAt: string;
  failedChecks: readonly string[];
  error: string | null;
} | null> {
  const meta = bucketKeys.stageMeta(stage, state);
  const prefix = meta.slice(0, meta.length - '_meta.json'.length);
  let newest: {
    runId: string;
    finishedAt: string;
    failedChecks: readonly string[];
    error: string | null;
  } | null = null;
  for await (const info of ctx.bucket.list(prefix)) {
    const match = FAILED_FILE.exec(info.key.slice(prefix.length));
    const runId = match?.[1];
    if (runId === undefined) {
      continue;
    }
    const record = await ctx.bucket.getJson(
      bucketKeys.stageFailed(stage, state, runId),
      StageFailedSchema,
    );
    if (record === null) {
      continue;
    }
    if (
      newest === null ||
      record.finished_at > newest.finishedAt ||
      (record.finished_at === newest.finishedAt && record.run_id > newest.runId)
    ) {
      newest = {
        runId: record.run_id,
        finishedAt: record.finished_at,
        failedChecks: record.checks.filter((check) => !check.passed).map((check) => check.name),
        error: record.error,
      };
    }
  }
  return newest;
}
