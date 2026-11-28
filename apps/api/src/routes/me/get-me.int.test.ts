import { issues } from '@citizenrun/db';
import {
  insertConsent,
  insertConsents,
  insertDistrict,
  insertRateCounter,
  insertUpload,
  insertUser,
  setUserDistricts,
  setUserIssues,
} from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, LEGAL_VERSIONS, MeSchema } from '@citizenrun/shared';
import type { ErrorCode, Me } from '@citizenrun/shared';
import { avatarKeys } from '@citizenrun/shared/storage';
import { marker } from '@citizenrun/shared/testing';
import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn, signInAdmin } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertIdentity } from '../../testing/factories.ts';
import { insertLocationFixture } from '../../testing/location.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-01: TEST-api-ME for GET /v1/me.
const PATH = '/v1/me';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The test environment's PUBLIC_URL is https, so the cookie carries the host prefix.
const COOKIE_NAME = '__Host-os_session';
// me.read: 120 a minute per user.
const ME_READ_LIMIT = 120;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // Five seconds into a minute, so no case crosses a minute window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
});

function shift(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

function now(): Date {
  return testApp.deps.clock.now();
}

function getMe(options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.get(PATH, options);
}

async function readMe(auth: TestAuth): Promise<Me> {
  const response = await getMe({ auth });
  expect(response.status).toBe(200);
  return MeSchema.parse(await response.json());
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body: unknown = JSON.parse(await response.text());
  expect(body).toEqual({
    error: { code, message: ERROR_CODES[code].message, fields: expect.any(Object) },
  });
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
}

/** A user as a new email sign-up leaves it, signed in by bearer from iOS. */
async function newUser(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, {
    handle: null,
    onboardingStep: 'photo',
    onboardedAt: null,
    createdAt: now(),
    ageCheckedAt: now(),
    ...overrides,
  });
  await insertConsents(testApp.deps.db, user.id);
  const auth = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt: now() });
  return { user, auth };
}

