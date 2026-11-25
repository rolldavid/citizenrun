import type { Db } from '@citizenrun/db';
import { sql } from 'drizzle-orm';

/** The UTC midnight that starts the one-day window holding `now` (T-rate_limits). */
export function emailCapWindowStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The per-user email cap key of one user (T-rate_limits). */
export function emailCapKey(userId: string): string {
  return `u:${userId}:email:1d`;
}

/**
 * Adds 1 to the user's email count for the UTC day of `now` and returns the new count
 * (D-246). The caller decides whether the count stops the send.
 */
export async function countUserEmail(db: Db, userId: string, now: Date): Promise<number> {
  const windowStart = emailCapWindowStart(now).toISOString();
  const rows = await db.execute<{ count: number }>(
    sql`insert into rate_limits (key, window_start, count)
        values (${emailCapKey(userId)}, ${windowStart}::timestamptz, 1)
        on conflict (key, window_start) do update set count = rate_limits.count + 1
        returning count`,
    'objects',
  );
  const count = rows[0]?.count;
  if (count === undefined) {
    throw new Error('The email cap upsert returned no row.');
  }
  return count;
}
