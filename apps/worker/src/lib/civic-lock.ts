import type { Db } from '@citizenrun/db';
import type { JobName, JobPayload } from '@citizenrun/shared';
import type { Pool } from 'pg';
import type { JobContext } from '../context.ts';

// The civic-write lock: one session advisory lock that every job writing civic tables, or reading
// them in bulk to write derived rows, holds while it works. A busy lock re-sends the job.

/** The advisory lock key; any constant the migration runner does not use. */
export const CIVIC_LOCK_KEY = 7310004;

export type CivicLockResult<T> = { ran: true; value: T } | { ran: false };

/** Seconds a job waits before it tries the lock again. */
const BUSY_RETRY_SECONDS = 120;

function isPool(value: unknown): value is Pool {
  return (
    typeof value === 'object' &&
    value !== null &&
    'connect' in value &&
    typeof value.connect === 'function' &&
    'totalCount' in value
  );
}

// The pool behind the Drizzle database: the lock holds one of its clients for the whole run.
function poolOf(db: Db): Pool {
  const client: unknown = '$client' in db ? db.$client : null;
  if (!isPool(client)) {
    throw new TypeError('The database has no pool to hold the lock on.');
  }
  return client;
}

/** Takes one pool client, pg_try_advisory_lock(CIVIC_LOCK_KEY); when free runs fn and unlocks in finally; releases the client. */
export async function withCivicLock<T>(db: Db, fn: () => Promise<T>): Promise<CivicLockResult<T>> {
  const client = await poolOf(db).connect();
  // A client whose lock or unlock failed is destroyed on release, which ends its session and with
  // it any lock the session still holds.
  let destroy = false;
  try {
    let locked: boolean;
    try {
      const result = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock($1) as locked',
        [CIVIC_LOCK_KEY],
      );
      locked = result.rows[0]?.locked === true;
    } catch (error) {
      destroy = true;
      throw error;
    }
    if (!locked) {
      return { ran: false };
    }
    try {
      return { ran: true, value: await fn() };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [CIVIC_LOCK_KEY]).catch(() => {
        destroy = true;
      });
    }
  } finally {
    client.release(destroy);
  }
}

/** The busy path every holder uses: log civic_lock.busy at info with the job name, re-send the same payload with startAfter 120, return. */
export async function deferForCivicLock<N extends JobName>(
  ctx: JobContext,
  name: N,
  payload: JobPayload<N>,
): Promise<void> {
  ctx.log.info('civic_lock.busy', { job: name });
  // No singleton key: a key would drop the re-send while this job is still active.
  await ctx.enqueue(name, payload, { startAfter: BUSY_RETRY_SECONDS });
}
