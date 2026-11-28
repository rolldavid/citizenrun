import { authChallenges, authIdentities, users } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, LEGAL_VERSIONS, MeSchema } from '@citizenrun/shared';
import type { ErrorCode, SessionInfo } from '@citizenrun/shared';
import { sha256Hex } from '@citizenrun/shared/crypto';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertChallenge, insertEmailCode, insertIdentity } from '../../testing/factories.ts';
import { FIXTURE_GOOGLE_CLIENT_IDS, FakeIdentityProviders } from '../../testing/fakes/identity.ts';
import type { GoogleTokenClaims } from '../../testing/fakes/identity.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-AUTH-08: TEST-api-AUTH; TEST-auth-providers `Google token checks`, `linking matrix` through the
// route, `a nonce is used once`, `providers without configuration`; CTL-13.
const PATH = '/v1/auth/google';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FLAG_CACHE_MS = 30_000;
// auth.token allows 60 an hour per address.
const PER_ADDRESS_HOURLY = 60;
// Five new accounts a UTC day per address (SIGNUPS_PER_ADDRESS_PER_DAY).
const SIGNUPS_PER_DAY = 5;

type NonceResult = { nonce: string; nonceHash: string; state: string; expiresAt: string };

function signup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    age: { method: 'none', sourceTier: null },
    agreements: {
      termsVersion: LEGAL_VERSIONS.terms,
      contentPolicyVersion: LEGAL_VERSIONS.content_policy,
      privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
    },
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
  const subject = `2000000000000000${String(nextSubject).padStart(3, '0')}`;
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

function postGoogle(
  body: Record<string, unknown>,
  options: TestRequestOptions = {},
  app: TestApp = testApp,
): Promise<TestResponse> {
  return app.request.post(PATH, { ip: freshIp(), body, ...options });
}

/** A sign-up body for a new subject: a token over a fresh nonce and `signup`. */
async function newSubjectBody(
  claims: GoogleTokenClaims = {},
  extra: Record<string, unknown> = {},
): Promise<{ body: Record<string, unknown>; nonce: NonceResult; subject: string }> {
  const nonce = await issueNonce();
  const subject = typeof claims.sub === 'string' ? claims.sub : freshSubject();
  const body = {
    idToken: await identity.googleIdToken({ nonce: nonce.nonceHash, ...claims, sub: subject }),
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

async function googleIdentity(subject: string) {
  const [row] = await testApp.deps.db
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, 'google'), eq(authIdentities.subject, subject)));
  return row;
}

async function userOf(subject: string) {
  const found = await googleIdentity(subject);
  if (found === undefined) {
    return undefined;
  }
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, found.userId));
  return row;
}

