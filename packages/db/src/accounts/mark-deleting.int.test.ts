import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../client.ts';
import { authChallenges, sessions, users } from '../schema/accounts.ts';
import { getTestDb, insertUser } from '../testing/index.ts';
import { markAccountDeleting } from './mark-deleting.ts';

const HOUR_MS = 3_600_000;

// The stored form of a fresh secret: the SHA-256 hex of 32 random bytes in base64url.
function secretHash(): string {
  return createHash('sha256').update(randomBytes(32).toString('base64url'), 'utf8').digest('hex');
}

class FixtureRollback extends Error {
  override readonly name = 'FixtureRollback';
}

async function insertSession(db: Db, userId: string): Promise<string> {
  const id = newId();
  await db.insert(sessions).values({
    id,
    userId,
    tokenHash: secretHash(),
    platform: 'ios',
    expiresAt: new Date(Date.now() + 24 * HOUR_MS),
  });
  return id;
}

async function insertWsTicket(db: Db, userId: string, sessionId: string): Promise<void> {
  await db.insert(authChallenges).values({
    id: newId(),
    kind: 'ws_ticket',
    secretHash: secretHash(),
    userId,
    sessionId,
    expiresAt: new Date(Date.now() + HOUR_MS),
  });
}

async function userState(
  db: Db,
  userId: string,
): Promise<{ status: string; deletionRequestedAt: Date | null } | undefined> {
  const [row] = await db
    .select({ status: users.status, deletionRequestedAt: users.deletionRequestedAt })
    .from(users)
    .where(eq(users.id, userId));
  return row;
}

async function sessionCount(db: Db, userId: string): Promise<number> {
  return (await db.select().from(sessions).where(eq(sessions.userId, userId))).length;
}

async function challengeCount(db: Db, userId: string): Promise<number> {
  return (await db.select().from(authChallenges).where(eq(authChallenges.userId, userId))).length;
}

describe('markAccountDeleting', () => {
  it('marks the user deleting and ends every session', async () => {
    const db = getTestDb();
    const user = await insertUser(db);
    const first = await insertSession(db, user.id);
    await insertSession(db, user.id);
    await insertWsTicket(db, user.id, first);
    expect(await challengeCount(db, user.id)).toBe(1);

    const result = await db.transaction((tx) => markAccountDeleting(tx, user.id));

    expect(result).toEqual({ marked: true, sessionsEnded: 2 });
    const state = await userState(db, user.id);
    expect(state?.status).toBe('deleting');
    expect(state?.deletionRequestedAt).toBeInstanceOf(Date);
    expect(await sessionCount(db, user.id)).toBe(0);
    expect(await challengeCount(db, user.id)).toBe(0);
  });

  it('a second call keeps the first request time', async () => {
    const db = getTestDb();
    const user = await insertUser(db);
    await insertSession(db, user.id);
    await db.transaction((tx) => markAccountDeleting(tx, user.id));
    const firstTime = (await userState(db, user.id))?.deletionRequestedAt;
    expect(firstTime).toBeInstanceOf(Date);

    const again = await db.transaction((tx) => markAccountDeleting(tx, user.id));

    expect(again).toEqual({ marked: false, sessionsEnded: 0 });
    const state = await userState(db, user.id);
    expect(state?.status).toBe('deleting');
    expect(state?.deletionRequestedAt?.getTime()).toBe(firstTime?.getTime());
  });

  it('other users keep their sessions', async () => {
    const db = getTestDb();
    const leaving = await insertUser(db);
    const staying = await insertUser(db);
    await insertSession(db, leaving.id);
    const kept = await insertSession(db, staying.id);
    await insertWsTicket(db, staying.id, kept);

    await db.transaction((tx) => markAccountDeleting(tx, leaving.id));

    expect(await sessionCount(db, staying.id)).toBe(1);
    expect(await challengeCount(db, staying.id)).toBe(1);
    expect((await userState(db, staying.id))?.status).toBe('active');
  });

  it("runs inside the caller's transaction", async () => {
    const db = getTestDb();
    const user = await insertUser(db);
    await insertSession(db, user.id);
    await insertSession(db, user.id);

    await expect(
      db.transaction(async (tx) => {
        const result = await markAccountDeleting(tx, user.id);
        expect(result).toEqual({ marked: true, sessionsEnded: 2 });
        throw new FixtureRollback('roll back');
      }),
    ).rejects.toBeInstanceOf(FixtureRollback);

    const state = await userState(db, user.id);
    expect(state?.status).toBe('active');
    expect(state?.deletionRequestedAt).toBeNull();
    expect(await sessionCount(db, user.id)).toBe(2);
  });
});
