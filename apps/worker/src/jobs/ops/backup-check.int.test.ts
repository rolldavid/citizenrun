import { captureLogs, getTestBucket, putTestObject, resetStorage } from '@citizenrun/db/testing';
import { createI18n } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { listAllObjects } from '../../lib/storage.ts';
import { CaptureMailer } from '../../testing/fakes/mailer.ts';
import { peekQueue, runJob, runQueued } from '../../testing/job.ts';
import { DUMP_PREFIX, backupCheckJob } from './backup-check.ts';

const APP_NAME = createI18n().services.interpolator.interpolate('{{appName}}', {}, 'en', {});
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAY_SECONDS = 86_400;

const DUMP_BYTES = new TextEncoder().encode('fixture dump');

// pg-boss aligns throttle slots to the epoch; a run across the top of a slot may send once more.
function slotsSpanned(startedMs: number, endedMs: number, seconds: number): number {
  const slotMs = seconds * 1000;
  return Math.floor(endedMs / slotMs) - Math.floor(startedMs / slotMs) + 1;
}

// Writes one object and returns the store's own LastModified for it: the clock is moved relative
// to that time, never by writing old objects.
async function putObject(key: string): Promise<Date> {
  await putTestObject('backups', key, DUMP_BYTES, 'application/octet-stream');
  for await (const object of listAllObjects(await getTestBucket('backups'), key)) {
    if (object.key === key) {
      return object.lastModified;
    }
  }
  throw new Error('the object just written is not listed');
}

async function dumpAged(ageMs: number): Promise<FakeClock> {
  const written = await putObject(`${DUMP_PREFIX}2027/03/20270305T080000Z.dump.enc`);
  return new FakeClock(new Date(written.getTime() + ageMs));
}

async function staleAlerts(): Promise<unknown[]> {
  return (await peekQueue('ops.alert')).map((alert) => alert.data);
}

describe('J-backup.check', () => {
  beforeEach(async () => {
    await getTestBucket('backups');
    await resetStorage();
  });

  it('no dump alerts with an unknown age', async () => {
    const result = await runJob(backupCheckJob, {});
    expect(result.outcome).toBe('completed');
    const alerts = await peekQueue('ops.alert');
    expect(alerts.map((alert) => alert.data)).toEqual([
      { kind: 'dump_stale', values: { hoursSinceNewest: null } },
    ]);
    expect(alerts[0]?.singletonKey).toBe('dump_stale');
    expect(
      captureLogs().lines.find((line) => line.parsed.event === 'backup.check.done')?.parsed,
    ).toMatchObject({ ageHours: null, alerted: true });
  });

  it('a dump 36 hours and 1 minute old alerts', async () => {
    const clock = await dumpAged(36 * HOUR_MS + MINUTE_MS);
    await runJob(backupCheckJob, {}, { clock });
    expect(await staleAlerts()).toEqual([{ kind: 'dump_stale', values: { hoursSinceNewest: 36 } }]);
  });

  it('a dump exactly 36 hours old does not alert', async () => {
    const clock = await dumpAged(36 * HOUR_MS);
    await runJob(backupCheckJob, {}, { clock });
    expect(await staleAlerts()).toEqual([]);
  });

  it('a dump 37 hours old alerts', async () => {
    const clock = await dumpAged(37 * HOUR_MS);
    await runJob(backupCheckJob, {}, { clock });
    expect(await staleAlerts()).toEqual([{ kind: 'dump_stale', values: { hoursSinceNewest: 37 } }]);
  });

  it('a dump 35 hours old does not alert', async () => {
    const clock = await dumpAged(35 * HOUR_MS);
    const result = await runJob(backupCheckJob, {}, { clock });
    expect(result.outcome).toBe('completed');
    expect(await staleAlerts()).toEqual([]);
    expect(
      captureLogs().lines.find((line) => line.parsed.event === 'backup.check.done')?.parsed,
    ).toMatchObject({ ageHours: 35, alerted: false });
  });

  it('a dump 2 hours old does not alert', async () => {
    const clock = await dumpAged(2 * HOUR_MS);
    await runJob(backupCheckJob, {}, { clock });
    expect(await staleAlerts()).toEqual([]);
  });

  it('the newest dump decides', async () => {
    await putObject(`${DUMP_PREFIX}2027/03/20270301T080000Z.dump.enc`);
    const clock = await dumpAged(2 * HOUR_MS);
    await runJob(backupCheckJob, {}, { clock });
    expect(await staleAlerts()).toEqual([]);
  });

  it('objects outside pg/ are ignored', async () => {
    const written = await putObject('replay/2027/03/05.json');
    await putObject('pg-old/20270305T080000Z.dump.enc');
    const clock = new FakeClock(new Date(written.getTime() + 2 * HOUR_MS));
    await runJob(backupCheckJob, {}, { clock });
    expect(await staleAlerts()).toEqual([
      { kind: 'dump_stale', values: { hoursSinceNewest: null } },
    ]);
  });

  it('is idempotent', async () => {
    const started = Date.now();
    const first = await runJob(backupCheckJob, {});
    const second = await runJob(backupCheckJob, {});
    const ended = Date.now();
    expect([first.outcome, second.outcome]).toEqual(['completed', 'completed']);
    const alerts = await peekQueue('ops.alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.length).toBeLessThanOrEqual(slotsSpanned(started, ended, DAY_SECONDS));
  });

  it('the retry path', async () => {
    const { client } = await getTestBucket('backups');
    const result = await runJob(
      backupCheckJob,
      {},
      { storage: { backups: { client, bucket: 'fixture-bucket-that-does-not-exist' } } },
    );
    expect(result.outcome).toBe('failed');
    expect(await staleAlerts()).toEqual([]);
  });

  // Permanent path: none. The payload is empty and a listing error is always retried.

  it('the alert reaches the admin', async () => {
    const clock = await dumpAged(37 * HOUR_MS);
    await runJob(backupCheckJob, {}, { clock });
    const mailer = new CaptureMailer();
    const ran = await runQueued({ queues: ['ops.alert'], mailer });
    expect(ran.map((job) => job.outcome)).toEqual(['completed']);
    expect(mailer.sent).toHaveLength(1);
    const subject = mailer.sent[0]?.subject ?? '';
    expect(subject.startsWith(`[${APP_NAME} ci]`)).toBe(true);
    expect(subject.endsWith('No recent database backup')).toBe(true);
    expect(mailer.sent[0]?.text).toContain('Age in hours: 37.');
  });
});
