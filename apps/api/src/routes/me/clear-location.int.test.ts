import { userDistricts, users } from '@citizenrun/db';
import { insertRateCounter, insertUser, setUserDistricts } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, MeSchema } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertLocationFixture } from '../../testing/location.ts';
import type { LocationFixture } from '../../testing/location.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-14: TEST-api-ME for DELETE /v1/me/location.
const PATH = '/v1/me/location';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.location: 10 a minute per user.
const LOCATION_PER_MINUTE = 10;

let testApp: TestApp;
let fixture: LocationFixture;

beforeEach(async () => {
  testApp = await createTestApp();
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
  fixture = await insertLocationFixture(testApp.deps.db, testApp.deps.clock.now());
});

function clear(options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.delete(PATH, options);
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body: unknown = JSON.parse(await response.text());
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body).toMatchObject({ error: { code, message: ERROR_CODES[code].message } });
}

/** A user with stored districts, a precision and a stale mark, signed in by bearer. */
async function locatedUser(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, {
    locationPrecision: 'exact',
    districtsStaleAt: testApp.deps.clock.now(),
    ...overrides,
  });
  await setUserDistricts(testApp.deps.db, user.id, [
    fixture.state.id,
    fixture.countyA.id,
    fixture.special.id,
  ]);
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

async function storedCount(userId: string): Promise<number> {
  const rows = await testApp.deps.db
    .select({ districtId: userDistricts.districtId })
    .from(userDistricts)
    .where(eq(userDistricts.userId, userId));
  return rows.length;
}

async function userRow(userId: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, userId));
  if (row === undefined) {
    throw new Error('The user row is gone.');
  }
  return row;
}

async function readMe(auth: TestAuth) {
  const response = await testApp.request.get('/v1/me', { auth });
  expect(response.status).toBe(200);
  return MeSchema.parse(await response.json());
}

describe('DELETE /v1/me/location', () => {
  it('ok', async () => {
    const { auth } = await locatedUser();
    const response = await clear({ auth });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('rows are gone and Me.location.isSet is false', async () => {
    const { user, auth } = await locatedUser();
    expect((await readMe(auth)).location.isSet).toBe(true);
    expect((await clear({ auth })).status).toBe(204);
    expect(await storedCount(user.id)).toBe(0);
    const row = await userRow(user.id);
    expect(row.locationPrecision).toBeNull();
    expect(row.districtsStaleAt).toBeNull();
    expect((await readMe(auth)).location).toEqual({
      isSet: false,
      precision: null,
      districtCount: 0,
      bbox: null,
      placeName: null,
      officeCount: 0,
      needsConfirmation: false,
    });
  });

  it('a second call answers 204', async () => {
    const { user, auth } = await locatedUser();
    expect((await clear({ auth })).status).toBe(204);
    expect((await clear({ auth })).status).toBe(204);
    expect(await storedCount(user.id)).toBe(0);
  });

  it('repeat is safe', async () => {
    const { user, auth } = await locatedUser();
    for (let call = 0; call < 3; call += 1) {
      expect((await clear({ auth })).status).toBe(204);
    }
    expect(await storedCount(user.id)).toBe(0);
    expect((await userRow(user.id)).locationPrecision).toBeNull();
  });

  it('onboarding is unchanged', async () => {
    const { user, auth } = await locatedUser({ onboardingStep: 'location', onboardedAt: null });
    expect((await clear({ auth })).status).toBe(204);
    const row = await userRow(user.id);
    expect(row.onboardingStep).toBe('location');
    expect(row.onboardedAt).toBeNull();
  });

  it("another user's districts stay", async () => {
    const other = await locatedUser();
    const { auth } = await locatedUser();
    expect((await clear({ auth })).status).toBe(204);
    expect(await storedCount(other.user.id)).toBe(3);
  });

  it('logged out answers 401', async () => {
    await expectEnvelope(await clear(), 'unauthenticated');
  });

  it('requires a session', async () => {
    await expectEnvelope(await clear(), 'unauthenticated');
    const { user } = await locatedUser();
    const now = testApp.deps.clock.now();
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: new Date(now.getTime() - 100 * 24 * 60 * MINUTE_MS),
      expiresAt: new Date(now.getTime() - MINUTE_MS),
    });
    await expectEnvelope(await clear({ auth: expired }), 'unauthenticated');
    expect(await storedCount(user.id)).toBe(3);
  });

  it('checks origin on cookie writes', async () => {
    const { user } = await locatedUser();
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(await clear({ auth: cookie, origin: null }), 'origin_rejected');
    expect(await storedCount(user.id)).toBe(3);
    expect((await clear({ auth: cookie })).status).toBe(204);
    expect(await storedCount(user.id)).toBe(0);
  });

  it('suspended accounts cannot write', async () => {
    const { user, auth } = await locatedUser({
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'other',
    });
    await expectEnvelope(await clear({ auth }), 'account_suspended');
    expect(await storedCount(user.id)).toBe(3);
  });

  it('rate-limited', async () => {
    const { user, auth } = await locatedUser();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:location:1m`,
      windowStart,
      count: LOCATION_PER_MINUTE,
    });
    const response = await clear({ auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect(await storedCount(user.id)).toBe(3);
  });
});
