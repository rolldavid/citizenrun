import { follows } from '@citizenrun/db';
import {
  insertDistrict,
  insertJurisdiction,
  insertOffice,
  insertRateCounter,
  insertUser,
  makeFollow,
} from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, LIMITS } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-OFF-04: TEST-api-OFF and TEST-rate-limits for POST /v1/offices/:id/follow.
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN_ID = '00000000-0000-7000-8000-00000000ffff';
// office_toggle: 120 a minute per user.
const TOGGLES_PER_MINUTE = 120;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

async function office(overrides: Parameters<typeof insertOffice>[1] = {}) {
  const { db } = testApp.deps;
  const jurisdiction = await insertJurisdiction(db);
  const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id });
  return insertOffice(db, {
    jurisdictionId: jurisdiction.id,
    districtId: district.id,
    ...overrides,
  });
}

/** A finished user `ageMs` old at the clock's time, signed in by bearer unless told otherwise. */
async function user(
  ageMs: number = 30 * DAY_MS,
  overrides: Parameters<typeof insertUser>[1] = {},
  kind: 'bearer' | 'cookie' = 'bearer',
) {
  const createdAt = new Date(testApp.deps.clock.now().getTime() - ageMs);
  const row = await insertUser(testApp.deps.db, {
    createdAt,
    onboardedAt: createdAt,
    ...overrides,
  });
  return { userId: row.id, auth: await signIn(testApp.deps.db, row, kind) };
}

function follow(officeId: string, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.post(`/v1/offices/${officeId}/follow`, options);
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body: unknown = await response.json();
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({ error: { code, message: ERROR_CODES[code].message } });
}

async function followRows(userId: string, officeId?: string) {
  return testApp.deps.db
    .select()
    .from(follows)
    .where(
      officeId === undefined
        ? eq(follows.followerId, userId)
        : and(eq(follows.followerId, userId), eq(follows.targetId, officeId)),
    );
}

/** `count` follows of other offices by the user, the oldest at `oldest`, the rest a minute apart after it. */
async function priorFollows(userId: string, count: number, oldest: Date): Promise<void> {
  await testApp.deps.db.insert(follows).values(
    Array.from({ length: count }, (_, index) =>
      makeFollow({
        followerId: userId,
        targetType: 'office',
        createdAt: new Date(oldest.getTime() + index * SECOND_MS),
      }),
    ),
  );
}

