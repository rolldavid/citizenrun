import { issues } from '@citizenrun/db';
import {
  insertConsent,
  insertConsents,
  insertUpload,
  insertUser,
  setUserDistricts,
  setUserIssues,
} from '@citizenrun/db/testing';
import { sessions, users } from '@citizenrun/db';
import { ApiError, LEGAL_VERSIONS, MeSchema, SessionInfoSchema } from '@citizenrun/shared';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signInAdmin } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertIdentity, insertSession } from '../../testing/factories.ts';
import { insertLocationFixture } from '../../testing/location.ts';
import { loadConsentState, loadMe } from './load-me.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
});

function shift(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

/** A user as a new email sign-up leaves it, with its session. */
async function newUser(overrides: Parameters<typeof insertUser>[1] = {}) {
  const now = testApp.deps.clock.now();
  const user = await insertUser(testApp.deps.db, {
    handle: null,
    onboardingStep: 'photo',
    onboardedAt: null,
    createdAt: now,
    ageCheckedAt: now,
    ...overrides,
  });
  await insertConsents(testApp.deps.db, user.id);
  const { row: session } = await insertSession(testApp.deps.db, {
    userId: user.id,
    platform: 'ios',
    authenticatedAt: now,
    expiresAt: shift(now, 90 * DAY_MS),
  });
  return { user, session };
}

async function expectUnauthenticated(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect(error instanceof ApiError ? error.code : null).toBe('unauthenticated');
}

function load(userId: string, sessionId: string) {
  return loadMe(testApp.deps, { userId, sessionId, now: testApp.deps.clock.now() });
}

describe('loadMe', () => {
  it("a new user's Me parses with MeSchema", async () => {
    const { user, session } = await newUser();
    const me = await load(user.id, session.id);
    expect(MeSchema.parse(me)).toEqual(me);
    const now = testApp.deps.clock.now();
    expect(me).toMatchObject({
      id: user.id,
      handle: null,
      onboardingStep: 'photo',
      onboardedAt: null,
      signInMethods: ['email'],
      avatar: null,
      avatarPending: false,
      role: 'user',
      status: 'active',
      suspension: null,
      email: user.email,
      emailStatus: 'ok',
      locale: 'en',
      issues: [],
      handleChangeAvailableAt: null,
      createdAt: now.toISOString(),
      newAccountUntil: shift(now, 7 * DAY_MS).toISOString(),
      age: { method: 'self_declared', sourceTier: 'self', checkedAt: now.toISOString() },
    });
    expect(me.consents).toEqual({
      terms: { agreedVersion: LEGAL_VERSIONS.terms, currentVersion: LEGAL_VERSIONS.terms },
      contentPolicy: {
        agreedVersion: LEGAL_VERSIONS.content_policy,
        currentVersion: LEGAL_VERSIONS.content_policy,
      },
      privacyPolicy: {
        agreedVersion: LEGAL_VERSIONS.privacy_policy,
        currentVersion: LEGAL_VERSIONS.privacy_policy,
      },
      aiScreening: 'granted',
      needed: [],
    });
    expect(me.session).toEqual({
      platform: 'ios',
      authenticatedAt: now.toISOString(),
      expiresAt: shift(now, 90 * DAY_MS).toISOString(),
      sensitiveActionsUntil: shift(now, 15 * MINUTE_MS).toISOString(),
    });
  });

  it('signInMethods are distinct and sorted', async () => {
    const { user, session } = await newUser();
    for (const [provider, subject] of [
      ['google', 'fixture-google-1'],
      ['apple', 'fixture-apple-1'],
      ['google', 'fixture-google-2'],
    ] as const) {
      await insertIdentity(testApp.deps.db, { userId: user.id, provider, subject, email: null });
    }
    expect((await load(user.id, session.id)).signInMethods).toEqual(['apple', 'email', 'google']);
  });

  it('issues follow issues.sort', async () => {
    const { user, session } = await newUser();
    const ordered = await testApp.deps.db
      .select({ id: issues.id })
      .from(issues)
      .orderBy(asc(issues.sort))
      .limit(3);
    expect(ordered).toHaveLength(3);
    const reversed = [...ordered].reverse();
    await setUserIssues(
      testApp.deps.db,
      user.id,
      reversed.map((issue, index) => ({ issueId: issue.id, starred: index === 0 })),
    );
    const me = await load(user.id, session.id);
    expect(me.issues).toEqual(
      ordered.map((issue, index) => ({ issueId: issue.id, starred: index === 2 })),
    );
  });

  it('needed lists an outdated document', async () => {
    const now = testApp.deps.clock.now();
    const user = await insertUser(testApp.deps.db, {});
    await insertConsents(testApp.deps.db, user.id, { terms: '2000-01-01' });
    const { row: session } = await insertSession(testApp.deps.db, {
      userId: user.id,
      authenticatedAt: now,
    });
    const me = await load(user.id, session.id);
    expect(me.consents.needed).toEqual(['terms']);
    expect(me.consents.terms.agreedVersion).toBe('2000-01-01');
  });

  it('aiScreening is declined or not asked', async () => {
    const { user, session } = await newUser();
    const bare = await insertUser(testApp.deps.db, {});
    const { row: bareSession } = await insertSession(testApp.deps.db, { userId: bare.id });
    const bareMe = await load(bare.id, bareSession.id);
    expect(bareMe.consents.aiScreening).toBe('not_asked');
    expect(bareMe.consents.needed).toEqual(['terms', 'content_policy', 'privacy_policy']);
    expect(bareMe.consents.terms.agreedVersion).toBeNull();
    await insertConsent(testApp.deps.db, {
      userId: user.id,
      kind: 'ai_screening',
      granted: false,
    });
    expect((await load(user.id, session.id)).consents.aiScreening).toBe('declined');
  });

  it('session holds no admin key', async () => {
    const { user } = await signInAdmin(testApp.deps.db, 'bearer');
    const { row: session } = await insertSession(testApp.deps.db, { userId: user.id });
    const me = await load(user.id, session.id);
    expect(me.role).toBe('admin');
    expect(Object.keys(me.session).sort()).toEqual(
      ['authenticatedAt', 'expiresAt', 'platform', 'sensitiveActionsUntil'].sort(),
    );
    expect(Object.keys(me)).not.toContain('adminActionsUntil');
  });

  it('an avatar key becomes a Media of 320 by 320 with a presigned url and no blurhash', async () => {
    const key = 'avatars/fixture-user/fixture-avatar.jpg';
    const { user, session } = await newUser({ avatarKey: key });
    const me = await load(user.id, session.id);
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
    const url = new URL(me.avatar?.url ?? '');
    expect(url.pathname).toContain(key);
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
    expect(me.avatarPending).toBe(false);
  });

  it('avatarPending follows avatar_pending_key', async () => {
    const pendingKey = { avatarPendingKey: 'avatars/fixture-user/fixture-pending.jpg' };
    const { user, session } = await newUser(pendingKey);
    expect((await load(user.id, session.id)).avatarPending).toBe(true);

    const other = await newUser();
    await insertUpload(testApp.deps.db, {
      userId: other.user.id,
      consumedAt: testApp.deps.clock.now(),
    });
    expect((await load(other.user.id, other.session.id)).avatarPending).toBe(true);

    const finished = await newUser();
    await insertUpload(testApp.deps.db, {
      userId: finished.user.id,
      consumedAt: testApp.deps.clock.now(),
      bytes: 123_456,
    });
    await insertUpload(testApp.deps.db, { userId: finished.user.id });
    expect((await load(finished.user.id, finished.session.id)).avatarPending).toBe(false);
  });

  it('handleChangeAvailableAt', async () => {
    const now = testApp.deps.clock.now();
    const changed = shift(now, -10 * DAY_MS);
    const recent = await newUser({ handle: 'fixture_recent', handleChangedAt: changed });
    expect((await load(recent.user.id, recent.session.id)).handleChangeAvailableAt).toBe(
      shift(changed, 30 * DAY_MS).toISOString(),
    );
    const old = await newUser({ handle: 'fixture_old', handleChangedAt: shift(now, -31 * DAY_MS) });
    expect((await load(old.user.id, old.session.id)).handleChangeAvailableAt).toBeNull();
  });

  it("a suspended user's Me carries the reason and since", async () => {
    const now = testApp.deps.clock.now();
    const { user, session } = await newUser({
      status: 'suspended',
      suspendedAt: now,
      suspendedReason: 'spam',
    });
    const me = await load(user.id, session.id);
    expect(me.status).toBe('suspended');
    expect(me.suspension).toEqual({ reason: 'spam', since: now.toISOString() });
  });

  it('loadMe throws unauthenticated for a deleting user', async () => {
    const { user, session } = await newUser();
    await testApp.deps.db
      .update(users)
      .set({ status: 'deleting', deletionRequestedAt: testApp.deps.clock.now() })
      .where(eq(users.id, user.id));
    await expectUnauthenticated(load(user.id, session.id));
  });

  it('loadMe throws unauthenticated when the session row is gone', async () => {
    const { user, session } = await newUser();
    await testApp.deps.db.delete(sessions).where(eq(sessions.id, session.id));
    await expectUnauthenticated(load(user.id, session.id));
    // Another user's session is not this user's.
    const other = await newUser();
    await expectUnauthenticated(load(user.id, other.session.id));
  });

  it('loadMe throws unauthenticated when the user row is gone', async () => {
    const { user, session } = await newUser();
    await testApp.deps.db.delete(users).where(eq(users.id, user.id));
    await expectUnauthenticated(load(user.id, session.id));
  });

  it('loadConsentState ignores declined document rows', async () => {
    const now = testApp.deps.clock.now();
    const user = await insertUser(testApp.deps.db, {});
    await insertConsent(testApp.deps.db, {
      userId: user.id,
      kind: 'privacy_policy',
      version: '2000-01-01',
      createdAt: shift(now, -2 * MINUTE_MS),
    });
    // A newer row, written by hand, that does not grant.
    await insertConsent(testApp.deps.db, {
      userId: user.id,
      kind: 'privacy_policy',
      version: LEGAL_VERSIONS.privacy_policy,
      granted: false,
      createdAt: shift(now, -MINUTE_MS),
    });
    const state = await loadConsentState(testApp.deps.db, user.id);
    expect(state.privacyPolicy).toEqual({
      agreedVersion: '2000-01-01',
      currentVersion: LEGAL_VERSIONS.privacy_policy,
    });
    expect(state.needed).toEqual(['terms', 'content_policy', 'privacy_policy']);
    expect(state.aiScreening).toBe('not_asked');
  });

  it('loadConsentState takes the newest granted version of each document', async () => {
    const now = testApp.deps.clock.now();
    const user = await insertUser(testApp.deps.db, {});
    await insertConsent(testApp.deps.db, {
      userId: user.id,
      kind: 'terms',
      version: '2000-01-01',
      createdAt: shift(now, -2 * MINUTE_MS),
    });
    await insertConsent(testApp.deps.db, {
      userId: user.id,
      kind: 'terms',
      version: LEGAL_VERSIONS.terms,
      createdAt: shift(now, -MINUTE_MS),
    });
    const state = await loadConsentState(testApp.deps.db, user.id);
    expect(state.terms.agreedVersion).toBe(LEGAL_VERSIONS.terms);
    expect(state.needed).toEqual(['content_policy', 'privacy_policy']);
  });
});

describe('loadMe location', () => {
  it('every Me carries location', async () => {
    const email = 'fixture.signin.location@example.test';
    const user = await insertUser(testApp.deps.db, {
      email,
      locationPrecision: 'exact',
      districtsStaleAt: testApp.deps.clock.now(),
    });
    await insertConsents(testApp.deps.db, user.id);
    const fixture = await insertLocationFixture(testApp.deps.db, testApp.deps.clock.now());
    await setUserDistricts(testApp.deps.db, user.id, [
      fixture.city.id,
      fixture.countyA.id,
      fixture.state.id,
      fixture.special.id,
    ]);

    // A sign-in's SessionInfo.me, through E-AUTH-01 and E-AUTH-02.
    const started = await testApp.request.post('/v1/auth/email/start', { body: { email } });
    expect(started.status).toBe(200);
    const { pendingToken } = await started.json<{ pendingToken: string }>();
    const code = testApp.fakes.mailer.codeFor(email) ?? '';
    const verified = await testApp.request.post('/v1/auth/email/verify', {
      body: { pendingToken, code },
    });
    expect(verified.status).toBe(200);
    const info = SessionInfoSchema.parse(await verified.json());
    expect(info.me.location).toEqual({
      isSet: true,
      precision: 'exact',
      districtCount: 4,
      bbox: [-40.1, 29.9, -39.8, 30.2],
      placeName: 'Fixture City',
      officeCount: 3,
      needsConfirmation: true,
    });

    const response = await testApp.request.get('/v1/me', {
      auth: { kind: 'bearer', token: info.token ?? '' },
    });
    expect(response.status).toBe(200);
    expect(MeSchema.parse(await response.json()).location).toEqual(info.me.location);
  });
});
