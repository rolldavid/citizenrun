import { captureLogs, getTestDb } from '@citizenrun/db/testing';
import { describe, expect, it } from 'vitest';
import { peekQueue, runJob } from '../../testing/job.ts';
import { DB_SIZE_ALERT_BYTES, createDbSizeCheckJob, pgSizeReader } from './size-check.ts';
import type { DbSizeReader } from './size-check.ts';

// TEST-db-size-check: the hourly size alarm over a fake reader, and the real reader once.

const DAY_SECONDS = 86_400;

function fakeReader(databases: number, wal: number): DbSizeReader {
  return { databases: () => Promise.resolve(databases), wal: () => Promise.resolve(wal) };
}

// pg-boss aligns throttle slots to the epoch; a run across the top of a slot may send once more.
function slotsSpanned(startedMs: number, endedMs: number, seconds: number): number {
  const slotMs = seconds * 1000;
  return Math.floor(endedMs / slotMs) - Math.floor(startedMs / slotMs) + 1;
}

function checkedLines(): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === 'db.size.checked')
    .map((line) => line.parsed);
}

describe('J-db.size-check', () => {
  it('below 15 GB sends nothing', async () => {
    const result = await runJob(createDbSizeCheckJob(fakeReader(14_999_999_999, 0)), {});
    expect(result.outcome).toBe('completed');
    expect(await peekQueue('ops.alert')).toEqual([]);
    expect(checkedLines().at(-1)).toMatchObject({
      bytes: 14_999_999_999,
      pct: 14_999_999_999 / 50_000_000_000,
    });
  });

  it('15 GB sends one alert', async () => {
    const job = createDbSizeCheckJob(fakeReader(DB_SIZE_ALERT_BYTES, 0));
    const started = Date.now();
    expect((await runJob(job, {})).outcome).toBe('completed');
    const first = await peekQueue('ops.alert');
    expect(first.map((alert) => ({ data: alert.data, key: alert.singletonKey }))).toEqual([
      { data: { kind: 'db_size_high', values: { gb: 15, pct: '30%' } }, key: 'db_size_high' },
    ]);
    expect(checkedLines().at(-1)).toMatchObject({ bytes: 15_000_000_000, pct: 0.3 });

    // A second run the same day is throttled.
    expect((await runJob(job, {})).outcome).toBe('completed');
    const spanned = slotsSpanned(started, Date.now(), DAY_SECONDS);
    expect((await peekQueue('ops.alert')).length).toBe(spanned === 1 ? 1 : 2);
  });

  it('the measure adds the WAL size', async () => {
    const result = await runJob(createDbSizeCheckJob(fakeReader(14_500_000_000, 500_000_000)), {});
    expect(result.outcome).toBe('completed');
    const alerts = await peekQueue('ops.alert');
    expect(alerts.map((alert) => alert.data)).toEqual([
      { kind: 'db_size_high', values: { gb: 15, pct: '30%' } },
    ]);
  });

  it('the values read in tenths of a gigabyte and whole percent', async () => {
    const result = await runJob(createDbSizeCheckJob(fakeReader(17_349_000_000, 0)), {});
    expect(result.outcome).toBe('completed');
    expect((await peekQueue('ops.alert')).map((alert) => alert.data)).toEqual([
      { kind: 'db_size_high', values: { gb: 17.3, pct: '35%' } },
    ]);
  });

  it('the real reader measures', async () => {
    const databases = await pgSizeReader.databases(getTestDb());
    const wal = await pgSizeReader.wal(getTestDb());
    expect(databases).toBeGreaterThan(0);
    expect(Number.isInteger(databases)).toBe(true);
    expect(wal).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(wal)).toBe(true);

    // The job with the real reader on the test database: far below the line.
    const result = await runJob(createDbSizeCheckJob(), {});
    expect(result.outcome).toBe('completed');
    expect(await peekQueue('ops.alert')).toEqual([]);
    expect(checkedLines().at(-1)?.bytes).toBeGreaterThan(0);
  });

  it('is idempotent', async () => {
    const job = createDbSizeCheckJob(fakeReader(16_000_000_000, 1_000_000));
    const started = Date.now();
    const first = await runJob(job, {});
    const second = await runJob(job, {});
    expect([first.outcome, second.outcome]).toEqual(['completed', 'completed']);
    const spanned = slotsSpanned(started, Date.now(), DAY_SECONDS);
    expect((await peekQueue('ops.alert')).length).toBe(spanned === 1 ? 1 : 2);
  });

  it('a failed read fails the job and sends nothing', async () => {
    const failing: DbSizeReader = {
      databases: () => Promise.resolve(DB_SIZE_ALERT_BYTES),
      wal: () => Promise.reject(new TypeError('fixture read failure')),
    };
    const result = await runJob(createDbSizeCheckJob(failing), {});
    expect(result.outcome).toBe('failed');
    expect(await peekQueue('ops.alert')).toEqual([]);
  });

  // Permanent path: none. The payload is empty and a failed read is always retried.
});
