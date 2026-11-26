import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bucketKeys } from '../../lib/bucket.ts';
import type { DataBucket } from '../../lib/bucket.ts';
import { encodeNdjsonGz } from '../../lib/ndjson.ts';
import { NO_FETCHER, StageFailedSchema, runStage } from '../../lib/runner.ts';
import type { RunContext, StageModule } from '../../lib/runner.ts';
import { fixtureContext } from '../../templates/__fixtures__/zz-fake-fetcher.ts';
import { getTestBucket, resetStorage, testRunId } from '../../testing/setup.ts';
import { StageFileInvalid, listStageStates, loadStageRows, newestFailure } from './stage-io.ts';

const RowSchema = z.strictObject({ key: z.string(), value: z.int() });
const SECRET = 'fixture-row-content-never-in-a-message';

function fixtureStage(rows: readonly Record<string, unknown>[]): StageModule {
  return {
    id: 's02-known',
    milestone: 2,
    blockingChecks: [],
    states: () => Promise.resolve(['ZZ']),
    async run(_ctx, _state, opts) {
      const file = await opts.out.writeRows('offices', rows);
      return { files: [file], checks: [], datasets: {} };
    },
  };
}

async function context(): Promise<{ ctx: RunContext; bucket: DataBucket }> {
  const { bucket } = await getTestBucket('data');
  return {
    ctx: fixtureContext({
      bucket,
      fetcher: NO_FETCHER,
      now: new Date('2026-11-16T12:00:00.000Z'),
      runId: testRunId(),
    }),
    bucket,
  };
}

beforeEach(async () => {
  await resetStorage();
});

describe('loadStageRows', () => {
  it('reads every row of a complete output', async () => {
    const { ctx } = await context();
    await runStage(
      fixtureStage([
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
      ]),
      ctx,
      ['ZZ'],
      { dryRun: false },
    );
    expect(await loadStageRows(ctx, 's02-known', 'ZZ', 'offices', RowSchema)).toEqual([
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
    ]);
    expect(await listStageStates(ctx, 's02-known')).toEqual(['ZZ']);
  });

  it('reads a missing _meta.json and an unlisted file as null', async () => {
    const { ctx, bucket } = await context();
    await bucket.putBytes(
      bucketKeys.stageOut('s02-known', 'ZZ', 'offices.ndjson.gz'),
      encodeNdjsonGz([{ key: 'a', value: 1 }]),
      'application/gzip',
    );
    expect(await loadStageRows(ctx, 's02-known', 'ZZ', 'offices', RowSchema)).toBeNull();
    expect(await listStageStates(ctx, 's02-known')).toEqual([]);
    await runStage(fixtureStage([{ key: 'a', value: 1 }]), ctx, ['ZZ'], { dryRun: false });
    expect(await loadStageRows(ctx, 's02-known', 'ZZ', 'people', RowSchema)).toBeNull();
  });

  it('a file whose bytes differ from its _meta.json throws StageFileInvalid', async () => {
    const { ctx, bucket } = await context();
    await runStage(fixtureStage([{ key: 'a', value: 1 }]), ctx, ['ZZ'], { dryRun: false });
    await bucket.putBytes(
      bucketKeys.stageOut('s02-known', 'ZZ', 'offices.ndjson.gz'),
      encodeNdjsonGz([{ key: 'a', value: 2 }]),
      'application/gzip',
    );
    const error: unknown = await loadStageRows(ctx, 's02-known', 'ZZ', 'offices', RowSchema).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StageFileInvalid);
    expect((error as StageFileInvalid).message).toContain('s02-known/ZZ/offices'); // checked by the line above
  });

  it('a line failing the schema throws StageFileInvalid with its line number and not the line', async () => {
    const { ctx } = await context();
    await runStage(
      fixtureStage([
        { key: 'a', value: 1 },
        { key: SECRET, value: 'x' },
      ]),
      ctx,
      ['ZZ'],
      { dryRun: false },
    );
    const error: unknown = await loadStageRows(ctx, 's02-known', 'ZZ', 'offices', RowSchema).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StageFileInvalid);
    const invalid = error as StageFileInvalid; // checked by the line above
    expect(invalid.lineNumber).toBe(2);
    expect(invalid.message).toContain('line 2');
    expect(invalid.message).not.toContain(SECRET);
  });
});

describe('newestFailure', () => {
  it('returns the later of two failure records', async () => {
    const { ctx, bucket } = await context();
    expect(await newestFailure(ctx, 's02-known', 'ZZ')).toBeNull();
    const record = (runId: string, finishedAt: string, failed: string) => ({
      stage: 's02-known' as const,
      state: 'ZZ',
      run_id: runId,
      started_at: '2026-11-01T00:00:00.000Z',
      finished_at: finishedAt,
      error: null,
      checks: [
        { name: failed, passed: false, detail: 'fixture' },
        { name: 'counts', passed: true, detail: 'fixture' },
      ],
    });
    await bucket.putJson(
      bucketKeys.stageFailed('s02-known', 'ZZ', 'run-b'),
      record('run-b', '2026-11-02T00:00:00.000Z', 'header_valid'),
      StageFailedSchema,
    );
    await bucket.putJson(
      bucketKeys.stageFailed('s02-known', 'ZZ', 'run-a'),
      record('run-a', '2026-11-03T00:00:00.000Z', 'slug_unique'),
      StageFailedSchema,
    );
    expect(await newestFailure(ctx, 's02-known', 'ZZ')).toEqual({
      runId: 'run-a',
      finishedAt: '2026-11-03T00:00:00.000Z',
      failedChecks: ['slug_unique'],
      error: null,
    });
  });
});