describe('POST /v1/auth/google', () => {
  it('ok', async () => {
    const { body, nonce, subject } = await newSubjectBody();
    const info = await expectSignedIn(await postGoogle(body));
    expect(info.created).toBe(true);
    expect(info.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await googleIdentity(subject);
    expect(row).toMatchObject({ clientId: null, refreshTokenEnc: null, isPrivateEmail: null });
    expect((await nonceRow(nonce))?.usedAt).not.toBeNull();
    // Google needs no outbound call: the key set is local.
    expect(testApp.fakes.outbound.calls).toHaveLength(0);
  });

  it('a web sign-in sets the cookie and sends no token', async () => {
    const nonce = await issueNonce('web/1.4.0');
    const response = await postGoogle(
      {
        idToken: await identity.googleIdToken({ nonce: nonce.nonceHash, sub: freshSubject() }),
        nonce: nonce.nonce,
        signup: signup(),
      },
      { client: 'web/1.4.0' },
    );
    const info = await expectSignedIn(response);
    expect(info.token).toBeNull();
    expect(response.headers.get('set-cookie')).toMatch(/^__Host-os_session=/);
  });

  it('Google token checks', async () => {
    // Both issuer forms are accepted.
    for (const iss of ['https://accounts.google.com', 'accounts.google.com']) {
      const { body } = await newSubjectBody({ iss });
      await expectSignedIn(await postGoogle(body));
    }
    // The iOS client id is an audience too.
    const ios = await newSubjectBody({ aud: FIXTURE_GOOGLE_CLIENT_IDS[1] });
    await expectSignedIn(await postGoogle(ios.body));
    const nonce = await issueNonce();
    const now = Math.floor(testApp.deps.clock.now().getTime() / SECOND_MS);
    const refused = [
      await identity.googleIdToken({
        nonce: nonce.nonceHash,
        aud: 'other.apps.googleusercontent.com',
      }),
      await identity.googleIdToken({ nonce: nonce.nonceHash, iss: 'https://appleid.apple.com' }),
      await identity.googleIdToken({ nonce: nonce.nonceHash }, { foreignKey: true }),
      await identity.googleIdToken({ nonce: nonce.nonceHash }, { alg: 'RS384' }),
      await identity.googleIdToken({ nonce: nonce.nonceHash, iat: now - 700, exp: now - 61 }),
    ];
    for (const idToken of refused) {
      await expectError(
        await postGoogle({ idToken, nonce: nonce.nonce, signup: signup() }),
        'identity_token_invalid',
      );
    }
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    const accepted = await identity.googleIdToken({
      nonce: nonce.nonceHash,
      sub: freshSubject(),
      iat: now - 700,
      exp: now - 59,
    });
    await expectSignedIn(
      await postGoogle({ idToken: accepted, nonce: nonce.nonce, signup: signup() }),
    );
  });

  it('wrong audience refused', async () => {
    const nonce = await issueNonce();
    const idToken = await identity.googleIdToken({
      nonce: nonce.nonceHash,
      aud: 'org.example.fixture',
    });
    await expectError(await postGoogle({ idToken, nonce: nonce.nonce }), 'identity_token_invalid');
  });

  it('wrong issuer refused', async () => {
    const nonce = await issueNonce();
    const idToken = await identity.googleIdToken({
      nonce: nonce.nonceHash,
      iss: 'https://evil.example.test',
    });
    await expectError(await postGoogle({ idToken, nonce: nonce.nonce }), 'identity_token_invalid');
  });

  it('expired refused', async () => {
    const nonce = await issueNonce();
    const now = Math.floor(testApp.deps.clock.now().getTime() / SECOND_MS);
    const idToken = await identity.googleIdToken({
      nonce: nonce.nonceHash,
      iat: now - 3600,
      exp: now - 61,
    });
    await expectError(await postGoogle({ idToken, nonce: nonce.nonce }), 'identity_token_invalid');
  });

  it('nonce mismatch refused', async () => {
    const nonce = await issueNonce();
    for (const claim of [sha256Hex('another'), undefined]) {
      const idToken = await identity.googleIdToken({ nonce: claim, sub: freshSubject() });
      await expectError(
        await postGoogle({ idToken, nonce: nonce.nonce, signup: signup() }),
        'nonce_invalid',
      );
    }
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('nonce checks', async () => {
    const expired = await insertChallenge(testApp.deps.db, {
      kind: 'nonce',
      platform: 'ios',
      expiresAt: new Date(Date.now() - MINUTE_MS),
    });
    const secret = expired.secret ?? '';
    const idToken = await identity.googleIdToken({ nonce: sha256Hex(secret), sub: freshSubject() });
    await expectError(
      await postGoogle({ idToken, nonce: secret, signup: signup() }),
      'nonce_invalid',
    );
    const { body } = await newSubjectBody();
    await expectSignedIn(await postGoogle(body));
    await expectError(await postGoogle(body), 'nonce_invalid');
  });

  it('a token replayed with the same nonce refused', async () => {
    const { body, nonce } = await newSubjectBody();
    await expectSignedIn(await postGoogle(body));
    const replay = await postGoogle(body);
    await expectError(replay, 'nonce_invalid');
    const other = await identity.googleIdToken({ nonce: nonce.nonceHash, sub: freshSubject() });
    await expectError(await postGoogle({ ...body, idToken: other }), 'nonce_invalid');
  });

  it('linking matrix', async () => {
    // email_verified with @gmail.com links to the user holding the address (row 5).
    const gmailHolder = await insertUser(testApp.deps.db, {
      email: 'fixture-gmail-holder@gmail.com',
    });
    const gmail = await newSubjectBody({
      email: 'Fixture-Gmail-Holder@gmail.com',
      email_verified: true,
    });
    expect((await expectSignedIn(await postGoogle(gmail.body))).created).toBe(false);
    expect((await googleIdentity(gmail.subject))?.userId).toBe(gmailHolder.id);

    // Another domain without hd: a separate user with no email (row 7).
    const domainHolder = await insertUser(testApp.deps.db, { email: 'person@example.test' });
    const noHd = await newSubjectBody({ email: 'person@example.test', email_verified: true });
    expect((await expectSignedIn(await postGoogle(noHd.body))).created).toBe(true);
    const separate = await userOf(noHd.subject);
    expect(separate?.id).not.toBe(domainHolder.id);
    expect(separate?.email).toBeNull();
    expect(await googleIdentity(noHd.subject)).toMatchObject({
      email: 'person@example.test',
      emailVerified: true,
    });

    // The same with hd links.
    const hdHolder = await insertUser(testApp.deps.db, { email: 'staff@example.test' });
    const withHd = await newSubjectBody({
      email: 'staff@example.test',
      email_verified: true,
      hd: 'example.test',
    });
    expect((await expectSignedIn(await postGoogle(withHd.body))).created).toBe(false);
    expect((await googleIdentity(withHd.subject))?.userId).toBe(hdHolder.id);

    // An unverified gmail address: a separate user with no email.
    const unverified = await newSubjectBody({
      email: 'fixture-gmail-holder@gmail.com',
      email_verified: false,
    });
    expect((await expectSignedIn(await postGoogle(unverified.body))).created).toBe(true);
    expect((await userOf(unverified.subject))?.email).toBeNull();

    // A verified gmail address no user holds: the new user gets it (row 6).
    const fresh = await newSubjectBody({
      email: 'fixture-gmail-fresh@gmail.com',
      email_verified: true,
    });
    await expectSignedIn(await postGoogle(fresh.body));
    expect((await userOf(fresh.subject))?.email).toBe('fixture-gmail-fresh@gmail.com');

    // Each attachment is told once, with the provider.
    const jobs = await queuedJobs(testApp.deps.db, 'notify.email');
    expect(jobs.map((job) => job.data)).toEqual([
      { template: 'signin_method_added', userId: gmailHolder.id, provider: 'google' },
      { template: 'signin_method_added', userId: hdHolder.id, provider: 'google' },
    ]);
  });

  it('signup details can be added on retry', async () => {
    const { body, nonce } = await newSubjectBody();
    const { signup: details, ...withoutSignup } = body;
    await expectError(await postGoogle(withoutSignup), 'signup_details_required');
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    await expectError(
      await postGoogle({
        ...withoutSignup,
        signup: signup({
          agreements: {
            termsVersion: 'old',
            contentPolicyVersion: 'old',
            privacyPolicyVersion: 'old',
          },
        }),
      }),
      'consent_version_outdated',
    );
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    expect(
      (await expectSignedIn(await postGoogle({ ...withoutSignup, signup: details }))).created,
    ).toBe(true);
  });

  it('reauth for another user answers 409 and consumes the nonce', async () => {
    const owner = await insertUser(testApp.deps.db);
    const subject = freshSubject();
    await insertIdentity(testApp.deps.db, {
      userId: owner.id,
      provider: 'google',
      subject,
      email: null,
      emailVerified: null,
    });
    const viewer = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, viewer, 'bearer');
    const nonce = await issueNonce();
    const idToken = await identity.googleIdToken({ nonce: nonce.nonceHash, sub: subject });
    await expectError(
      await postGoogle({ idToken, nonce: nonce.nonce, intent: 'reauth' }),
      'unauthenticated',
    );
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    await expectError(
      await postGoogle({ idToken, nonce: nonce.nonce, intent: 'reauth' }, { auth }),
      'reauth_mismatch',
    );
    expect((await nonceRow(nonce))?.usedAt).not.toBeNull();
    // A new subject never satisfies reauth.
    const unknown = await newSubjectBody({}, { intent: 'reauth' });
    await expectError(await postGoogle(unknown.body, { auth }), 'reauth_mismatch');
    expect(await googleIdentity(unknown.subject)).toBeUndefined();
  });

  it('no sign-in while deleting', async () => {
    const deleting = await insertUser(testApp.deps.db, {
      status: 'deleting',
      deletionRequestedAt: new Date(),
    });
    const subject = freshSubject();
    await insertIdentity(testApp.deps.db, {
      userId: deleting.id,
      provider: 'google',
      subject,
      email: null,
      emailVerified: null,
    });
    const nonce = await issueNonce();
    await expectError(
      await postGoogle({
        idToken: await identity.googleIdToken({ nonce: nonce.nonceHash, sub: subject }),
        nonce: nonce.nonce,
      }),
      'account_deleting',
    );
    expect((await nonceRow(nonce))?.usedAt).not.toBeNull();
  });

  it('the sixth account from one address in a day', async () => {
    const ip = '203.0.113.170';
    for (let n = 1; n <= SIGNUPS_PER_DAY; n += 1) {
      const { body } = await newSubjectBody();
      expect((await expectSignedIn(await postGoogle(body, { ip }))).created, String(n)).toBe(true);
    }
    const { body, nonce } = await newSubjectBody();
    await expectError(await postGoogle(body, { ip }), 'signup_limit_reached');
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('the state rule applies', async () => {
    await testApp.deps.db.execute(
      sql`update state_rules set signup = 'withhold' where state = 'MS'`,
    );
    testApp.deps.clock.advance(FLAG_CACHE_MS);
    const { body, nonce } = await newSubjectBody({}, { signup: signup({ state: 'MS' }) });
    await expectError(await postGoogle(body), 'unavailable_in_state');
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('providers without configuration', async () => {
    const app = await makeApp({ GOOGLE_CLIENT_IDS: undefined });
    testApp = app;
    const nonce = await issueNonce('ios/1.4.0', app);
    await expectError(
      await postGoogle(
        {
          idToken: await identity.googleIdToken({ nonce: nonce.nonceHash, sub: freshSubject() }),
          nonce: nonce.nonce,
          signup: signup(),
        },
        {},
        app,
      ),
      'provider_not_configured',
    );
    expect(app.fakes.outbound.calls).toHaveLength(0);
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
    const { pendingToken } = await insertEmailCode(app.deps.db, app.deps.keyRing, {
      email: 'google-off@example.test',
      code: '246801',
    });
    const verified = await app.request.post('/v1/auth/email/verify', {
      ip: freshIp(),
      body: { pendingToken, code: '246801', signup: signup() },
    });
    expect(verified.status).toBe(200);
  });

  it('markers reach no log line', async () => {
    const value = marker();
    const { body, nonce } = await newSubjectBody({
      email: `${value}@gmail.com`,
      email_verified: true,
    });
    await expectSignedIn(await postGoogle(body));
    for (const line of testApp.logs) {
      expect(line.raw.toLowerCase()).not.toContain(value.toLowerCase());
      expect(line.raw).not.toContain(String(body['idToken']));
      expect(line.raw).not.toContain(nonce.nonce);
    }
  });

  it('rejects invalid input', async () => {
    const nonce = await issueNonce();
    const idToken = await identity.googleIdToken({ nonce: nonce.nonceHash });
    const valid = { idToken, nonce: nonce.nonce };
    const cases: [Record<string, unknown>, string, string][] = [
      [{ nonce: nonce.nonce }, 'idToken', 'required'],
      [{ ...valid, idToken: 'x'.repeat(4097) }, 'idToken', 'too_long'],
      [{ idToken }, 'nonce', 'required'],
      [{ ...valid, nonce: `${nonce.nonce}x` }, 'nonce', 'invalid_format'],
      [{ ...valid, intent: 'add_email' }, 'intent', 'invalid_value'],
      [{ ...valid, signup: 'yes' }, 'signup', 'invalid_type'],
    ];
    for (const [body, field, code] of cases) {
      const response = await postGoogle(body);
      expect(response.status, field).toBe(400);
      const envelope = await response.json<{
        error: { code: string; fields: Record<string, string> };
      }>();
      expect(envelope.error.code).toBe('invalid_request');
      expect(envelope.error.fields[field], field).toBe(code);
    }
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('envelope on every error', async () => {
    await expectError(await postGoogle({}), 'invalid_request');
    await expectError(await postGoogle({}, { client: null }), 'client_header_required');
    await expectError(
      await postGoogle({}, { client: 'web/1.4.0', origin: 'https://elsewhere.example.test' }),
      'origin_rejected',
    );
  });

  it('rate-limited', async () => {
    const ip = '203.0.113.171';
    for (let n = 1; n <= PER_ADDRESS_HOURLY; n += 1) {
      expect((await postGoogle({}, { ip })).status, `call ${String(n)}`).toBe(400);
    }
    const limited = await postGoogle({}, { ip });
    await expectError(limited, 'rate_limited');
    const now = testApp.deps.clock.now().getTime();
    const toHourEnd = Math.ceil((Math.ceil(now / HOUR_MS) * HOUR_MS - now) / SECOND_MS);
    expect(limited.headers.get('retry-after')).toBe(String(toHourEnd));
  });
});