async function jobCount(): Promise<number> {
  const rows = await testApp.deps.db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job`,
    'objects',
  );
  return rows[0]?.n ?? 0;
}

async function viewerAuth(): Promise<TestAuth> {
  return (await user()).auth;
}

describe('POST /v1/offices/:id/follow', () => {
  it('ok', async () => {
    const target = await office();
    const response = await follow(target.id, { auth: await viewerAuth() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: true });
  });

  it('rejects invalid input', async () => {
    await expectEnvelope(
      await follow('not-a-uuid', { auth: await viewerAuth() }),
      'invalid_request',
    );
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await follow(UNKNOWN_ID), 'unauthenticated');
    const auth = await viewerAuth();
    await expectEnvelope(await follow('not-a-uuid', { auth }), 'invalid_request');
    await expectEnvelope(await follow(UNKNOWN_ID, { auth }), 'not_found');
    const retired = await office({ retiredAt: new Date('2026-01-01T00:00:00.000Z') });
    await expectEnvelope(await follow(retired.id, { auth }), 'office_retired');
  });

  it('requires a session', async () => {
    const target = await office();
    await expectEnvelope(await follow(target.id), 'unauthenticated');
    const row = await insertUser(testApp.deps.db);
    const now = testApp.deps.clock.now();
    const expired = await signIn(testApp.deps.db, row, 'bearer', {
      authenticatedAt: new Date(now.getTime() - 100 * DAY_MS),
      expiresAt: new Date(now.getTime() - MINUTE_MS),
    });
    await expectEnvelope(await follow(target.id, { auth: expired }), 'unauthenticated');
    expect(await followRows(row.id)).toHaveLength(0);
  });

  it('needs finished onboarding', async () => {
    const target = await office();
    const { userId, auth } = await user(30 * DAY_MS, {
      onboardingStep: 'issues',
      onboardedAt: null,
    });
    await expectEnvelope(await follow(target.id, { auth }), 'onboarding_incomplete');
    expect(await followRows(userId)).toHaveLength(0);
  });

  it('onboarding at issues answers 403', async () => {
    const target = await office();
    const { auth } = await user(30 * DAY_MS, { onboardingStep: 'issues', onboardedAt: null });
    await expectEnvelope(await follow(target.id, { auth }), 'onboarding_incomplete');
  });

  it('checks origin on cookie writes', async () => {
    const target = await office();
    const { userId, auth } = await user(30 * DAY_MS, {}, 'cookie');
    await expectEnvelope(await follow(target.id, { auth, origin: null }), 'origin_rejected');
    await expectEnvelope(
      await follow(target.id, { auth, origin: 'https://evil.example.test' }),
      'origin_rejected',
    );
    await expectEnvelope(await follow(target.id, { auth, client: 'ios/1.4.0' }), 'origin_rejected');
    expect(await followRows(userId)).toHaveLength(0);
    expect((await follow(target.id, { auth })).status).toBe(200);
    const bearer = await viewerAuth();
    expect((await follow(target.id, { auth: bearer, origin: null })).status).toBe(200);
  });

  it('suspended accounts cannot write', async () => {
    const target = await office();
    const { userId, auth } = await user(30 * DAY_MS, {
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'other',
    });
    await expectEnvelope(await follow(target.id, { auth }), 'account_suspended');
    expect(await followRows(userId)).toHaveLength(0);
    expect((await testApp.request.get(`/v1/offices/${target.id}`, { auth })).status).toBe(200);
  });

  it('rate-limited', async () => {
    const target = await office();
    const { userId, auth } = await user();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${userId}:toggle:1m`,
      windowStart,
      count: TOGGLES_PER_MINUTE,
    });
    const response = await follow(target.id, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect(await followRows(userId)).toHaveLength(0);
  });

  it('repeat is safe', async () => {
    const target = await office();
    const { userId, auth } = await user();
    for (let call = 0; call < 3; call += 1) {
      const response = await follow(target.id, { auth });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ following: true });
    }
    expect(await followRows(userId, target.id)).toHaveLength(1);
  });

  it('following twice keeps one row', async () => {
    const target = await office();
    const { userId, auth } = await user();
    expect((await follow(target.id, { auth })).status).toBe(200);
    expect((await follow(target.id, { auth })).status).toBe(200);
    const rows = await followRows(userId, target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetType).toBe('office');
    expect(rows[0]?.createdAt.toISOString()).toBe(testApp.deps.clock.now().toISOString());
  });

  it('a retired office answers 422 office_retired', async () => {
    const retired = await office({ retiredAt: new Date('2026-01-01T00:00:00.000Z') });
    const { userId, auth } = await user();
    await expectEnvelope(await follow(retired.id, { auth }), 'office_retired');
    expect(await followRows(userId)).toHaveLength(0);
  });

  it('an unknown id answers 404', async () => {
    await expectEnvelope(await follow(UNKNOWN_ID, { auth: await viewerAuth() }), 'not_found');
  });

  it('the 101st follow of a 3-day-old account in 24 hours answers 429', async () => {
    const target = await office();
    const { userId, auth } = await user(3 * DAY_MS);
    const now = testApp.deps.clock.now();
    const oldest = new Date(now.getTime() - 20 * HOUR_MS);
    await priorFollows(userId, LIMITS.followsPerDay.newAccount, oldest);
    const response = await follow(target.id, { auth });
    await expectEnvelope(response, 'daily_limit_reached');
    const wait = Math.ceil((oldest.getTime() + DAY_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(wait));
    expect(await followRows(userId, target.id)).toHaveLength(0);
  });

  it('new-account limits use account age', async () => {
    const now = testApp.deps.clock.now();
    const oldest = new Date(now.getTime() - HOUR_MS);

    const almost = await user(7 * DAY_MS - HOUR_MS);
    await priorFollows(almost.userId, LIMITS.followsPerDay.newAccount, oldest);
    await expectEnvelope(
      await follow((await office()).id, { auth: almost.auth }),
      'daily_limit_reached',
    );

    const week = await user(7 * DAY_MS);
    await priorFollows(week.userId, LIMITS.followsPerDay.newAccount, oldest);
    expect((await follow((await office()).id, { auth: week.auth })).status).toBe(200);
    await priorFollows(
      week.userId,
      LIMITS.followsPerDay.established - LIMITS.followsPerDay.newAccount - 1,
      oldest,
    );
    await expectEnvelope(
      await follow((await office()).id, { auth: week.auth }),
      'daily_limit_reached',
    );
  });

  it('a repeat of an existing follow at the limit answers 200', async () => {
    const target = await office();
    const { userId, auth } = await user(3 * DAY_MS);
    const now = testApp.deps.clock.now();
    await testApp.deps.db.insert(follows).values(
      makeFollow({
        followerId: userId,
        targetId: target.id,
        createdAt: new Date(now.getTime() - HOUR_MS),
      }),
    );
    await priorFollows(
      userId,
      LIMITS.followsPerDay.newAccount - 1,
      new Date(now.getTime() - HOUR_MS),
    );
    const response = await follow(target.id, { auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ following: true });
  });

  it('no job and no notification', async () => {
    const target = await office();
    const { auth } = await user();
    const before = await jobCount();
    expect((await follow(target.id, { auth })).status).toBe(200);
    expect(await jobCount()).toBe(before);
  });
});
