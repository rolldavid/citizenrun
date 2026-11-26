import { rateLimits } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import { and, eq, sql } from 'drizzle-orm';

/** A rate-limit window: fixed, aligned to UTC (L-rate-limit-db). */
export type RateWindow = '1m' | '1h' | '1d';

const MS_PER_SECOND = 1000;
const MINUTE_MS = 60 * MS_PER_SECOND;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_MS: Readonly<Record<RateWindow, number>> = {
  '1m': MINUTE_MS,
  '1h': HOUR_MS,
  '1d': DAY_MS,
};

/** The start of the window holding `now`: floored in UTC to the minute, the hour or the day. */
export function windowStart(window: RateWindow, now: Date): Date {
  const ms = now.getTime();
  const size = WINDOW_MS[window];
  return new Date(ms - (((ms % size) + size) % size));
}

/** The end of the window holding `now`. */
export function windowEnd(window: RateWindow, now: Date): Date {
  return new Date(windowStart(window, now).getTime() + WINDOW_MS[window]);
}

/** Whole seconds from `now` to the end of its window, rounded up, at least 1 (L-rate-limit-db). */
export function retryAfterSeconds(window: RateWindow, now: Date): number {
  return Math.max(1, Math.ceil((windowEnd(window, now).getTime() - now.getTime()) / MS_PER_SECOND));
}

/** The key of a user rule: `u:<user id>:<action>:<window>` (D-240). */
export function userKey(userId: string, action: string, window: RateWindow): string {
  return `u:${userId}:${action}:${window}`;
}

/** The key of an address rule: `ip:<address hash>:<action>:<window>` (D-240). */
export function addrKey(addrHash: string, action: string, window: RateWindow): string {
  return `ip:${addrHash}:${action}:${window}`;
}

/** The per-email code-send key: `em:<keyed email hash>:code:1h` (D-400). */
export function emailCodeKey(emailHash: string): string {
  return `em:${emailHash}:code:1h`;
}

/** One upsert (D-240): adds 1 to the window's row of `key` and returns the new count. */
export async function countWindow(
  db: Db | Tx,
  key: string,
  window: RateWindow,
  now: Date,
): Promise<number> {
  const rows = await db
    .insert(rateLimits)
    .values({ key, windowStart: windowStart(window, now), count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  const [row] = rows;
  if (row === undefined) {
    throw new Error('The rate_limits upsert returned no row.');
  }
  return row.count;
}

/** Reads the window's count of `key` without changing it; 0 when there is no row. */
export async function readWindow(
  db: Db | Tx,
  key: string,
  window: RateWindow,
  now: Date,
): Promise<number> {
  // index: rate_limits_pkey
  const rows = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, windowStart(window, now))));
  return rows[0]?.count ?? 0;
}
