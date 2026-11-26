import { follows } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import { LIMITS, isNewAccount } from '@citizenrun/shared';
import { and, eq, gt, sql } from 'drizzle-orm';

// L-social-limits: the daily product limits counted from the real tables over the 24 hours
// before `now` (D-240, D-472). The numbers are LIMITS' (D-475).

/** The kinds of row a daily limit counts. */
export type DailyLimitKind = 'follows'; // L-social-limits; later kinds are added beside it

/** Whether one more row may be added, or the seconds until the oldest counted row leaves the window. */
export type DailyLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

// The window, in milliseconds and seconds as the clock counts them.
const SECOND_MS = 1000;
const WINDOW_MS = 24 * 60 * 60 * SECOND_MS;

type Counted = { n: number; oldest: Date | null };

const LIMIT_OF: Record<DailyLimitKind, (isNew: boolean) => number> = {
  follows: (isNew) => (isNew ? LIMITS.followsPerDay.newAccount : LIMITS.followsPerDay.established),
};

async function countFollows(tx: Db | Tx, userId: string, since: Date): Promise<Counted> {
  // index: follows_follower
  const [row] = await tx
    .select({
      n: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${follows.createdAt})`.mapWith(follows.createdAt),
    })
    .from(follows)
    .where(and(eq(follows.followerId, userId), gt(follows.createdAt, since)));
  return { n: row?.n ?? 0, oldest: row?.oldest ?? null };
}

const COUNT_OF: Record<
  DailyLimitKind,
  (tx: Db | Tx, userId: string, since: Date) => Promise<Counted>
> = {
  // Every target type counts: offices, people and users.
  follows: countFollows,
};

/** Whether the viewer may add one more row of `kind` in the 24 hours before `now`. */
export async function checkDailyLimit(
  tx: Db | Tx,
  kind: DailyLimitKind,
  viewer: { userId: string; createdAt: Date },
  now: Date,
): Promise<DailyLimitResult> {
  const limit = LIMIT_OF[kind](isNewAccount(viewer.createdAt, now));
  const counted = await COUNT_OF[kind](tx, viewer.userId, new Date(now.getTime() - WINDOW_MS));
  if (counted.n < limit || counted.oldest === null) {
    return { ok: true };
  }
  const waitMs = counted.oldest.getTime() + WINDOW_MS - now.getTime();
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / SECOND_MS)) };
}
