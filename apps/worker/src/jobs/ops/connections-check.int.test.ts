import { captureLogs, getTestDb } from '@citizenrun/db/testing';
import { describe, expect, it } from 'vitest';
import { peekQueue, runJob } from '../../testing/job.ts';
import {
  CONNECTIONS_ALERT_AT,
  CONNECTIONS_MAX,
  countClientConnections,
  createConnectionsCheckJob,
} from './connections-check.ts';

const DAY_SECONDS = 86_400;

class FixtureFailure extends Error {
  override readonly name = 'FixtureFailure';
}

// pg-boss aligns throttle slots to the epoch; a run across the top of a slot may send once more.
function slotsSpanned(startedMs: number, endedMs: number, seconds: number): number {
  const slotMs = seconds * 1000;
  return Math.floor(endedMs / slotMs) - Math.floor(startedMs / slotMs) + 1;
}

describe('J-db.connections-check', () => {
  it('79 connections do not alert', async () => {
    const result = await runJob(
      createConnectionsCheckJob(() => Promise.resolve(79)),
      {},
    );
    expect(result.outcome).toBe('completed');
    expect(await peekQueue('ops.alert')).toEqual([]);
    expect(
      captureLogs().lines.find((line) => line.parsed.event === 'connections.check.done')?.parsed,
    ).toMatchObject({ count: 79 });
  });

  it('80 connections alert with count and max 100', async () => {
    expect([CONNECTIONS_ALERT_AT, CONNECTIONS_MAX]).toEqual([80, 100]);
    const result = await runJob(
      createConnectionsCheckJob(() => Promise.resolve(80)),
      {},
    );
    expect(result.outcome).toBe('completed');
    const alerts = await peekQueue('ops.alert');
    expect(alerts.map((alert) => alert.data)).toEqual([
      { kind: 'connections_high', values: { count: 80, max: 100 } },
    ]);
    expect(alerts[0]?.singletonKey).toBe('connections_high');
  });

  it('is idempotent', async () => {
    const job = createConnectionsCheckJob(() => Promise.resolve(80));
    const started = Date.now();
    const first = await runJob(job, {});
    const second = await runJob(job, {});
    const ended = Date.now();
    expect([first.outcome, second.outcome]).toEqual(['completed', 'completed']);
    const alerts = await peekQueue('ops.alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.length).toBeLessThanOrEqual(slotsSpanned(started, ended, DAY_SECONDS));
  });

  it('the real count includes its own session', async () => {
    const count = await countClientConnections(getTestDb());
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('a count below 1 fails the job', async () => {
    const result = await runJob(
      createConnectionsCheckJob(() => Promise.resolve(0)),
      {},
    );
    expect(result.outcome).toBe('failed');
    expect(await peekQueue('ops.alert')).toEqual([]);
    expect(
      captureLogs().lines.find((line) => line.parsed.event === 'connections.check.done'),
    ).toBeUndefined();
  });

  it('the retry path', async () => {
    const result = await runJob(
      createConnectionsCheckJob(() => Promise.reject(new FixtureFailure('counter failed'))),
      {},
    );
    expect(result.outcome).toBe('failed');
    expect(await peekQueue('ops.alert')).toEqual([]);
  });

  // Permanent path: none. The payload is empty and a failed count is always retried.
});
