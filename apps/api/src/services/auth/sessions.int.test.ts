import { sessions } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { sha256Hex } from '@citizenrun/shared/crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { createSession, deleteAllSessions, deleteSession, sessionExtension } from './sessions.ts';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date('2027-03-05T12:00:00.000Z');

function shift(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

async function create(testApp: TestApp, userId: string, platform: 'ios' | 'android' | 'web') {
  return testApp.deps.db.transaction((tx) =>
    createSession(tx, { userId, platform, now: testApp.deps.clock.now() }),
  );
}

describe('session lifecycle', () => {
  it('create writes the row', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const created = await create(testApp, user.id, 'android');
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.expiresAt).toEqual(shift(now, 90 * DAY_MS));
    expect(created.authenticatedAt).toEqual(now);
    const [row] = await testApp.deps.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, created.sessionId));
    expect(row).toMatchObject({
      userId: user.id,
      tokenHash: sha256Hex(created.token),
      platform: 'android',
      authenticatedAt: now,
      lastSeenAt: now,
      expiresAt: shift(now, 90 * DAY_MS),
      createdAt: now,
    });
  });

  it('delete one', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const created = await create(testApp, user.id, 'ios');
    expect(await deleteSession(testApp.deps.db, created.sessionId)).toBe(true);
    expect(await deleteSession(testApp.deps.db, created.sessionId)).toBe(false);
  });

  it('delete all', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const other = await insertUser(testApp.deps.db);
    await create(testApp, user.id, 'ios');
    await create(testApp, user.id, 'web');
    await create(testApp, user.id, 'android');
    const kept = await create(testApp, other.id, 'ios');
    expect(await deleteAllSessions(testApp.deps.db, user.id)).toBe(3);
    expect(await deleteAllSessions(testApp.deps.db, user.id)).toBe(0);
    const left = await testApp.deps.db.select({ id: sessions.id }).from(sessions);
    expect(left).toEqual([{ id: kept.sessionId }]);
  });

  it('sessionExtension at 89 days minus a second, at 89 days and near the one-year end', () => {
    const fresh = { sessionCreatedAt: shift(NOW, -DAY_MS), lastSeenAt: NOW, now: NOW };
    expect(sessionExtension({ ...fresh, expiresAt: shift(NOW, 89 * DAY_MS - SECOND_MS) })).toEqual({
      expiresAt: shift(NOW, 90 * DAY_MS),
      lastSeenAt: null,
    });
    expect(sessionExtension({ ...fresh, expiresAt: shift(NOW, 89 * DAY_MS) })).toEqual({
      expiresAt: null,
      lastSeenAt: null,
    });
    // One day before the one-year end: capped at created_at + 365 days.
    const old = { sessionCreatedAt: shift(NOW, -364 * DAY_MS), lastSeenAt: NOW, now: NOW };
    expect(sessionExtension({ ...old, expiresAt: shift(NOW, HOUR_MS) })).toEqual({
      expiresAt: shift(NOW, DAY_MS),
      lastSeenAt: null,
    });
    // Already at the cap: nothing to extend.
    expect(sessionExtension({ ...old, expiresAt: shift(NOW, DAY_MS) })).toEqual({
      expiresAt: null,
      lastSeenAt: null,
    });
  });

  it('lastSeenAt at exactly one hour stays', () => {
    const base = { expiresAt: shift(NOW, 90 * DAY_MS), sessionCreatedAt: NOW, now: NOW };
    expect(sessionExtension({ ...base, lastSeenAt: shift(NOW, -HOUR_MS) }).lastSeenAt).toBeNull();
    expect(sessionExtension({ ...base, lastSeenAt: shift(NOW, -HOUR_MS - 1) }).lastSeenAt).toEqual(
      NOW,
    );
    expect(sessionExtension({ ...base, lastSeenAt: null }).lastSeenAt).toEqual(NOW);
  });
});
