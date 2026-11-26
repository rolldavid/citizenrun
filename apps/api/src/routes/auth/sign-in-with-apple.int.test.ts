import { decodeJwt } from 'jose';
import { authChallenges, authIdentities, users } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, LEGAL_VERSIONS, MeSchema } from '@citizenrun/shared';
import type { ErrorCode, SessionInfo } from '@citizenrun/shared';
import { decryptRefreshToken, sha256Hex } from '@citizenrun/shared/crypto';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertChallenge, insertEmailCode, insertIdentity } from '../../testing/factories.ts';
import {
  FIXTURE_APPLE,
  FIXTURE_GOOGLE_CLIENT_IDS,
  FakeIdentityProviders,
} from '../../testing/fakes/identity.ts';
import type { AppleTokenClaims, SignOptions } from '../../testing/fakes/identity.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-AUTH-04: TEST-api-AUTH; TEST-auth-providers `Apple token checks`, `a nonce is used once`,
// `Apple refresh token is kept encrypted with its client id`, `Apple name only the first time`,
// `notice when a method is attached`, `providers without configuration`; CTL-13, CTL-15, CTL-16.
const PATH = '/v1/auth/apple';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FLAG_CACHE_MS = 30_000;
// auth.token allows 60 an hour per address.
const PER_ADDRESS_HOURLY = 60;
// Five new accounts a UTC day per address (SIGNUPS_PER_ADDRESS_PER_DAY).
const SIGNUPS_PER_DAY = 5;
const STANDARD_LOG_KEYS = ['event', 'level', 'service', 'time'];

type NonceResult = { nonce: string; nonceHash: string; state: string; expiresAt: string };

function signup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    age: { method: 'self_declared', sourceTier: 'self' },
    agreements: {
      termsVersion: LEGAL_VERSIONS.terms,
      contentPolicyVersion: LEGAL_VERSIONS.content_policy,
      privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
    },
    aiScreening: true,
    ...overrides,
  };
}

