import { captureLogs, createTestBoss } from '@citizenrun/db/testing';
import { newId } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { peekQueue, runJob } from '../../testing/job.ts';
import { JOB_FAILED_THROTTLE_SECONDS, opsDeadJob } from './dead.ts';

// pg-boss aligns throttle slots to the epoch; a run that crosses the top of a slot may send once
// more, so a case counts the slots its sends could fall in instead of waiting to align.
function slotsSpanned(startedMs: number, endedMs: number, seconds: number): number {
  const slotMs = seconds * 1000;
  return Math.floor(endedMs / slotMs) - Math.floor(startedMs / slotMs) + 1;
}

function lines(event: string): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === event)
    .map((line) => line.parsed);
}

describe('J-ops.dead', () => {
  it('a dead letter becomes one job_failed alert', async () => {
    const jobId = newId();
    const result = await runJob(
      opsDeadJob,
      {},
      { deadLetter: { queue: 'backup.check', jobId, errorClass: 'TypeError' } },
    );
    expect(result.outcome).toBe('completed');
    const alerts = await peekQueue('ops.alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.data).toEqual({
      kind: 'job_failed',
      values: { queue: 'backup.check', jobId, errorClass: 'TypeError' },
    });
    expect(alerts[0]?.singletonKey).toBe('job_failed:backup.check');
    expect(lines('job.dead')).toEqual([
      expect.objectContaining({
        level: 'error',
        sourceQueue: 'backup.check',
        sourceJobId: jobId,
        errorClass: 'TypeError',
      }),
    ]);
  });

  it('is idempotent', async () => {
    const deadLetter = { queue: 'backup.check', jobId: newId(), errorClass: 'TypeError' };
    const started = Date.now();
    const first = await runJob(opsDeadJob, {}, { deadLetter });
    const second = await runJob(opsDeadJob, {}, { deadLetter });
    const ended = Date.now();
    expect([first.outcome, second.outcome]).toEqual(['completed', 'completed']);
    const alerts = await peekQueue('ops.alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.length).toBeLessThanOrEqual(
      slotsSpanned(started, ended, JOB_FAILED_THROTTLE_SECONDS),
    );
  });

  it('five failures of one queue inside an hour produce one alert', async () => {
    const started = Date.now();
    for (let index = 0; index < 5; index += 1) {
      const result = await runJob(
        opsDeadJob,
        {},
        { deadLetter: { queue: 'cost.check', jobId: newId(), errorClass: 'Error' } },
      );
      expect(result.outcome).toBe('completed');
    }
    const ended = Date.now();
    const alerts = await peekQueue('ops.alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.length).toBeLessThanOrEqual(
      slotsSpanned(started, ended, JOB_FAILED_THROTTLE_SECONDS),
    );
    expect(lines('job.dead')).toHaveLength(5);
  });

  it('failures of two queues produce two alerts', async () => {
    await runJob(
      opsDeadJob,
      {},
      { deadLetter: { queue: 'backup.check', jobId: newId(), errorClass: 'Error' } },
    );
    await runJob(
      opsDeadJob,
      {},
      { deadLetter: { queue: 'cost.check', jobId: newId(), errorClass: 'Error' } },
    );
    const alerts = await peekQueue('ops.alert');
    expect(alerts.map((alert) => alert.singletonKey).sort()).toEqual([
      'job_failed:backup.check',
      'job_failed:cost.check',
    ]);
  });

  it('a dead letter without source fields still alerts', async () => {
    const jobId = newId();
    const result = await runJob(opsDeadJob, {}, { deadLetter: null, jobId });
    expect(result.outcome).toBe('completed');
    const alerts = await peekQueue('ops.alert');
    expect(alerts.map((alert) => alert.data)).toEqual([
      { kind: 'job_failed', values: { queue: 'unknown', jobId, errorClass: 'Error' } },
    ]);
    expect(alerts[0]?.singletonKey).toBe('job_failed:unknown');
  });

  it('the retry path', async () => {
    const boss = await createTestBoss();
    await boss.deleteQueue('ops.alert');
    try {
      const result = await runJob(
        opsDeadJob,
        {},
        { deadLetter: { queue: 'backup.check', jobId: newId(), errorClass: 'Error' } },
      );
      expect(result.outcome).toBe('failed');
      expect(lines('job.failed')).toEqual([
        expect.objectContaining({ level: 'warn', errorClass: 'QueueMissingError' }),
      ]);
    } finally {
      await boss.createQueue('ops.alert');
    }
    expect(await peekQueue('ops.alert')).toEqual([]);
  });

  // Permanent path: none. The payload is never parsed, and an enqueue failure is retried.

  it('a marker in the failed payload reaches no log line and no alert payload', async () => {
    const result = await runJob(
      opsDeadJob,
      { note: marker() },
      { deadLetter: { queue: 'backup.check', jobId: newId(), errorClass: 'FixtureFailure' } },
    );
    expect(result.outcome).toBe('completed');
    const alerts = await peekQueue('ops.alert');
    expect(alerts).toHaveLength(1);
    expect(JSON.stringify(alerts.map((alert) => alert.data))).not.toContain(marker());
    expect(captureLogs().lines.length).toBeGreaterThan(0);
    expect(captureLogs().lines.some((line) => line.raw.includes(marker()))).toBe(false);
  });
});
