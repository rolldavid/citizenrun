import { sessions } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import {
  SESSIONS_PER_USER_MAX,
  SESSION_ABSOLUTE_MAX_MS,
  SESSION_EXTEND_STEP_MS,
  SESSION_LAST_SEEN_STEP_MS,
  SESSION_TTL_MS,
  newId,
} from '@citizenrun/shared';
import { randomToken, sha256Hex } from '@citizenrun/shared/crypto';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { Platform } from '../../middleware/session.ts';

/** A session made by a sign-in: the raw token is returned once and never stored (L-session). */
export type NewSession = {
  sessionId: string;
  token: string;
  expiresAt: Date;
  authenticatedAt: Date;
};

function addMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

/**
 * Create (L-session): inserts the row and keeps the user's newest `SESSIONS_PER_USER_MAX` sessions
 * by `last_seen_at`, deleting the rest in the same transaction (D-461).
 */
export async function createSession(
  tx: Tx,
  input: { userId: string; platform: Platform; now: Date },
): Promise<NewSession> {
  const token = randomToken();
  const sessionId = newId();
  const expiresAt = addMs(input.now, SESSION_TTL_MS);
  await tx.insert(sessions).values({
    id: sessionId,
    userId: input.userId,
    tokenHash: sha256Hex(token),
    platform: input.platform,
    authenticatedAt: input.now,
    lastSeenAt: input.now,
    expiresAt,
    createdAt: input.now,
  });
  // index: sessions_user
  const kept = tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, input.userId))
    .orderBy(sql`${sessions.lastSeenAt} desc nulls last`, desc(sessions.id))
    .limit(SESSIONS_PER_USER_MAX);
  await tx
    .delete(sessions)
    .where(and(eq(sessions.userId, input.userId), notInArray(sessions.id, kept)));
  return { sessionId, token, expiresAt, authenticatedAt: input.now };
}

/** Replace and End one (L-session): deletes one session row; true when a row was deleted. */
export async function deleteSession(tx: Tx | Db, sessionId: string): Promise<boolean> {
  const deleted = await tx
    .delete(sessions)
    .where(eq(sessions.id, sessionId))
    .returning({ id: sessions.id });
  return deleted.length > 0;
}

/** End all (L-session): deletes every session of the user; returns how many. */
export async function deleteAllSessions(tx: Tx | Db, userId: string): Promise<number> {
  // index: sessions_user
  const deleted = await tx
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  return deleted.length;
}

/**
 * Extend (L-session-middleware): the new `expiresAt`, at most once a day and never
 * past the one-year end, and the new `lastSeenAt`, at most once an hour; null for a column that
 * stays.
 */
export function sessionExtension(input: {
  expiresAt: Date;
  sessionCreatedAt: Date;
  lastSeenAt: Date | null;
  now: Date;
}): { expiresAt: Date | null; lastSeenAt: Date | null } {
  const nowMs = input.now.getTime();
  let expiresAt: Date | null = null;
  if (input.expiresAt.getTime() - nowMs < SESSION_TTL_MS - SESSION_EXTEND_STEP_MS) {
    const extended = Math.min(
      nowMs + SESSION_TTL_MS,
      input.sessionCreatedAt.getTime() + SESSION_ABSOLUTE_MAX_MS,
    );
    if (extended > input.expiresAt.getTime()) {
      expiresAt = new Date(extended);
    }
  }
  const lastSeenAt =
    input.lastSeenAt === null || nowMs - input.lastSeenAt.getTime() > SESSION_LAST_SEEN_STEP_MS
      ? new Date(nowMs)
      : null;
  return { expiresAt, lastSeenAt };
}
