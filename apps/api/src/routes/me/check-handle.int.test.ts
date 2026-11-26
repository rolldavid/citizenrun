import { insertRateCounter, insertUser } from '@citizenrun/db/testing';
import { BRAND, ERROR_CODES, ErrorEnvelopeSchema, HandleCheckSchema } from '@citizenrun/shared';
import type { ErrorCode, HandleCheck } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertReservedHandle } from '../../testing/factories.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-07: TEST-api-ME and TEST-handle-rules `live check` for GET /v1/handles/check.
const PATH = '/v1/handles/check';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COOKIE_NAME = '__Host-os_session';
// me.handleCheck: 60 a minute per user.
const HANDLE_CHECK_LIMIT = 60;

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

let testApp: TestApp;
let auth: TestAuth;
let userId: string;

beforeEach(async () => {
  testApp = await createTestApp();
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
  const user = await insertUser(testApp.deps.db, { handle: 'fixture_mine' });
  userId = user.id;
  auth = await signIn(testApp.deps.db, user, 'bearer');
});

function now(): Date {
  return testApp.deps.clock.now();
}

function check(handle: string | null, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.get(PATH, {
    auth,
    ...(handle === null ? {} : { query: { handle } }),
    ...options,
  });
}

async function expectCheck(handle: string): Promise<HandleCheck> {
  const response = await check(handle);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return HandleCheckSchema.parse(await response.json());
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<Envelope> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body = JSON.parse(await response.text()) as Envelope; // checked against the schema below
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(ERROR_CODES[code].message);
  return body;
}

describe('GET /v1/handles/check', () => {
  it('ok', async () => {
    expect(await expectCheck('fixture_free')).toEqual({
      handle: 'fixture_free',
      available: true,
      reason: null,
    });
  });

  it('Ab_C normalises to ab_c', async () => {
    expect(await expectCheck('Ab_C')).toEqual({ handle: 'ab_c', available: true, reason: null });
  });

  it('@Ab_C normalises to ab_c', async () => {
    expect(await expectCheck('  @Ab_C ')).toEqual({
      handle: 'ab_c',
      available: true,
      reason: null,
    });
  });

  it('ab and a-b are invalid', async () => {
    expect(await expectCheck('ab')).toEqual({ handle: 'ab', available: false, reason: 'invalid' });
    expect(await expectCheck('A-B')).toEqual({
      handle: 'a-b',
      available: false,
      reason: 'invalid',
    });
  });

  it('.ab and a..b are invalid', async () => {
    expect(await expectCheck('.ab')).toEqual({
      handle: '.ab',
      available: false,
      reason: 'invalid',
    });
    expect(await expectCheck('a..b')).toEqual({
      handle: 'a..b',
      available: false,
      reason: 'invalid',
    });
  });

  it('admin, a handle holding the brand slug and a handle released 10 days ago are reserved', async () => {
    expect(await expectCheck('Admin')).toEqual({
      handle: 'admin',
      available: false,
      reason: 'reserved',
    });
    const slugHandle = `${BRAND.slug.replace(/-/g, '')}_fan`;
    expect(await expectCheck(slugHandle)).toEqual({
      handle: slugHandle,
      available: false,
      reason: 'reserved',
    });
    // Released 10 days ago: held for 80 more days.
    await insertReservedHandle(testApp.deps.db, testApp.deps.keyRing, {
      handle: 'fixture_released',
      reason: 'released',
      reservedUntil: new Date(now().getTime() + 80 * DAY_MS),
    });
    expect(await expectCheck('fixture_released')).toEqual({
      handle: 'fixture_released',
      available: false,
      reason: 'reserved',
    });
  });

  it("another user's handle is taken", async () => {
    await insertUser(testApp.deps.db, { handle: 'fixture_theirs' });
    expect(await expectCheck('Fixture_Theirs')).toEqual({
      handle: 'fixture_theirs',
      available: false,
      reason: 'taken',
    });
  });

  it("the caller's own handle is available", async () => {
    expect(await expectCheck('@FIXTURE_MINE')).toEqual({
      handle: 'fixture_mine',
      available: true,
      reason: null,
    });
  });

  it('a handle released 91 days ago is available', async () => {
    await insertReservedHandle(testApp.deps.db, testApp.deps.keyRing, {
      handle: 'fixture_free_again',
      reason: 'released',
      reservedUntil: new Date(now().getTime() - DAY_MS),
    });
    expect(await expectCheck('fixture_free_again')).toEqual({
      handle: 'fixture_free_again',
      available: true,
      reason: null,
    });
  });

  it('a 41-character query answers 400', async () => {
    const envelope = await expectEnvelope(await check('a'.repeat(41)), 'invalid_request');
    expect(envelope.error.fields).toEqual({ handle: 'too_long' });
    // 40 characters reach the rules, which find the handle too long.
    expect(await expectCheck('a'.repeat(40))).toEqual({
      handle: 'a'.repeat(40),
      available: false,
      reason: 'invalid',
    });
  });

  it('rejects invalid input', async () => {
    const missing = await expectEnvelope(await check(null), 'invalid_request');
    expect(missing.error.fields).toEqual({ handle: 'required' });
    const empty = await expectEnvelope(await check(''), 'invalid_request');
    expect(empty.error.fields).toEqual({ handle: 'too_short' });
  });

  it('logged out answers 401', async () => {
    await expectEnvelope(await check('fixture_free', { auth: null }), 'unauthenticated');
  });

  it('requires a session', async () => {
    await expectEnvelope(await check('fixture_free', { auth: null }), 'unauthenticated');
    const user = await insertUser(testApp.deps.db);
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: new Date(now().getTime() - 100 * DAY_MS),
      expiresAt: new Date(now().getTime() - MINUTE_MS),
    });
    await expectEnvelope(await check('fixture_free', { auth: expired }), 'unauthenticated');
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await check('fixture_free', {
        auth: { kind: 'bearer', token: 'A'.repeat(43) },
        headers: { Cookie: `${COOKIE_NAME}=${cookie.token}` },
      }),
      'unauthenticated',
    );
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await check('fixture_free', { auth: null }), 'unauthenticated');
    await expectEnvelope(await check(null), 'invalid_request');
  });

  it('rate-limited', async () => {
    const windowStart = new Date(Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${userId}:handle_check:1m`,
      windowStart,
      count: HANDLE_CHECK_LIMIT,
    });
    const response = await check('fixture_free');
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
  });

  it('the typed handle appears in no log line', async () => {
    expect((await expectCheck('fixture_typed_value')).available).toBe(true);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain('fixture_typed_value');
    }
  });
});
