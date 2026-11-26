import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PipelineEnv } from '../env.ts';
import { captureLogger } from '../testing/capture-log.ts';
import { getTestBucket, resetStorage, testRunId } from '../testing/setup.ts';
import { bucketKeys, createDataBucket } from './bucket.ts';
import type { DataBucket } from './bucket.ts';
import { encodeNdjsonGz } from './ndjson.ts';
import {
  NO_FETCHER,
  StageFailedSchema,
  StageOutputMismatchError,
  createRunContext,
  readStageMeta,
  readStageRows,
  runStage,
  verifyStageOutput,
} from './runner.ts';
import type { RunContext, StageModule, StageResult } from './runner.ts';

const ENV: PipelineEnv = Object.freeze({
  DATA_BUCKET: 'unused',
  DATA_ENDPOINT: 'http://localhost:8333',
  DATA_REGION: 'us-east-1',
  DATA_ACCESS_KEY_ID: 'unused',
  DATA_SECRET_ACCESS_KEY: 'unused',
  S3_FORCE_PATH_STYLE: true,
  LOG_LEVEL: 'debug',
  PIPELINE_RUN_ID: null,
  FEC_API_KEY: null,
  isCi: false,
});

const RowSchema = z.strictObject({ key: z.string(), value: z.int() });
const SECRET = 'fixture-row-value-never-logged';

type Behaviour = { throwFor?: string; failCheck?: 'must_pass' | 'advisory'; value?: number };

function fixtureStage(behaviour: Behaviour): StageModule {
  return {
    id: 's01-base',
    milestone: 2,
    blockingChecks: ['must_pass'],
    states: () => Promise.resolve(['ZZ', 'YY']),
    async run(_ctx, state, opts): Promise<StageResult> {
      const rows = [
        { key: `${state}-a ${SECRET}`, value: behaviour.value ?? 1 },
        { key: `${state}-b`, value: 2 },
      ];
      const file = await opts.out.writeRows('jurisdictions', rows);
      const counts = await opts.out.writeRows(
        'coverage',
        (async function* () {
          await Promise.resolve();
          yield { key: 'units', value: 2 };
        })(),
      );
      if (behaviour.throwFor === state) {
        throw new RangeError('fixture failure');
      }
      return {
        files: [file, counts],
        checks: [
          { name: 'must_pass:ZZ', passed: behaviour.failCheck !== 'must_pass', detail: 'fixture' },
          { name: 'advisory', passed: behaviour.failCheck !== 'advisory', detail: 'fixture' },
        ],
        datasets: {
          'fixture-set': {
            edition: '2026',
            downloaded_on: '2026-11-16',
            source_url: 'https://example.test/fixture',
          },
        },
      };
    },
  };
}

async function context(): Promise<{
  ctx: RunContext;
  bucket: DataBucket;
  lines: ReturnType<typeof captureLogger>['lines'];
}> {
  const { config } = await getTestBucket('data');
  const { log, lines } = captureLogger();
  const bucket = createDataBucket(config, { dryRun: false, log });
  const ctx = createRunContext({
    env: { ...ENV, PIPELINE_RUN_ID: testRunId() },
    now: new Date('2026-11-16T12:00:00.000Z'),
    bucket,
    fetcher: NO_FETCHER,
    log,
  });
  return { ctx, bucket, lines };
}

async function keys(bucket: DataBucket): Promise<string[]> {
  const out: string[] = [];
  for await (const info of bucket.list('stage-out/')) {
    out.push(info.key);
  }
  return out.sort();
}

async function rowsOf(bucket: DataBucket, state: string) {
  const out: z.infer<typeof RowSchema>[] = [];
  for await (const row of readStageRows(bucket, 's01-base', state, 'jurisdictions', RowSchema)) {
    out.push(row);
  }
  return out;
}

beforeEach(async () => {
  await resetStorage();
});