let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost % 250)}`;
  nextHost += 1;
  return ip;
}

let nextSubject = 1;
function freshSubject(): string {
  const subject = `000123.fixture.${String(nextSubject)}`;
  nextSubject += 1;
  return subject;
}

let identity: FakeIdentityProviders;
let testApp: TestApp;

async function makeApp(env: Record<string, string | undefined> = {}): Promise<TestApp> {
  const clock = new FakeClock();
  identity = new FakeIdentityProviders(clock);
  const app = await createTestApp({
    clock,
    identity,
    env: { ...identity.appleEnv(), ...identity.googleEnv(), ...env },
  });
  identity.registerAppleEndpoints(app.fakes.outbound);
  return app;
}

beforeEach(async () => {
  testApp = await makeApp();
});

async function issueNonce(client = 'ios/1.4.0', app: TestApp = testApp): Promise<NonceResult> {
  const response = await app.request.post('/v1/auth/nonce', { ip: freshIp(), body: {}, client });
  expect(response.status).toBe(200);
  return response.json<NonceResult>();
}

function appleToken(
  nonce: NonceResult,
  claims: AppleTokenClaims = {},
  options: SignOptions = {},
): Promise<string> {
  return identity.appleIdToken({ nonce: nonce.nonceHash, ...claims }, options);
}

function postApple(
  body: Record<string, unknown>,
  options: TestRequestOptions = {},
  app: TestApp = testApp,
): Promise<TestResponse> {
  return app.request.post(PATH, { ip: freshIp(), body, ...options });
}

/** A full sign-up body for a new subject: a token over a fresh nonce, a code and `signup`. */
async function newSubjectBody(
  claims: AppleTokenClaims = {},
  extra: Record<string, unknown> = {},
): Promise<{ body: Record<string, unknown>; nonce: NonceResult; subject: string }> {
  const nonce = await issueNonce();
  const subject = typeof claims.sub === 'string' ? claims.sub : freshSubject();
  const body = {
    idToken: await appleToken(nonce, { sub: subject, ...claims }),
    code: 'fixture-code',
    nonce: nonce.nonce,
    signup: signup(),
    ...extra,
  };
  return { body, nonce, subject };
}

async function expectError(response: TestResponse, code: ErrorCode): Promise<void> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body: unknown = await response.json();
  expect(body).toEqual({
    error: { code, message: ERROR_CODES[code].message, fields: expect.any(Object) },
  });
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
}

async function expectSignedIn(response: TestResponse): Promise<SessionInfo> {
  expect(response.status).toBe(200);
  const body = await response.json<SessionInfo>();
  MeSchema.parse(body.me);
  return body;
}

async function nonceRow(nonce: NonceResult) {
  const [row] = await testApp.deps.db
    .select()
    .from(authChallenges)
    .where(eq(authChallenges.secretHash, nonce.nonceHash));
  return row;
}

async function appleIdentity(subject: string) {
  const [row] = await testApp.deps.db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, 'apple'), eq(authIdentities.subject, subject)));
  return row;
}

async function userOf(subject: string) {
  const found = await appleIdentity(subject);
  if (found === undefined) {
    return undefined;
  }
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, found.userId));
  return row;
}

async function userCount(): Promise<number> {
  return (await testApp.deps.db.select({ id: users.id }).from(users)).length;
}

describe('POST /v1/auth/apple', () => {
  it('ok', async () => {
    const { body } = await newSubjectBody();
    const info = await expectSignedIn(await postApple(body));
    expect(Object.keys(info).sort()).toEqual(['created', 'expiresAt', 'me', 'token']);
    expect(info.created).toBe(true);
    expect(info.token).toMatch(TOKEN_PATTERN);
  });

  it('an iOS token for a new subject signs up', async () => {
    const { body, nonce, subject } = await newSubjectBody();
    const info = await expectSignedIn(await postApple(body));
    expect(info.created).toBe(true);
    const row = await appleIdentity(subject);
    expect(row?.clientId).toBe(FIXTURE_APPLE.bundleId);
    const blob = row?.refreshTokenEnc ?? null;
    expect(blob).not.toBeNull();
    expect(decryptRefreshToken(testApp.deps.keyRing, blob ?? new Uint8Array(), subject)).toBe(
      'fixture-refresh-1',
    );
    expect(identity.exchanges).toHaveLength(1);
    expect(identity.exchanges[0]).toMatchObject({
      clientId: FIXTURE_APPLE.bundleId,
      code: 'fixture-code',
      grantType: 'authorization_code',
      redirectUri: null,
    });
    expect((await nonceRow(nonce))?.usedAt).not.toBeNull();
    const user = await userOf(subject);
    expect(user?.ageResult).toBe('adult');
    expect(user?.onboardingStep).toBe('photo');
  });

  it('the refresh token is stored encrypted with its client id', async () => {
    const { body, subject } = await newSubjectBody();
    await expectSignedIn(await postApple(body));
    const row = await appleIdentity(subject);
    const stored = Buffer.from(row?.refreshTokenEnc ?? new Uint8Array());
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.includes(Buffer.from('fixture-refresh-1'))).toBe(false);
    expect(row?.clientId).toBe(FIXTURE_APPLE.bundleId);
    // The client secret the token endpoint received lives 3,600 seconds.
    const secret = decodeJwt(identity.exchanges[0]?.clientSecret ?? '');
    expect((secret.exp ?? 0) - (secret.iat ?? 0)).toBe(3600);
    expect(secret.sub).toBe(FIXTURE_APPLE.bundleId);
  });

  it('a web token stores the Services ID', async () => {
    const nonce = await issueNonce('web/1.4.0');
    const subject = freshSubject();
    const response = await postApple(
      {
        idToken: await appleToken(nonce, { sub: subject, aud: FIXTURE_APPLE.servicesId }),
        code: 'fixture-code',
        nonce: nonce.nonce,
        signup: signup(),
      },
      { client: 'web/1.4.0' },
    );
    const info = await expectSignedIn(response);
    expect(info.token).toBeNull();
    expect(response.headers.get('set-cookie')).toMatch(/^__Host-os_session=[A-Za-z0-9_-]{43};/);
    expect((await appleIdentity(subject))?.clientId).toBe(FIXTURE_APPLE.servicesId);
    expect(identity.exchanges).toHaveLength(1);
    expect(identity.exchanges[0]?.clientId).toBe(FIXTURE_APPLE.servicesId);
    expect(identity.exchanges[0]?.redirectUri).toBe(
      'https://app.example.test/v1/auth/apple/callback',
    );
  });

  it('Apple token checks', async () => {
    const nonce = await issueNonce();
    const now = Math.floor(testApp.deps.clock.now().getTime() / SECOND_MS);
    const refused = [
      await appleToken(nonce, {}, { foreignKey: true }),
      await appleToken(nonce, { iss: 'https://evil.example.test' }),
      await appleToken(nonce, { aud: 'org.example.other' }),
      await appleToken(nonce, {}, { alg: 'RS384' }),
      await appleToken(nonce, { iat: now - 700, exp: now - 61 }),
    ];
    for (const idToken of refused) {
      await expectError(
        await postApple({ idToken, code: null, nonce: nonce.nonce, signup: signup() }),
        'identity_token_invalid',
      );
    }
    // A refused token touches neither the nonce nor the token endpoint.
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    expect(testApp.fakes.outbound.calls).toHaveLength(0);
    // clockTolerance: 60.
    const idToken = await appleToken(nonce, { sub: freshSubject(), iat: now - 700, exp: now - 59 });
    await expectSignedIn(
      await postApple({ idToken, code: null, nonce: nonce.nonce, signup: signup() }),
    );
  });

  it('wrong audience refused', async () => {
    const nonce = await issueNonce();
    // A Google client id is an audience Apple's verification never accepts.
    for (const aud of ['org.example.other', FIXTURE_GOOGLE_CLIENT_IDS[0]]) {
      const idToken = await appleToken(nonce, { aud });
      await expectError(
        await postApple({ idToken, code: null, nonce: nonce.nonce }),
        'identity_token_invalid',
      );
    }
  });

  it('wrong issuer refused', async () => {
    const nonce = await issueNonce();
    const idToken = await appleToken(nonce, { iss: 'https://accounts.google.com' });
    await expectError(
      await postApple({ idToken, code: null, nonce: nonce.nonce }),
      'identity_token_invalid',
    );
  });

  it('expired refused', async () => {
    const nonce = await issueNonce();
    const now = Math.floor(testApp.deps.clock.now().getTime() / SECOND_MS);
    const idToken = await appleToken(nonce, { iat: now - 3600, exp: now - 61 });
    await expectError(
      await postApple({ idToken, code: null, nonce: nonce.nonce }),
      'identity_token_invalid',
    );
  });

  it('nonce mismatch refused', async () => {
    const nonce = await issueNonce();
    const other = await issueNonce();
    const idToken = await appleToken(other, { sub: freshSubject() });
    await expectError(
      await postApple({ idToken, code: null, nonce: nonce.nonce, signup: signup() }),
      'nonce_invalid',
    );
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    // A token with no nonce claim, and nonce_supported left as true, is refused as well.
    const bare = await appleToken(nonce, { nonce: undefined });
    await expectError(
      await postApple({ idToken: bare, code: null, nonce: nonce.nonce, signup: signup() }),
      'nonce_invalid',
    );
  });

  it('nonce checks', async () => {
    // A nonce whose hash differs from the claim.
    const issued = await issueNonce();
    const mismatch = await identity.appleIdToken({
      nonce: sha256Hex('another'),
      sub: freshSubject(),
    });
    await expectError(
      await postApple({ idToken: mismatch, code: null, nonce: issued.nonce, signup: signup() }),
      'nonce_invalid',
    );
    // An expired nonce.
    const expired = await insertChallenge(testApp.deps.db, {
      kind: 'nonce',
      platform: 'ios',
      expiresAt: new Date(Date.now() - MINUTE_MS),
    });
    const expiredSecret = expired.secret ?? '';
    const expiredToken = await identity.appleIdToken({
      nonce: sha256Hex(expiredSecret),
      sub: freshSubject(),
    });
    await expectError(
      await postApple({
        idToken: expiredToken,
        code: null,
        nonce: expiredSecret,
        signup: signup(),
      }),
      'nonce_invalid',
    );
    // nonce_supported false with no nonce claim passes the claim check and still consumes the nonce.
    const subject = freshSubject();
    const unsupported = await identity.appleIdToken({ sub: subject, nonce_supported: false });
    const body = { idToken: unsupported, code: null, nonce: issued.nonce, signup: signup() };
    await expectSignedIn(await postApple(body));
    expect((await nonceRow(issued))?.usedAt).not.toBeNull();
    // A used nonce.
    await expectError(await postApple(body), 'nonce_invalid');
  });

  it('a token replayed with the same nonce refused', async () => {
    const { body } = await newSubjectBody();
    await expectSignedIn(await postApple(body));
    await expectError(await postApple(body), 'nonce_invalid');
    expect(identity.exchanges).toHaveLength(1);
  });

  it('a nonce is used once', async () => {
    const { body, nonce } = await newSubjectBody();
    await expectSignedIn(await postApple(body));
    const second = await identity.appleIdToken({ nonce: nonce.nonceHash, sub: freshSubject() });
    await expectError(await postApple({ ...body, idToken: second, code: null }), 'nonce_invalid');
  });

  it('signup details can be added on retry', async () => {
    const { body, nonce, subject } = await newSubjectBody();
    const { signup: details, ...withoutSignup } = body;
    await expectError(await postApple(withoutSignup), 'signup_details_required');
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    expect(await appleIdentity(subject)).toBeUndefined();
    // No exchange is spent on a request that is refused.
    expect(identity.exchanges).toHaveLength(0);
    const info = await expectSignedIn(await postApple({ ...withoutSignup, signup: details }));
    expect(info.created).toBe(true);
  });

  it('a failed exchange still signs in', async () => {
    testApp.fakes.outbound.reset();
    identity.registerAppleEndpoints(testApp.fakes.outbound, { token: 'fail' });
    const { body, subject } = await newSubjectBody();
    const info = await expectSignedIn(await postApple(body));
    expect(info.created).toBe(true);
    expect(identity.exchanges).toHaveLength(1);
    const row = await appleIdentity(subject);
    expect(row?.refreshTokenEnc).toBeNull();
    expect(row?.clientId).toBe(FIXTURE_APPLE.bundleId);
    const warnings = testApp.logs.filter(
      (line) => line.parsed['event'] === 'auth.apple_exchange_failed',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.parsed['level']).toBe('warn');
    expect(Object.keys(warnings[0]?.parsed ?? {}).sort()).toEqual(
      [...STANDARD_LOG_KEYS, 'errorClass'].sort(),
    );
  });

  it('a later exchange replaces the stored refresh token', async () => {
    const { body, subject } = await newSubjectBody();
    await expectSignedIn(await postApple(body));
    const nonce = await issueNonce();
    const again = await expectSignedIn(
      await postApple({
        idToken: await appleToken(nonce, { sub: subject }),
        code: 'fixture-code-2',
        nonce: nonce.nonce,
      }),
    );
    expect(again.created).toBe(false);
    const blob = (await appleIdentity(subject))?.refreshTokenEnc ?? new Uint8Array();
    expect(decryptRefreshToken(testApp.deps.keyRing, blob, subject)).toBe('fixture-refresh-2');
  });

  it('the name is applied only to a new user', async () => {
    const { body, subject } = await newSubjectBody(
      {},
      { name: { givenName: 'Ada​', familyName: 'Lovelace ✔' } },
    );
    await expectSignedIn(await postApple(body));
    expect((await userOf(subject))?.name).toBe('Ada Lovelace');
    const nonce = await issueNonce();
    const later = await expectSignedIn(
      await postApple({
        idToken: await appleToken(nonce, { sub: subject }),
        code: null,
        nonce: nonce.nonce,
        name: { givenName: 'Grace', familyName: 'Hopper' },
      }),
    );
    expect(later.created).toBe(false);
    expect((await userOf(subject))?.name).toBe('Ada Lovelace');
  });

  it('an overlong name is dropped and the sign-in goes on', async () => {
    const { body, subject } = await newSubjectBody(
      {},
      { name: { givenName: 'a'.repeat(30), familyName: 'b'.repeat(30) } },
    );
    const info = await expectSignedIn(await postApple(body));
    expect(info.created).toBe(true);
    expect((await userOf(subject))?.name).toBeNull();
  });

  it('linking', async () => {
    // A verified relay email that no user holds: the new user gets it.
    const relay = await newSubjectBody({
      email: 'relay-one@example.test',
      email_verified: 'true',
      is_private_email: 'true',
    });
    await expectSignedIn(await postApple(relay.body));
    expect((await userOf(relay.subject))?.email).toBe('relay-one@example.test');

    // An unverified email: a user with no email (row 7); the identity keeps it for audit.
    const unverified = await newSubjectBody({
      email: 'unverified@example.test',
      email_verified: false,
    });
    await expectSignedIn(await postApple(unverified.body));
    expect((await userOf(unverified.subject))?.email).toBeNull();
    expect(await appleIdentity(unverified.subject)).toMatchObject({
      email: 'unverified@example.test',
      emailVerified: false,
    });

    // A verified non-relay email equal to an existing user's links (row 5) and tells the user.
    const holder = await insertUser(testApp.deps.db, { email: 'holder@example.test' });
    const before = await userCount();
    const linked = await newSubjectBody({ email: 'Holder@example.test', email_verified: true });
    const info = await expectSignedIn(await postApple(linked.body));
    expect(info.created).toBe(false);
    expect(await userCount()).toBe(before);
    expect((await appleIdentity(linked.subject))?.userId).toBe(holder.id);
    const jobs = await queuedJobs(testApp.deps.db, 'notify.email');
    expect(jobs.map((job) => job.data)).toEqual([
      { template: 'signin_method_added', userId: holder.id, provider: 'apple' },
    ]);

    // A verified relay email equal to an existing user's: a second user, nothing attached (D-462).
    const owner = await insertUser(testApp.deps.db, { email: 'taken-relay@example.test' });
    const separate = await newSubjectBody({
      email: 'taken-relay@example.test',
      email_verified: true,
      is_private_email: true,
    });
    const second = await expectSignedIn(await postApple(separate.body));
    expect(second.created).toBe(true);
    const created = await userOf(separate.subject);
    expect(created?.id).not.toBe(owner.id);
    expect(created?.email).toBeNull();
    const ownerApple = await testApp.deps.db
      .select()
      .from(authIdentities)
      .where(and(eq(authIdentities.userId, owner.id), eq(authIdentities.provider, 'apple')));
    expect(ownerApple).toHaveLength(0);
    expect(await queuedJobs(testApp.deps.db, 'notify.email')).toHaveLength(1);
  });

  it('notice when a method is attached', async () => {
    const holder = await insertUser(testApp.deps.db, { email: 'notice@example.test' });
    const linked = await newSubjectBody({ email: 'notice@example.test', email_verified: 'true' });
    await expectSignedIn(await postApple(linked.body));
    const jobs = await queuedJobs(testApp.deps.db, 'notify.email');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({
      template: 'signin_method_added',
      userId: holder.id,
      provider: 'apple',
    });
  });

  it('an unverified email never becomes admin', async () => {
    const unverified = await newSubjectBody({
      email: 'admin@example.test',
      email_verified: false,
    });
    const info = await expectSignedIn(await postApple(unverified.body));
    expect(info.me.role).toBe('user');
    const user = await userOf(unverified.subject);
    expect(user?.email).toBeNull();
    expect(user?.role).toBe('user');
    expect(testApp.logs.some((line) => line.parsed['event'] === 'auth.admin_bootstrap')).toBe(
      false,
    );
  });

  it('a verified listed email becomes admin and is logged with the user id only', async () => {
    const verified = await newSubjectBody({ email: 'admin@example.test', email_verified: true });
    const info = await expectSignedIn(await postApple(verified.body));
    expect(info.me.role).toBe('admin');
    const user = await userOf(verified.subject);
    const lines = testApp.logs.filter((line) => line.parsed['event'] === 'auth.admin_bootstrap');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.parsed['userId']).toBe(user?.id);
    expect(Object.keys(lines[0]?.parsed ?? {}).sort()).toEqual(
      [...STANDARD_LOG_KEYS, 'userId'].sort(),
    );
  });

  it('reauth for another user answers 409 and consumes the nonce', async () => {
    const owner = await insertUser(testApp.deps.db);
    const subject = freshSubject();
    await insertIdentity(testApp.deps.db, {
      userId: owner.id,
      provider: 'apple',
      subject,
      email: null,
      emailVerified: null,
    });
    const viewer = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, viewer, 'bearer');
    const nonce = await issueNonce();
    const idToken = await appleToken(nonce, { sub: subject });
    // Without a session, reauth is 401 and the nonce is untouched.
    await expectError(
      await postApple({ idToken, code: null, nonce: nonce.nonce, intent: 'reauth' }),
      'unauthenticated',
    );
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    await expectError(
      await postApple(
        { idToken, code: 'fixture-code', nonce: nonce.nonce, intent: 'reauth' },
        { auth },
      ),
      'reauth_mismatch',
    );
    expect((await nonceRow(nonce))?.usedAt).not.toBeNull();
    expect(identity.exchanges).toHaveLength(0);
    // The owner re-authenticates.
    const ownerAuth = await signIn(testApp.deps.db, owner, 'bearer');
    const fresh = await issueNonce();
    const info = await expectSignedIn(
      await postApple(
        {
          idToken: await appleToken(fresh, { sub: subject }),
          code: null,
          nonce: fresh.nonce,
          intent: 'reauth',
        },
        { auth: ownerAuth },
      ),
    );
    expect(info.created).toBe(false);
    expect(info.me.id).toBe(owner.id);
  });

  it('no sign-in while deleting', async () => {
    const deleting = await insertUser(testApp.deps.db, {
      status: 'deleting',
      deletionRequestedAt: new Date(),
    });
    const subject = freshSubject();
    await insertIdentity(testApp.deps.db, {
      userId: deleting.id,
      provider: 'apple',
      subject,
      email: null,
      emailVerified: null,
    });
    const nonce = await issueNonce();
    await expectError(
      await postApple({
        idToken: await appleToken(nonce, { sub: subject }),
        code: 'fixture-code',
        nonce: nonce.nonce,
      }),
      'account_deleting',
    );
    expect((await nonceRow(nonce))?.usedAt).not.toBeNull();
    expect(identity.exchanges).toHaveLength(0);
  });

  it('the sixth account from one address in a day', async () => {
    const ip = '203.0.113.150';
    for (let n = 1; n <= SIGNUPS_PER_DAY; n += 1) {
      const { body } = await newSubjectBody();
      const info = await expectSignedIn(await postApple(body, { ip }));
      expect(info.created, `sign-up ${String(n)}`).toBe(true);
    }
    const { body, nonce } = await newSubjectBody();
    await expectError(await postApple(body, { ip }), 'signup_limit_reached');
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('the state rule applies', async () => {
    await testApp.deps.db.execute(
      sql`update state_rules set signup = 'withhold' where state = 'MS'`,
    );
    testApp.deps.clock.advance(FLAG_CACHE_MS);
    const { body, nonce, subject } = await newSubjectBody({}, { signup: signup({ state: 'MS' }) });
    await expectError(await postApple(body), 'unavailable_in_state');
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    expect(await appleIdentity(subject)).toBeUndefined();
  });

  it('providers without configuration', async () => {
    const app = await makeApp({ APPLE_TEAM_ID: undefined });
    testApp = app;
    const nonce = await issueNonce('ios/1.4.0', app);
    const response = await postApple(
      {
        idToken: await appleToken(nonce, { sub: freshSubject() }),
        code: 'fixture-code',
        nonce: nonce.nonce,
        signup: signup(),
      },
      {},
      app,
    );
    await expectError(response, 'provider_not_configured');
    expect(app.fakes.outbound.calls).toHaveLength(0);
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    // Email sign-in still works on the same app.
    const { pendingToken } = await insertEmailCode(app.deps.db, app.deps.keyRing, {
      email: 'still-email@example.test',
      code: '135790',
    });
    const verified = await app.request.post('/v1/auth/email/verify', {
      ip: freshIp(),
      body: { pendingToken, code: '135790', signup: signup() },
    });
    expect(verified.status).toBe(200);
  });

  it('markers reach no log line', async () => {
    const value = marker();
    const { body, nonce } = await newSubjectBody(
      { email: `${value}@example.test`, email_verified: true },
      { code: value, name: { givenName: value, familyName: null } },
    );
    await expectSignedIn(await postApple(body));
    expect(identity.exchanges[0]?.code).toBe(value);
    const idToken = String(body['idToken']);
    for (const line of testApp.logs) {
      const raw = line.raw.toLowerCase();
      expect(raw).not.toContain(value.toLowerCase());
      expect(line.raw).not.toContain(idToken);
      expect(line.raw).not.toContain(nonce.nonce);
      expect(line.raw).not.toContain(nonce.nonceHash);
      expect(line.raw).not.toContain('fixture-refresh');
    }
  });

  it('rejects invalid input', async () => {
    const nonce = await issueNonce();
    const idToken = await appleToken(nonce);
    const valid = { idToken, code: null, nonce: nonce.nonce };
    const cases: [Record<string, unknown>, string, string][] = [
      [{ code: null, nonce: nonce.nonce }, 'idToken', 'required'],
      [{ ...valid, idToken: 'x'.repeat(4097) }, 'idToken', 'too_long'],
      [{ ...valid, idToken: '' }, 'idToken', 'too_short'],
      [{ ...valid, code: 'x'.repeat(513) }, 'code', 'too_long'],
      [{ idToken, nonce: nonce.nonce }, 'code', 'required'],
      [{ ...valid, nonce: 'short' }, 'nonce', 'invalid_format'],
      [
        { ...valid, name: { givenName: 'x'.repeat(101), familyName: null } },
        'name.givenName',
        'too_long',
      ],
      [{ ...valid, intent: 'add_email' }, 'intent', 'invalid_value'],
      [{ ...valid, signup: { aiScreening: true } }, 'signup.age', 'required'],
    ];
    for (const [body, field, code] of cases) {
      const response = await postApple(body);
      expect(response.status, field).toBe(400);
      const envelope = await response.json<{
        error: { code: string; fields: Record<string, string> };
      }>();
      expect(envelope.error.code).toBe('invalid_request');
      expect(envelope.error.fields[field], field).toBe(code);
    }
    const malformed = await testApp.app.request(
      new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OS-Client': 'ios/1.4.0',
          'x-real-ip': freshIp(),
        },
        body: '{"idToken":',
      },
    );
    expect(malformed.status).toBe(400);
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('envelope on every error', async () => {
    await expectError(await postApple({}), 'invalid_request');
    await expectError(await postApple({}, { client: null }), 'client_header_required');
    const nonce = await issueNonce('web/1.4.0');
    await expectError(
      await postApple(
        { idToken: await appleToken(nonce), code: null, nonce: nonce.nonce },
        { client: 'web/1.4.0', origin: 'https://elsewhere.example.test' },
      ),
      'origin_rejected',
    );
    await expectError(
      await postApple({ idToken: 'not-a-token', code: null, nonce: nonce.nonce }),
      'identity_token_invalid',
    );
  });

  it('rate-limited', async () => {
    const ip = '203.0.113.160';
    for (let n = 1; n <= PER_ADDRESS_HOURLY; n += 1) {
      const response = await postApple({}, { ip });
      expect(response.status, `call ${String(n)}`).toBe(400);
    }
    const limited = await postApple({}, { ip });
    await expectError(limited, 'rate_limited');
    const now = testApp.deps.clock.now().getTime();
    const toHourEnd = Math.ceil((Math.ceil(now / HOUR_MS) * HOUR_MS - now) / SECOND_MS);
    expect(limited.headers.get('retry-after')).toBe(String(toHourEnd));
  });
});
