import { captureLogs, getTestBucket, putTestObject, resetStorage } from '@citizenrun/db/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { peekQueue, runJob } from '../../testing/job.ts';
import { costCheckJob, createCostCheckJob } from './cost-check.ts';
import { STORAGE_THRESHOLD_CENTS, storageLine } from './cost-lines.ts';
import type { CostLine } from './cost-lines.ts';

const DAY_SECONDS = 86_400;

// A line that reads nothing and reports a projection over its threshold.
const fixtureOverLine: CostLine = {
  line: 'storage',
  compute: () =>
    Promise.resolve({
      line: 'storage',
      value: 700_000_000_000,
      projected: 1_050,
      threshold: STORAGE_THRESHOLD_CENTS,
      over: true,
    }),
};

// The storage line over a bucket that does not exist, so its listing fails.
const missingBucketLine: CostLine = {
  line: 'storage',
  async compute(ctx) {
    return storageLine.compute({
      ...ctx,
      storage: {
        backups: { client: ctx.storage.backups.client, bucket: 'fixture-bucket-that-is-missing' },
        media: ctx.storage.media,
      },
    });
  },
};

// pg-boss aligns throttle slots to the epoch; a run across the top of a slot may send once more.
function slotsSpanned(startedMs: number, endedMs: number, seconds: number): number {
  const slotMs = seconds * 1000;
  return Math.floor(endedMs / slotMs) - Math.floor(startedMs / slotMs) + 1;
}

describe('J-cost.check', () => {
  beforeEach(async () => {
    await getTestBucket('backups');
    await resetStorage();
  });

  it('a small bucket raises no alert', async () => {
    const bytes = new TextEncoder().encode('fixture object');
    await putTestObject('backups', 'pg/2027/03/a.dump.enc', bytes, 'application/octet-stream');
    await putTestObject('backups', 'replay/2027/03/b.json', bytes, 'application/json');
    const result = await runJob(costCheckJob, {});
    expect(result.outcome).toBe('completed');
    expect(await peekQueue('ops.alert')).toEqual([]);
    expect(
      captureLogs().lines.find((line) => line.parsed.event === 'cost.check.done')?.parsed,
    ).toMatchObject({ lines: 1, alerts: 0 });
  });

  it('the storage line sums every object of the backups bucket', async () => {
    const bytes = new TextEncoder().encode('fixture object');
    await putTestObject('backups', 'pg/2027/03/a.dump.enc', bytes, 'application/octet-stream');
    await putTestObject('backups', 'replay/2027/03/b.json', bytes, 'application/json');
    const { ctx } = await runJob(costCheckJob, {});
    expect(await storageLine.compute(ctx)).toEqual({
      line: 'storage',
      value: 2 * bytes.length,
      projected: 1,
      threshold: 1_000,
      over: false,
    });
  });

  it('an over line raises one cost_projection alert', async () => {
    const result = await runJob(createCostCheckJob([fixtureOverLine]), {});
    expect(result.outcome).toBe('completed');
    const alerts = await peekQueue('ops.alert');
    expect(alerts.map((alert) => alert.data)).toEqual([
      {
        kind: 'cost_projection',
        values: { line: 'storage', value: 700_000_000_000, projected: 1_050, threshold: 1000 },
      },
    ]);
    expect(alerts[0]?.singletonKey).toBe('cost:storage');
    expect(
      captureLogs().lines.find((line) => line.parsed.event === 'cost.check.done')?.parsed,
    ).toMatchObject({ lines: 1, alerts: 1 });
  });

  it('is idempotent', async () => {
    const job = createCostCheckJob([fixtureOverLine]);
    const started = Date.now();
    const first = await runJob(job, {});
    const second = await runJob(job, {});
    const ended = Date.now();
    expect([first.outcome, second.outcome]).toEqual(['completed', 'completed']);
    const alerts = await peekQueue('ops.alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.length).toBeLessThanOrEqual(slotsSpanned(started, ended, DAY_SECONDS));
  });

  it('a failed bucket listing throws and sends no partial alert', async () => {
    const result = await runJob(createCostCheckJob([fixtureOverLine, missingBucketLine]), {});
    expect(result.outcome).toBe('failed');
    expect(await peekQueue('ops.alert')).toEqual([]);
  });

  // Permanent path: none. The payload is empty and a failed line is always retried.
});
