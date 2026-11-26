import {
  captureLogs,
  getTestBucket,
  getTestDb,
  idAt,
  insertUpload,
  insertUsageCounter,
  putTestObject,
  resetStorage,
} from '@citizenrun/db/testing';
import { FakeClock } from '@citizenrun/shared/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Bucket } from '../../lib/storage.ts';
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
    ).toMatchObject({ lines: 5, alerts: 0 });
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

// Day 10 of a 30-day month; the job reads every line against this instant.
const DAY_10 = '2027-04-10T09:50:00Z';
const HOUR_MS = 60 * 60 * 1000;

type Readings = { uploadBytes: number; month: number; day: number; signin: number };

// One upload made an hour ago with `uploadBytes`, this month's email count, and yesterday's email
// and sign-in email counts.
async function writeReadings(clock: FakeClock, readings: Readings): Promise<void> {
  const createdAt = new Date(clock.now().getTime() - HOUR_MS);
  await insertUpload(getTestDb(), {
    id: idAt(createdAt),
    createdAt,
    bytes: readings.uploadBytes,
  });
  await insertUsageCounter(getTestDb(), {
    name: 'email.month',
    period: '2027-04-01',
    count: readings.month,
  });
  await insertUsageCounter(getTestDb(), {
    name: 'email.day',
    period: '2027-04-09',
    count: readings.day,
  });
  await insertUsageCounter(getTestDb(), {
    name: 'email.signin.day',
    period: '2027-04-09',
    count: readings.signin,
  });
}

// Readings each just over its line's threshold at the default quotas (3000 and 100).
const OVER: Readings = { uploadBytes: 3_333_333_334, month: 800, day: 80, signin: 1000 };
// Readings each just under.
const UNDER: Readings = { uploadBytes: 3_333_333_333, month: 799, day: 79, signin: 999 };

// The media bucket under a name no bucket can have, so its listing fails.
async function missingMediaBucket(): Promise<Bucket> {
  const media = await getTestBucket('media');
  return { client: media.client, bucket: `${media.bucket}_gone` };
}

describe('J-cost.check, upload, email and sign-in lines', () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it('alerts on each upload, email and sign-in line', async () => {
    const clock = new FakeClock(DAY_10);
    await writeReadings(clock, OVER);
    const result = await runJob(costCheckJob, {}, { clock });
    expect(result.outcome).toBe('completed');
    const alerts = await peekQueue('ops.alert');
    expect(alerts.map((alert) => ({ data: alert.data, key: alert.singletonKey }))).toEqual([
      {
        data: {
          kind: 'cost_projection',
          values: {
            line: 'upload_growth',
            value: 3_333_333_334,
            projected: 100_000_000_020,
            threshold: 100_000_000_000,
          },
        },
        key: 'cost:upload_growth',
      },
      {
        // 800 on day 10 of 30 projects 2,400, at 80% of 3,000.
        data: {
          kind: 'cost_projection',
          values: { line: 'email_month', value: 800, projected: 2400, threshold: 2400 },
        },
        key: 'cost:email_month',
      },
      {
        data: {
          kind: 'cost_projection',
          values: { line: 'email_day', value: 80, projected: 80, threshold: 80 },
        },
        key: 'cost:email_day',
      },
      {
        data: {
          kind: 'cost_projection',
          values: { line: 'signin_ceiling', value: 1000, projected: 1000, threshold: 1000 },
        },
        key: 'cost:signin_ceiling',
      },
    ]);
    expect(
      captureLogs().lines.find((line) => line.parsed.event === 'cost.check.done')?.parsed,
    ).toMatchObject({ lines: 5, alerts: 4 });
  });

  it('stays quiet under the thresholds', async () => {
    const clock = new FakeClock(DAY_10);
    await writeReadings(clock, UNDER);
    const result = await runJob(costCheckJob, {}, { clock });
    expect(result.outcome).toBe('completed');
    expect(await peekQueue('ops.alert')).toEqual([]);
  });

  it('counts only the uploads of the last 24 hours', async () => {
    const clock = new FakeClock(DAY_10);
    const createdAt = new Date(clock.now().getTime() - 25 * HOUR_MS);
    await insertUpload(getTestDb(), { id: idAt(createdAt), createdAt, bytes: 10_000_000_000 });
    const result = await runJob(costCheckJob, {}, { clock });
    expect(result.outcome).toBe('completed');
    expect(await peekQueue('ops.alert')).toEqual([]);
  });

  it('turns the daily email line off at quota 0', async () => {
    const clock = new FakeClock(DAY_10);
    await writeReadings(clock, { ...UNDER, day: 500 });
    const result = await runJob(costCheckJob, {}, { clock, env: { EMAIL_DAILY_QUOTA: 0 } });
    expect(result.outcome).toBe('completed');
    expect(await peekQueue('ops.alert')).toEqual([]);

    // The same count alerts at the default quota.
    const counted = await runJob(costCheckJob, {}, { clock });
    expect(counted.outcome).toBe('completed');
    expect((await peekQueue('ops.alert')).map((alert) => alert.singletonKey)).toEqual([
      'cost:email_day',
    ]);
  });

  it('reads the quotas from the environment', async () => {
    const clock = new FakeClock(DAY_10);
    await writeReadings(clock, UNDER);
    // 79 a day is 80% of a quota of 98.75; 799 projects 2,397, 80% of 2,996.25.
    const result = await runJob(
      costCheckJob,
      {},
      {
        clock,
        env: { EMAIL_MONTHLY_QUOTA: 2_996, EMAIL_DAILY_QUOTA: 98 },
      },
    );
    expect(result.outcome).toBe('completed');
    expect((await peekQueue('ops.alert')).map((alert) => alert.singletonKey)).toEqual([
      'cost:email_month',
      'cost:email_day',
    ]);
  });

  it('counts the media bucket in storage', async () => {
    const bytes = new TextEncoder().encode('fixture object');
    await putTestObject('backups', 'pg/2027/04/a.dump.enc', bytes, 'application/octet-stream');
    const { ctx } = await runJob(costCheckJob, {});
    const backupsOnly = await storageLine.compute(ctx);
    expect(backupsOnly.value).toBe(bytes.length);

    await putTestObject('media', 'avatars/fixture/a/small.webp', bytes, 'image/webp');
    await putTestObject('media', 'exports/fixture/b.json', bytes, 'application/json');
    const withMedia = await storageLine.compute(ctx);
    expect(withMedia).toEqual({
      line: 'storage',
      value: 3 * bytes.length,
      projected: 1,
      threshold: 1_000,
      over: false,
    });
  });

  it('sends no partial alert when a listing fails', async () => {
    const clock = new FakeClock(DAY_10);
    await writeReadings(clock, OVER);
    const result = await runJob(costCheckJob, {}, { clock, media: await missingMediaBucket() });
    expect(result.outcome).toBe('failed');
    expect(await peekQueue('ops.alert')).toEqual([]);
  });
});
