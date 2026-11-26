import { clientErrors, rateLimits, sessions, users } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import type { UserRow } from '@citizenrun/db';
import { newId } from '@citizenrun/shared';
import { randomToken, sha256Hex } from '@citizenrun/shared/crypto';
import { eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { resolveSession } from '../middleware/session.ts';
import { createSession } from '../services/auth/sessions.ts';
import { signIn } from '../testing/auth.ts';
import { createTestApp } from '../testing/app.ts';
import type { TestApp } from '../testing/app.ts';
import { insertSession } from '../testing/factories.ts';
import type { TestAuth, TestRequestOptions } from '../testing/request.ts';

// TEST-sessions with TEST-auth-gates' cases (CTL-08, CTL-09, CTL-18), through POST
// /v1/client-errors, an optional write that is not allowWhenSuspended.
const PATH = '/v1/client-errors';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const NINETY_DAYS_S = 7_776_000;
const HOST_COOKIE = '__Host-os_session';

// Every request comes from its own address, so no case nears the per-replica limit.
let nextHost = 1;
function freshIp(): string {
  const ip = `192.0.2.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

function validReport(): Record<string, unknown> {
  return {
    name: 'TypeError',
    code: 'render.failed',
    route: null,
    component: null,
    appVersion: '1.4.0',
    platform: 'web',
    frames: [],
    requestId: newId(),
  };
}

function post(testApp: TestApp, options: TestRequestOptions = {}) {
  return testApp.request.post(PATH, { ip: freshIp(), body: validReport(), ...options });
}

function shift(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

async function sessionRow(testApp: TestApp, id: string) {
  const [row] = await testApp.deps.db.select().from(sessions).where(eq(sessions.id, id));
  return row;
}

async function userRuleRows(testApp: TestApp) {
  return testApp.deps.db.select().from(rateLimits).where(like(rateLimits.key, 'u:%'));
}

// A session row for `user` with the given times, returned with its auth for `kind`.
async function sessionFor(
  testApp: TestApp,
  user: UserRow,
  kind: TestAuth['kind'],
  times: { expiresAt: Date; createdAt?: Date; lastSeenAt?: Date | null },
) {
  const { row, token } = await insertSession(testApp.deps.db, {
    userId: user.id,
    platform: kind === 'bearer' ? 'ios' : 'web',
    authenticatedAt: times.createdAt ?? testApp.deps.clock.now(),
    createdAt: times.createdAt ?? testApp.deps.clock.now(),
    lastSeenAt: times.lastSeenAt === undefined ? testApp.deps.clock.now() : times.lastSeenAt,
    expiresAt: times.expiresAt,
  });
  const auth: TestAuth = { kind, token };
  return { row, auth };
}

function setCookieOf(response: { headers: Headers }): string | null {
  return response.headers.get('set-cookie');
}

describe('sessions and gates', () => {
  it('only the hash is stored', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const created = await testApp.deps.db.transaction((tx) =>
      createSession(tx, { userId: user.id, platform: 'ios', now: testApp.deps.clock.now() }),
    );
    const row = await sessionRow(testApp, created.sessionId);
    expect(row?.tokenHash).toBe(sha256Hex(created.token));
    expect(Object.values(row ?? {}).map(String)).not.toContain(created.token);
    expect(JSON.stringify(row)).not.toContain(created.token);
  });

  it('a failing bearer is 401, a failing cookie is no viewer', async () => {
    const testApp = await createTestApp();
    const bearer = await post(testApp, { auth: { kind: 'bearer', token: randomToken() } });
    expect(bearer.status).toBe(401);
    expect(await bearer.json()).toMatchObject({ error: { code: 'unauthenticated' } });
    const malformedBearer = await post(testApp, { auth: { kind: 'bearer', token: 'short' } });
    expect(malformedBearer.status).toBe(401);
    const basic = await post(testApp, { headers: { Authorization: 'Basic abc' } });
    expect(basic.status).toBe(401);

    for (const token of [randomToken(), 'not a token']) {
      const cookie = await post(testApp, { auth: { kind: 'cookie', token } });
      expect(cookie.status).toBe(204);
      const cleared = setCookieOf(cookie) ?? '';
      expect(cleared.startsWith(`${HOST_COOKIE}=;`)).toBe(true);
      expect(cleared).toContain('Max-Age=0');
    }
    // No viewer was set: no user rule was counted.
    expect(await userRuleRows(testApp)).toEqual([]);
    expect(await testApp.deps.db.select().from(clientErrors)).toHaveLength(2);
  });

  it('bearer beats cookie with no fallback', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const valid = await signIn(testApp.deps.db, user, 'cookie');
    const response = await post(testApp, {
      auth: { kind: 'bearer', token: randomToken() },
      headers: { Cookie: `${HOST_COOKIE}=${valid.token}` },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthenticated' } });
  });

  it('expired, year-old and deleting sessions give no viewer', async () => {
    const testApp = await createTestApp();
    const now = testApp.deps.clock.now();
    const active = await insertUser(testApp.deps.db);
    const deleting = await insertUser(testApp.deps.db, { status: 'deleting' });
    const cases = [
      { user: active, times: { expiresAt: shift(now, -SECOND_MS) } },
      {
        user: active,
        times: { createdAt: shift(now, -365 * DAY_MS - SECOND_MS), expiresAt: shift(now, DAY_MS) },
      },
      { user: deleting, times: { expiresAt: shift(now, 30 * DAY_MS) } },
    ];
    for (const { user, times } of cases) {
      const cookie = await sessionFor(testApp, user, 'cookie', times);
      const viaCookie = await post(testApp, { auth: cookie.auth });
      expect(viaCookie.status).toBe(204);
      expect(setCookieOf(viaCookie)).toContain('Max-Age=0');
      const bearer = await sessionFor(testApp, user, 'bearer', times);
      const viaBearer = await post(testApp, { auth: bearer.auth });
      expect(viaBearer.status).toBe(401);
    }
    expect(await userRuleRows(testApp)).toEqual([]);
  });

  it('90 days, extended at most once a day', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const { row, auth } = await sessionFor(testApp, user, 'bearer', {
      expiresAt: shift(now, 89 * DAY_MS - SECOND_MS),
    });
    expect((await post(testApp, { auth })).status).toBe(204);
    expect((await sessionRow(testApp, row.id))?.expiresAt).toEqual(shift(now, 90 * DAY_MS));
    expect((await post(testApp, { auth })).status).toBe(204);
    expect((await sessionRow(testApp, row.id))?.expiresAt).toEqual(shift(now, 90 * DAY_MS));
    testApp.deps.clock.advance(DAY_MS + SECOND_MS);
    expect((await post(testApp, { auth })).status).toBe(204);
    expect((await sessionRow(testApp, row.id))?.expiresAt).toEqual(
      shift(now, 91 * DAY_MS + SECOND_MS),
    );
  });

  it('last_seen_at once an hour', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const recent = await sessionFor(testApp, user, 'bearer', {
      expiresAt: shift(now, 90 * DAY_MS),
      lastSeenAt: shift(now, -59 * MINUTE_MS),
    });
    expect((await post(testApp, { auth: recent.auth })).status).toBe(204);
    const unchangedCount = testApp.statementCount();
    expect((await sessionRow(testApp, recent.row.id))?.lastSeenAt).toEqual(
      shift(now, -59 * MINUTE_MS),
    );

    const stale = await sessionFor(testApp, user, 'bearer', {
      expiresAt: shift(now, 90 * DAY_MS),
      lastSeenAt: shift(now, -61 * MINUTE_MS),
    });
    expect((await post(testApp, { auth: stale.auth })).status).toBe(204);
    expect((await sessionRow(testApp, stale.row.id))?.lastSeenAt).toEqual(now);

    // Both changes due: one request, one update more than a request that changes nothing.
    const both = await sessionFor(testApp, user, 'bearer', {
      expiresAt: shift(now, 10 * DAY_MS),
      lastSeenAt: shift(now, -2 * HOUR_MS),
    });
    expect((await post(testApp, { auth: both.auth })).status).toBe(204);
    expect(testApp.statementCount()).toBe(unchangedCount + 1);
    const after = await sessionRow(testApp, both.row.id);
    expect(after?.lastSeenAt).toEqual(now);
    expect(after?.expiresAt).toEqual(shift(now, 90 * DAY_MS));
  });

  it('cookie attributes', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const { auth } = await sessionFor(testApp, user, 'cookie', {
      expiresAt: shift(now, 89 * DAY_MS - SECOND_MS),
    });
    const response = await post(testApp, { auth });
    expect(response.status).toBe(204);
    expect(setCookieOf(response)).toBe(
      `${HOST_COOKIE}=${auth.token}; Max-Age=${String(NINETY_DAYS_S)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );

    // Near the one-year end the extension stops at created_at + 365 days.
    const old = await sessionFor(testApp, user, 'cookie', {
      createdAt: shift(now, -364 * DAY_MS),
      expiresAt: shift(now, HOUR_MS),
    });
    const late = await post(testApp, { auth: old.auth });
    expect(late.status).toBe(204);
    const maxAge = /Max-Age=(\d+)/.exec(setCookieOf(late) ?? '')?.[1];
    expect(Number(maxAge)).toBeLessThanOrEqual(86_400);
    expect(Number(maxAge)).toBeGreaterThan(0);
    // A bearer request that is extended gets no cookie.
    const phone = await sessionFor(testApp, user, 'bearer', {
      expiresAt: shift(now, 89 * DAY_MS - SECOND_MS),
    });
    expect(setCookieOf(await post(testApp, { auth: phone.auth }))).toBeNull();
  });

  it('the local cookie has no prefix', async () => {
    const testApp = await createTestApp({ env: { PUBLIC_URL: 'http://localhost:8081' } });
    expect(testApp.deps.env.SESSION_COOKIE_NAME).toBe('os_session');
    const user = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const { auth } = await sessionFor(testApp, user, 'cookie', {
      expiresAt: shift(now, 89 * DAY_MS - SECOND_MS),
    });
    const response = await post(testApp, { auth });
    expect(response.status).toBe(204);
    expect(setCookieOf(response)).toBe(
      `os_session=${auth.token}; Max-Age=${String(NINETY_DAYS_S)}; Path=/; HttpOnly; SameSite=Lax`,
    );
    // The cookie was read: its user rule was counted.
    expect(await userRuleRows(testApp)).toHaveLength(1);
  });

  it('twenty sessions at most', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const other = await insertUser(testApp.deps.db);
    const base = testApp.deps.clock.now();
    const otherSession = await testApp.deps.db.transaction((tx) =>
      createSession(tx, { userId: other.id, platform: 'web', now: base }),
    );
    const created: string[] = [];
    for (let n = 0; n < 21; n += 1) {
      const made = await testApp.deps.db.transaction((tx) =>
        createSession(tx, { userId: user.id, platform: 'ios', now: shift(base, n * MINUTE_MS) }),
      );
      created.push(made.sessionId);
    }
    const left = await testApp.deps.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(left).toHaveLength(20);
    expect(left.map((row) => row.id).sort()).toEqual(created.slice(1).sort());
    expect(await sessionRow(testApp, otherSession.sessionId)).toBeDefined();
  });

  it('one resolver', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    expect((await post(testApp, { auth })).status).toBe(204);
    const line = testApp.logs.findLast((entry) => entry.parsed['event'] === 'request.done');
    expect(line?.parsed['userId']).toBe(user.id);

    const [stored] = await testApp.deps.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256Hex(auth.token)));
    const before = JSON.stringify(stored);
    const viewer = await resolveSession(testApp.deps.db, auth.token, testApp.deps.clock.now());
    expect(viewer).toMatchObject({
      userId: user.id,
      sessionId: stored?.id,
      role: 'user',
      status: 'active',
      authenticatedAt: stored?.authenticatedAt,
      onboardingStep: 'done',
      platform: 'ios',
    });
    const [after] = await testApp.deps.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256Hex(auth.token)));
    expect(JSON.stringify(after)).toBe(before);
    expect(
      await resolveSession(testApp.deps.db, randomToken(), testApp.deps.clock.now()),
    ).toBeNull();
    expect(
      await resolveSession(testApp.deps.db, 'not a token', testApp.deps.clock.now()),
    ).toBeNull();
  });

  it('suspended accounts cannot write', async () => {
    const testApp = await createTestApp();
    const now = testApp.deps.clock.now();
    const user = await insertUser(testApp.deps.db, {
      status: 'suspended',
      suspendedAt: now,
      suspendedReason: 'other',
    });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const write = await post(testApp, { auth });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ error: { code: 'account_suspended' } });
    expect(await testApp.deps.db.select().from(clientErrors)).toHaveLength(0);
    const read = await testApp.request.get('/v1/openapi.json', { auth, ip: freshIp() });
    expect(read.status).toBe(200);
    // The suspension is the account's: an active user's write passes.
    await testApp.deps.db.update(users).set({ status: 'active' }).where(eq(users.id, user.id));
    expect((await post(testApp, { auth })).status).toBe(204);
  });
});
