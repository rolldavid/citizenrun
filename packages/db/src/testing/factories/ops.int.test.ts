import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getTestDb } from '../worker.ts';
import { insertClientError, insertWorkerHeartbeat, makeWorkerHeartbeat } from './ops.ts';

// The embedded Unix millisecond of a version 7 uuid: its first 48 bits.
function idTime(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

describe('the ops factories', () => {
  it('insertClientError writes the documented defaults', async () => {
    const row = await insertClientError(getTestDb());
    expect(row).toMatchObject({
      name: 'TypeError',
      code: 'fixture_error',
      route: '/fixture',
      component: 'FixtureScreen',
      appVersion: '1.0.0',
      platform: 'web',
      frames: [{ file: 'fixture.ts', line: 1, column: 1 }],
      requestId: null,
    });
    const [stored] = await getTestDb().execute<{ request_id: string | null; frames: string }>(
      sql`select request_id, frames::text as frames from client_errors where id = ${row.id}`,
      'objects',
    );
    expect(stored).toEqual({
      request_id: null,
      frames: '[{"file": "fixture.ts", "line": 1, "column": 1}]',
    });
  });

  it('insertWorkerHeartbeat writes one row per worker name', async () => {
    const first = await insertWorkerHeartbeat(getTestDb());
    const second = await insertWorkerHeartbeat(getTestDb(), { worker: 'fixture-worker' });
    expect(first.worker).toBe('worker');
    expect(first.version).toBeNull();
    expect(second.worker).toBe('fixture-worker');
    const [counted] = await getTestDb().execute<{ n: number }>(
      sql`select count(*)::int as n from worker_heartbeats`,
      'objects',
    );
    expect(counted?.n).toBe(2);
  });

  it('a heartbeat beats and starts now, to the second', () => {
    const before = Math.floor(Date.now() / 1000) * 1000;
    const row = makeWorkerHeartbeat();
    expect(row.beatAt).toBeInstanceOf(Date);
    expect(row.beatAt?.getTime()).toBe(row.startedAt?.getTime());
    expect((row.beatAt?.getTime() ?? 0) % 1000).toBe(0);
    expect(row.beatAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('createdAt sets a time-ordered id', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.678Z');
    const row = await insertClientError(getTestDb(), { createdAt });
    expect(idTime(row.id)).toBe(createdAt.getTime());
    expect(row.createdAt.getTime()).toBe(createdAt.getTime());
  });
});