describe('runStage', () => {
  it('success writes final files and _meta.json last', async () => {
    const { ctx, bucket } = await context();
    const result = await runStage(fixtureStage({}), ctx, 'all', { dryRun: false });
    expect(result.exitCode).toBe(0);
    const all = await keys(bucket);
    expect(all.some((key) => key.includes('.part-'))).toBe(false);
    expect(all).toEqual([
      'stage-out/s01-base/YY/_meta.json',
      'stage-out/s01-base/YY/coverage.ndjson.gz',
      'stage-out/s01-base/YY/jurisdictions.ndjson.gz',
      'stage-out/s01-base/ZZ/_meta.json',
      'stage-out/s01-base/ZZ/coverage.ndjson.gz',
      'stage-out/s01-base/ZZ/jurisdictions.ndjson.gz',
    ]);
    const meta = await readStageMeta(bucket, 's01-base', 'ZZ');
    expect(meta?.run_id).toBe(ctx.runId);
    expect(meta?.files.map((file) => [file.name, file.rows])).toEqual([
      ['jurisdictions', 2],
      ['coverage', 1],
    ]);
    expect(meta?.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true);
    expect(meta?.datasets['fixture-set']?.edition).toBe('2026');
    // _meta.json is written after the files it lists.
    const metaInfo = await bucket.head('stage-out/s01-base/ZZ/_meta.json');
    const fileInfo = await bucket.head('stage-out/s01-base/ZZ/jurisdictions.ndjson.gz');
    expect((metaInfo?.lastModified.getTime() ?? 0) >= (fileInfo?.lastModified.getTime() ?? 0)).toBe(
      true,
    );
    expect(await verifyStageOutput(bucket, 's01-base', 'ZZ')).toBe(true);
    expect((await rowsOf(bucket, 'ZZ')).map((row) => row.value)).toEqual([1, 2]);
  });

  it('a failed blocking check keeps the last good output', async () => {
    const first = await context();
    await runStage(fixtureStage({ value: 1 }), first.ctx, ['ZZ'], { dryRun: false });
    const metaBefore = await first.bucket.getBytes(bucketKeys.stageMeta('s01-base', 'ZZ'));
    const second = await context();
    const result = await runStage(
      fixtureStage({ value: 7, failCheck: 'must_pass' }),
      second.ctx,
      ['ZZ'],
      { dryRun: false },
    );
    expect(result.exitCode).toBe(1);
    expect(result.summaries[0]?.failedChecks).toEqual(['must_pass:ZZ']);
    const metaAfter = await second.bucket.getBytes(bucketKeys.stageMeta('s01-base', 'ZZ'));
    expect(Buffer.from(metaAfter ?? []).equals(Buffer.from(metaBefore ?? []))).toBe(true);
    expect((await rowsOf(second.bucket, 'ZZ')).map((row) => row.value)).toEqual([1, 2]);
    const failed = await second.bucket.getJson(
      bucketKeys.stageFailed('s01-base', 'ZZ', second.ctx.runId),
      StageFailedSchema,
    );
    expect(failed?.error).toBeNull();
    expect(failed?.checks.find((check) => check.name === 'must_pass:ZZ')?.passed).toBe(false);
    expect((await keys(second.bucket)).some((key) => key.includes('.part-'))).toBe(false);
  });

  it('a thrown error fails one state only', async () => {
    const { ctx, bucket, lines } = await context();
    const result = await runStage(fixtureStage({ throwFor: 'ZZ' }), ctx, ['ZZ', 'YY'], {
      dryRun: false,
    });
    expect(result.exitCode).toBe(1);
    expect(result.summaries.map((summary) => [summary.state, summary.status])).toEqual([
      ['ZZ', 'failed'],
      ['YY', 'done'],
    ]);
    expect(await readStageMeta(bucket, 's01-base', 'ZZ')).toBeNull();
    expect(await readStageMeta(bucket, 's01-base', 'YY')).not.toBeNull();
    const failed = await bucket.getJson(
      bucketKeys.stageFailed('s01-base', 'ZZ', ctx.runId),
      StageFailedSchema,
    );
    expect(failed?.error).toBe('RangeError');
    expect((await keys(bucket)).some((key) => key.includes('.part-'))).toBe(false);
    const failedLine = lines.find((line) => line.parsed.event === 'stage.failed');
    expect(failedLine?.parsed).toMatchObject({
      stage: 's01-base',
      state: 'ZZ',
      errorClass: 'RangeError',
    });
  });

  it('a non-blocking failed check is recorded and the output replaced', async () => {
    const first = await context();
    await runStage(fixtureStage({ value: 1 }), first.ctx, ['ZZ'], { dryRun: false });
    const second = await context();
    const result = await runStage(
      fixtureStage({ value: 5, failCheck: 'advisory' }),
      second.ctx,
      ['ZZ'],
      { dryRun: false },
    );
    expect(result.exitCode).toBe(0);
    const meta = await readStageMeta(second.bucket, 's01-base', 'ZZ');
    expect(meta?.run_id).toBe(second.ctx.runId);
    expect(meta?.checks.find((check) => check.name === 'advisory')?.passed).toBe(false);
    expect((await rowsOf(second.bucket, 'ZZ')).map((row) => row.value)).toEqual([5, 2]);
  });

  it('readStageRows rejects a changed file', async () => {
    const { ctx, bucket } = await context();
    await runStage(fixtureStage({}), ctx, ['ZZ'], { dryRun: false });
    await bucket.putBytes(
      bucketKeys.stageOut('s01-base', 'ZZ', 'jurisdictions.ndjson.gz'),
      encodeNdjsonGz([{ key: 'changed', value: 9 }]),
      'application/gzip',
    );
    await expect(rowsOf(bucket, 'ZZ')).rejects.toBeInstanceOf(StageOutputMismatchError);
    expect(await verifyStageOutput(bucket, 's01-base', 'ZZ')).toBe(false);
  });

  it('a dry run writes nothing', async () => {
    const { ctx, bucket } = await context();
    const { config } = await getTestBucket('data');
    const dry = createDataBucket(config, { dryRun: true, log: ctx.log });
    const result = await runStage(fixtureStage({}), { ...ctx, bucket: dry }, ['ZZ'], {
      dryRun: true,
    });
    expect(result.exitCode).toBe(0);
    expect(await keys(bucket)).toEqual([]);
    expect(dry.dryRunCounts().get('stage-out')?.objects).toBe(2);
  });

  it('log lines carry counts, never rows', async () => {
    const { ctx, lines } = await context();
    await runStage(fixtureStage({ throwFor: 'YY' }), ctx, 'all', { dryRun: false });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.raw).not.toContain(SECRET);
      expect(line.raw).not.toContain('ZZ-b');
    }
    const done = lines.find((line) => line.parsed.event === 'stage.done');
    expect(done?.parsed).toMatchObject({
      stage: 's01-base',
      state: 'ZZ',
      runId: ctx.runId,
      fileRows: { jurisdictions: 2, coverage: 1 },
    });
    expect(typeof done?.parsed.durationMs).toBe('number');
  });
});
