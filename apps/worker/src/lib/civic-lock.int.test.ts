import { getTestDb } from '@citizenrun/db/testing';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { CIVIC_LOCK_KEY, withCivicLock } from './civic-lock.ts';

class FixtureFailure extends Error {
  override readonly name = 'FixtureFailure';
}

function isPool(value: unknown): value is Pool {
  return typeof value === 'object' && value !== null && 'totalCount' in value && 'query' in value;
}

// The node-postgres pool the test database was made over.
function testPool(): Pool {
  const db = getTestDb();
  const client: unknown = '$client' in db ? db.$client : null;
  if (!isPool(client)) {
    throw new Error('The test database has no pool.');
  }
  return client;
}

// Whether any session of this database holds the civic lock.
async function lockHeld(): Promise<boolean> {
  const result = await testPool().query<{ held: boolean }>(
    `select exists (
       select 1 from pg_locks
       where locktype = 'advisory' and objid = $1 and granted
         and database = (select oid from pg_database where datname = current_database())
     ) as held`,
    [CIVIC_LOCK_KEY],
  );
  return result.rows[0]?.held === true;
}

describe('withCivicLock', () => {
  it('a second holder is refused while the first runs', async () => {
    const db = getTestDb();
    let inner: Awaited<ReturnType<typeof withCivicLock>> | null = null;
    const outer = await withCivicLock(db, async () => {
      expect(await lockHeld()).toBe(true);
      inner = await withCivicLock(db, () => Promise.resolve('second'));
      return 'first';
    });
    expect(outer).toEqual({ ran: true, value: 'first' });
    expect(inner).toEqual({ ran: false });
    expect(await lockHeld()).toBe(false);
    // Free again: the next holder runs.
    expect(await withCivicLock(db, () => Promise.resolve(3))).toEqual({ ran: true, value: 3 });
  });

  it('the lock is released when fn throws', async () => {
    const db = getTestDb();
    await expect(
      withCivicLock(db, () => Promise.reject(new FixtureFailure('fixture'))),
    ).rejects.toBeInstanceOf(FixtureFailure);
    expect(await lockHeld()).toBe(false);
    expect(await withCivicLock(db, () => Promise.resolve('after'))).toEqual({
      ran: true,
      value: 'after',
    });
  });

  it('the client returns to the pool', async () => {
    const db = getTestDb();
    const pool = testPool();
    const nested = (): Promise<unknown> =>
      withCivicLock(db, () => withCivicLock(db, () => Promise.resolve(null)));
    // One nested run first, so the pool already holds the two clients the runs below take.
    await nested();
    const before = { total: pool.totalCount, idle: pool.idleCount };
    expect(await withCivicLock(db, () => Promise.resolve(null))).toEqual({
      ran: true,
      value: null,
    });
    await expect(
      withCivicLock(db, () => Promise.reject(new FixtureFailure('fixture'))),
    ).rejects.toBeInstanceOf(FixtureFailure);
    expect(await nested()).toEqual({ ran: true, value: { ran: false } });
    expect(pool.totalCount).toBe(before.total);
    // Every client the lock took is back and idle: none is held and none is waiting.
    expect(pool.idleCount).toBe(before.idle);
    expect(pool.idleCount).toBe(pool.totalCount);
    expect(pool.waitingCount).toBe(0);
  });
});