describe('GET /v1/me', () => {
  it('ok', async () => {
    const { auth } = await newUser();
    const response = await getMe({ auth });
    expect(response.status).toBe(200);
    expect(MeSchema.safeParse(await response.json()).success).toBe(true);
  });

  it("a new user's Me matches the schema", async () => {
    const { user, auth } = await newUser();
    const response = await getMe({ auth });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const me = MeSchema.parse(await response.json());
    expect(me).toMatchObject({
      id: user.id,
      onboardingStep: 'photo',
      avatar: null,
      avatarPending: false,
      signInMethods: ['email'],
      age: { method: 'none', sourceTier: null, checkedAt: now().toISOString() },
      suspension: null,
      status: 'active',
    });
    expect(me.consents.needed).toEqual([]);
    expect(me.session.platform).toBe('ios');
  });

  it('sensitiveActionsUntil is fifteen minutes after the sign-in', async () => {
    const user = await insertUser(testApp.deps.db);
    const authenticatedAt = shift(now(), -3 * MINUTE_MS);
    const auth = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt });
    const me = await readMe(auth);
    expect(me.session.authenticatedAt).toBe(authenticatedAt.toISOString());
    expect(me.session.sensitiveActionsUntil).toBe(
      shift(authenticatedAt, 15 * MINUTE_MS).toISOString(),
    );
  });

  it('newAccountUntil is seven days after creation', async () => {
    const createdAt = shift(now(), -2 * DAY_MS);
    const { auth } = await newUser({ createdAt });
    const me = await readMe(auth);
    expect(me.createdAt).toBe(createdAt.toISOString());
    expect(me.newAccountUntil).toBe(shift(createdAt, 7 * DAY_MS).toISOString());
  });

  it('an older agreed version puts the document in needed', async () => {
    const user = await insertUser(testApp.deps.db);
    await insertConsents(testApp.deps.db, user.id, { terms: '2000-01-01' });
    const me = await readMe(await signIn(testApp.deps.db, user, 'bearer'));
    expect(me.consents.needed).toEqual(['terms']);
    expect(me.consents.terms).toEqual({
      agreedVersion: '2000-01-01',
      currentVersion: LEGAL_VERSIONS.terms,
    });
  });

  it('a user with no consent rows needs all three documents', async () => {
    const user = await insertUser(testApp.deps.db);
    const me = await readMe(await signIn(testApp.deps.db, user, 'bearer'));
    expect(me.consents.needed).toEqual(['terms', 'content_policy', 'privacy_policy']);
    expect(me.consents.terms.agreedVersion).toBeNull();
    expect(me.consents.contentPolicy.agreedVersion).toBeNull();
    expect(me.consents.privacyPolicy.agreedVersion).toBeNull();
  });

  it('reports no AI-screening answer, whatever earlier rows an account has', async () => {
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const before = await readMe(auth);
    expect(Object.keys(before.consents).sort()).toEqual([
      'contentPolicy',
      'needed',
      'privacyPolicy',
      'terms',
    ]);
    // Rows written while the answer was asked: one granted, a newer one declined.
    for (const [granted, age] of [
      [true, 2 * MINUTE_MS],
      [false, MINUTE_MS],
    ] as const) {
      await insertConsent(testApp.deps.db, {
        userId: user.id,
        kind: 'ai_screening',
        version: '2026-11-25',
        granted,
        createdAt: shift(now(), -age),
      });
    }
    expect((await readMe(auth)).consents).toEqual(before.consents);
  });

  it('a suspended user receives the reason and since', async () => {
    const since = shift(now(), -DAY_MS);
    const { auth } = await newUser({
      status: 'suspended',
      suspendedAt: since,
      suspendedReason: 'spam',
    });
    const me = await readMe(auth);
    expect(me.status).toBe('suspended');
    expect(me.suspension).toEqual({ reason: 'spam', since: since.toISOString() });
  });

  it('Me carries no admin key', async () => {
    const { user, auth } = await signInAdmin(testApp.deps.db, 'bearer');
    expect(user.email).toBe('admin@example.test');
    const me = await readMe(auth);
    expect(me.role).toBe('admin');
    expect(Object.keys(me.session).sort()).toEqual(
      ['authenticatedAt', 'expiresAt', 'platform', 'sensitiveActionsUntil'].sort(),
    );
    for (const key of [...Object.keys(me), ...Object.keys(me.session)]) {
      expect(key.toLowerCase()).not.toContain('admin');
    }
  });

  it('handleChangeAvailableAt counts thirty days from the last change', async () => {
    const changed = shift(now(), -10 * DAY_MS);
    const recent = await newUser({ handle: 'fixture_recent', handleChangedAt: changed });
    expect((await readMe(recent.auth)).handleChangeAvailableAt).toBe(
      shift(changed, 30 * DAY_MS).toISOString(),
    );
    const old = await newUser({
      handle: 'fixture_old',
      handleChangedAt: shift(now(), -31 * DAY_MS),
    });
    expect((await readMe(old.auth)).handleChangeAvailableAt).toBeNull();
    const first = await newUser({ handle: 'fixture_first', handleChangedAt: null });
    expect((await readMe(first.auth)).handleChangeAvailableAt).toBeNull();
  });

  it('the avatar comes from avatar_key only', async () => {
    const shown = await newUser();
    const key = avatarKeys(shown.user.id, '0195d2c4-0000-7000-8000-00000000a001').small;
    const withAvatar = await newUser({ avatarKey: key });
    const me = await readMe(withAvatar.auth);
    expect(me.avatar).toMatchObject({
      kind: 'image',
      key,
      width: 320,
      height: 320,
      blurhash: null,
      thumb: null,
      poster: null,
      durationMs: null,
    });
    expect(new URL(me.avatar?.url ?? '').searchParams.has('X-Amz-Signature')).toBe(true);

    const pendingKey = avatarKeys(shown.user.id, '0195d2c4-0000-7000-8000-00000000a002').small;
    const pending = await newUser({ avatarPendingKey: pendingKey });
    const pendingMe = await readMe(pending.auth);
    expect(pendingMe.avatar).toBeNull();
    expect(pendingMe.avatarPending).toBe(true);
    expect(JSON.stringify(pendingMe)).not.toContain(pendingKey);
  });

  it('avatarPending while a consumed avatar upload is unprocessed', async () => {
    const waiting = await newUser();
    await insertUpload(testApp.deps.db, { userId: waiting.user.id, consumedAt: now() });
    expect((await readMe(waiting.auth)).avatarPending).toBe(true);

    const done = await newUser();
    await insertUpload(testApp.deps.db, {
      userId: done.user.id,
      consumedAt: now(),
      bytes: 123_456,
    });
    expect((await readMe(done.auth)).avatarPending).toBe(false);
  });

  it('issues come in the issue order', async () => {
    const { user, auth } = await newUser();
    const ordered = await testApp.deps.db
      .select({ id: issues.id })
      .from(issues)
      .orderBy(asc(issues.sort))
      .limit(4);
    expect(ordered).toHaveLength(4);
    const shuffled = [ordered[2], ordered[0], ordered[3], ordered[1]].map((issue) => {
      if (issue === undefined) {
        throw new Error('An issue is missing.');
      }
      return issue;
    });
    await setUserIssues(
      testApp.deps.db,
      user.id,
      shuffled.map((issue, index) => ({ issueId: issue.id, starred: index < 2 })),
    );
    const me = await readMe(auth);
    expect(me.issues).toEqual([
      { issueId: ordered[0]?.id, starred: true },
      { issueId: ordered[1]?.id, starred: false },
      { issueId: ordered[2]?.id, starred: true },
      { issueId: ordered[3]?.id, starred: false },
    ]);
  });

  it('sign-in methods are distinct and sorted', async () => {
    const { user, auth } = await newUser();
    await insertIdentity(testApp.deps.db, {
      userId: user.id,
      provider: 'google',
      subject: 'fixture-google-subject',
      email: null,
    });
    expect((await readMe(auth)).signInMethods).toEqual(['email', 'google']);
  });

  it("another user's private columns never appear", async () => {
    const { auth } = await newUser({ email: 'first@example.test' });
    // The factory's email holds the run marker; the second user's name and handle do too.
    const other = await insertUser(testApp.deps.db, {
      name: `Name ${marker()}`,
      handle: 'fixture_other',
    });
    await setUserIssues(testApp.deps.db, other.id);
    expect(other.email).toContain(marker());
    const response = await getMe({ auth });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(marker());
    expect(text).not.toContain(other.id);
    expect(text).not.toContain('fixture_other');
  });

  it('a suspended user can still read', async () => {
    const { auth } = await newUser({
      status: 'suspended',
      suspendedAt: now(),
      suspendedReason: 'other',
    });
    expect((await getMe({ auth })).status).toBe(200);
  });

  it('requires a session', async () => {
    await expectEnvelope(await getMe(), 'unauthenticated');

    const user = await insertUser(testApp.deps.db);
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: shift(now(), -91 * DAY_MS),
      expiresAt: shift(now(), -MINUTE_MS),
    });
    await expectEnvelope(await getMe({ auth: expired }), 'unauthenticated');

    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    expect((await getMe({ auth: cookie })).status).toBe(200);
    await expectEnvelope(
      await getMe({
        auth: { kind: 'bearer', token: 'A'.repeat(43) },
        headers: { Cookie: `${COOKIE_NAME}=${cookie.token}` },
      }),
      'unauthenticated',
    );
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await getMe(), 'unauthenticated');
    await expectEnvelope(
      await getMe({ auth: { kind: 'bearer', token: 'not a token' } }),
      'unauthenticated',
    );
    const { auth } = await newUser();
    await expectEnvelope(await getMe({ auth, client: null }), 'client_header_required');
  });

  it('rate-limited', async () => {
    const { user, auth } = await newUser();
    const windowStart = new Date(Math.floor(now().getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:me_read:1m`,
      windowStart,
      count: ME_READ_LIMIT,
    });
    const response = await getMe({ auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now().getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
  });
});

describe('GET /v1/me location', () => {
  it('a user with no districts has no location', async () => {
    const { auth } = await newUser();
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

  it('two exact districts give a bbox that holds both', async () => {
    const { user, auth } = await newUser({ locationPrecision: 'approx' });
    const first = await insertDistrict(testApp.deps.db, {
      wkt: 'POLYGON((-40.00 30.00,-39.99 30.00,-39.99 30.01,-40.00 30.01,-40.00 30.00))',
    });
    const second = await insertDistrict(testApp.deps.db, {
      wkt: 'POLYGON((-39.90 30.10,-39.89 30.10,-39.89 30.11,-39.90 30.11,-39.90 30.10))',
    });
    await setUserDistricts(testApp.deps.db, user.id, [first.id, second.id]);
    const { location } = await readMe(auth);
    expect(location).toMatchObject({ isSet: true, precision: 'approx', districtCount: 2 });
    expect(location.bbox).toEqual([-40, 30, -39.89, 30.11]);
  });

  it("the place name is the city's", async () => {
    const fixture = await insertLocationFixture(testApp.deps.db, now());
    const { user, auth } = await newUser();
    await setUserDistricts(testApp.deps.db, user.id, [fixture.city.id, fixture.countyA.id]);
    expect((await readMe(auth)).location.placeName).toBe(fixture.cityJurisdiction.name);
    expect(fixture.cityJurisdiction.name).toBe('Fixture City');
    // Without the city, the exact county's name.
    await setUserDistricts(testApp.deps.db, user.id, [fixture.countyA.id, fixture.state.id]);
    expect((await readMe(auth)).location.placeName).toBe('Fixture County A');
  });

  it('only approximate districts give no place name', async () => {
    const fixture = await insertLocationFixture(testApp.deps.db, now());
    const { user, auth } = await newUser();
    await setUserDistricts(testApp.deps.db, user.id, [fixture.special.id]);
    const { location } = await readMe(auth);
    expect(location).toMatchObject({
      isSet: true,
      districtCount: 1,
      bbox: null,
      placeName: null,
      officeCount: 0,
    });
  });

  it('the office count reads exact districts only', async () => {
    const fixture = await insertLocationFixture(testApp.deps.db, now());
    const { user, auth } = await newUser();
    // County A: two live offices, a placeholder and a retired one; S: one office, approximate.
    await setUserDistricts(testApp.deps.db, user.id, [fixture.countyA.id, fixture.special.id]);
    expect((await readMe(auth)).location.officeCount).toBe(2);
  });

  it('a stale mark asks for confirmation', async () => {
    const { auth } = await newUser({ locationPrecision: 'exact', districtsStaleAt: now() });
    const { location } = await readMe(auth);
    expect(location.needsConfirmation).toBe(true);
    expect(location.precision).toBe('exact');
  });
});
