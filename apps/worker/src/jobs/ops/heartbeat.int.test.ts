import { workerHeartbeats } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { getTestDb } from '@citizenrun/db/testing';
import { FakeClock } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { runJob } from '../../testing/job.ts';
import { opsHeartbeatJob, processStartedAt, writeHeartbeat } from './heartbeat.ts';

class FixtureFailure extends Error {
  override readonly name = 'FixtureFailure';
}

async function heartbeatRows(): Promise<(typeof workerHeartbeats.$inferSelect)[]> {
  return getTestDb().select().from(workerHeartbeats);
}

describe('J-ops.heartbeat', () => {
  it("the row exists with the clock's time", async () => {
    const clock = new FakeClock('2027-03-05T09:50:00.000Z');
    const result = await runJob(opsHeartbeatJob, {}, { clock });
    expect(result.outcome).toBe('completed');
    const rows = await heartbeatRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.worker).toBe('worker');
    expect(rows[0]?.beatAt.toISOString()).toBe('2027-03-05T09:50:00.000Z');
    expect(rows[0]?.startedAt.getTime()).toBe(processStartedAt().getTime());
  });

  it('is idempotent', async () => {
    const clock = new FakeClock('2027-03-05T09:50:00.000Z');
    await runJob(opsHeartbeatJob, {}, { clock });
    clock.advance(60_000);
    const second = await runJob(opsHeartbeatJob, {}, { clock });
    expect(second.outcome).toBe('completed');
    const rows = await heartbeatRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.beatAt.toISOString()).toBe('2027-03-05T09:51:00.000Z');
  });

  it('the version is the deployed commit or null', async () => {
    await runJob(opsHeartbeatJob, {}, { env: { RAILWAY_GIT_COMMIT_SHA: '0123abc' } });
    expect((await heartbeatRows())[0]?.version).toBe('0123abc');
    await runJob(opsHeartbeatJob, {}, { env: { RAILWAY_GIT_COMMIT_SHA: undefined } });
    expect((await heartbeatRows())[0]?.version).toBeNull();
  });

  it('the retry path', async () => {
    const real = getTestDb();
    const failing: Db = new Proxy(real, {
      get(target, property, receiver) {
        if (property === 'insert') {
          return () => {
            throw new FixtureFailure('insert refused');
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const result = await runJob(opsHeartbeatJob, {}, { db: failing });
    expect(result.outcome).toBe('failed');
    expect(result.error).toBeInstanceOf(FixtureFailure);
    expect(await heartbeatRows()).toEqual([]);
  });

  // Permanent path: none. The payload is empty and the write is one upsert, which can only be
  // retried.

  it('the boot write replaces an older beat', async () => {
    const db = getTestDb();
    await writeHeartbeat(db, {
      beatAt: new Date('2027-03-05T09:00:00.000Z'),
      startedAt: new Date('2027-03-01T00:00:00.000Z'),
      version: 'abcdef0',
    });
    await writeHeartbeat(db, {
      beatAt: new Date('2027-03-05T09:30:00.000Z'),
      startedAt: new Date('2027-03-05T09:29:00.000Z'),
      version: null,
    });
    const rows = await heartbeatRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      worker: 'worker',
      beatAt: new Date('2027-03-05T09:30:00.000Z'),
      startedAt: new Date('2027-03-05T09:29:00.000Z'),
      version: null,
    });
  });
});
