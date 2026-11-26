import {
  appEvents,
  authIdentities,
  emailCodes,
  rateLimits,
  sessions,
  userConsents,
  users,
} from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { LEGAL_VERSIONS, MeSchema } from '@citizenrun/shared';
import type { SessionInfo } from '@citizenrun/shared';
import { newEmailCode, randomToken } from '@citizenrun/shared/crypto';
import { marker } from '@citizenrun/shared/testing';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addressHashOf } from '../../middleware/rate-limit.ts';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertEmailCode, insertIdentity } from '../../testing/factories.ts';
import { queuedJobs } from '../../testing/jobs.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-AUTH-02: TEST-api-AUTH, TEST-auth-email, TEST-sessions, TEST-flags and the cases of CTL-12,
// CTL-14, CTL-16, CTL-46, CTL-76 and INV-24.
const VERIFY = '/v1/auth/email/verify';
const START = '/v1/auth/email/start';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const NINETY_DAYS_S = 7_776_000;
const STANDARD_LOG_KEYS = ['event', 'level', 'service', 'time'];
const FLAG_CACHE_MS = 30_000;

type Signup = {
  age: { method: 'self_declared' | 'store_signal'; sourceTier: 'self' | 'confirmed' | 'declared' };
  agreements: { termsVersion: string; contentPolicyVersion: string; privacyPolicyVersion: string };
  aiScreening: boolean | null;
  state?: string;
};

function signup(overrides: Partial<Signup> = {}): Signup {
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

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

let testApp: TestApp;

beforeEach(async () => {
  testApp = await createTestApp();
  // Noon UTC of the test's day, so no case crosses an hour or a day window.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + 12 * HOUR_MS));
});

/** A live challenge for `email`, ten minutes from the test clock, with a code made here. */
async function challenge(email: string, options: { code?: string; expiresAt?: Date } = {}) {
  const now = testApp.deps.clock.now();
  const code = options.code ?? newEmailCode();
  const { row, pendingToken } = await insertEmailCode(testApp.deps.db, testApp.deps.keyRing, {
    email,
    code,
    expiresAt: options.expiresAt ?? new Date(now.getTime() + 10 * MINUTE_MS),
    lastSentAt: now,
  });
  return { row, pendingToken, code };
}

function verify(
  body: Record<string, unknown>,
  options: TestRequestOptions = {},
): Promise<TestResponse> {
  return testApp.request.post(VERIFY, { ip: freshIp(), body, ...options });
}

async function expectError(
  response: TestResponse,
  status: number,
  code: string,
): Promise<Envelope> {
  expect(response.status).toBe(status);
  const body = await response.json<Envelope>();
  expect(Object.keys(body)).toEqual(['error']);
  expect(Object.keys(body.error).sort()).toEqual(['code', 'fields', 'message']);
  expect(body.error.code).toBe(code);
  expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  return body;
}

async function expectSignedIn(response: TestResponse): Promise<SessionInfo> {
  expect(response.status).toBe(200);
  const body = await response.json<SessionInfo>();
  MeSchema.parse(body.me);
  return body;
}

function otherThan(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

async function challengeRow(id: string) {
  const [row] = await testApp.deps.db.select().from(emailCodes).where(eq(emailCodes.id, id));
  return row;
}

async function userByEmail(email: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.email, email));
  return row;
}

async function sessionsOf(userId: string) {
  return testApp.deps.db.select().from(sessions).where(eq(sessions.userId, userId));
}

async function userCount(): Promise<number> {
  return (await testApp.deps.db.select({ id: users.id }).from(users)).length;
}

describe('POST /v1/auth/email/verify', () => {
  it('signs up a new email', async () => {
    const email = 'new@example.test';
    const { row, pendingToken, code } = await challenge(email);
    const info = await expectSignedIn(await verify({ pendingToken, code, signup: signup() }));
    expect(info.created).toBe(true);
    expect(info.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const now = testApp.deps.clock.now();
    const user = await userByEmail(email);
    expect(user).toMatchObject({
      onboardingStep: 'photo',
      ageMethod: 'self_declared',
      ageResult: 'adult',
      ageSourceTier: 'self',
      ageCheckedAt: now,
      email,
      locale: 'en',
      role: 'user',
      status: 'active',
      handle: null,
    });
    expect(info.me.id).toBe(user?.id);
    expect(info.me.signInMethods).toEqual(['email']);
    expect(info.me.consents.needed).toEqual([]);
    expect(info.me.consents.aiScreening).toBe('granted');
    const consents = await testApp.deps.db
      .select()
      .from(userConsents)
      .where(eq(userConsents.userId, user?.id ?? ''));
    expect(
      consents
        .map((consent) => [consent.kind, consent.version, consent.granted, consent.platform])
        .sort(),
    ).toEqual(
      [
        ['terms', LEGAL_VERSIONS.terms, true, 'ios'],
        ['content_policy', LEGAL_VERSIONS.content_policy, true, 'ios'],
        ['privacy_policy', LEGAL_VERSIONS.privacy_policy, true, 'ios'],
        ['ai_screening', LEGAL_VERSIONS.ai_screening, true, 'ios'],
      ].sort(),
    );
    const events = await testApp.deps.db.select().from(appEvents);
    expect(events.map((event) => [event.name, event.userId, event.props, event.platform])).toEqual([
      ['account_created', user?.id, { method: 'email' }, 'ios'],
    ]);
    // signs in and deletes the code
    expect(await challengeRow(row.id)).toBeUndefined();
    const [session] = await sessionsOf(user?.id ?? '');
    expect(session?.authenticatedAt).toEqual(now);
    expect(info.expiresAt).toBe(session?.expiresAt.toISOString());
  });

  it('new users carry the age record', async () => {
    const { row, pendingToken, code } = await challenge('age@example.test');
    await expectError(await verify({ pendingToken, code }), 422, 'signup_details_required');
    expect((await challengeRow(row.id))?.attempts).toBe(0);
    expect(await userCount()).toBe(0);
    expect(await testApp.deps.db.select().from(sessions)).toEqual([]);
    const info = await expectSignedIn(await verify({ pendingToken, code, signup: signup() }));
    expect(info.created).toBe(true);
    expect(info.me.age?.method).toBe('self_declared');
  });

  it('outdated agreement', async () => {
    const { row, pendingToken, code } = await challenge('outdated@example.test');
    const old = signup();
    old.agreements.termsVersion = '2000-01-01';
    await expectError(
      await verify({ pendingToken, code, signup: old }),
      422,
      'consent_version_outdated',
    );
    expect((await challengeRow(row.id))?.attempts).toBe(0);
    expect(await userCount()).toBe(0);
  });

  it('no store signal on the web', async () => {
    const { row, pendingToken, code } = await challenge('store@example.test');
    const store = signup({ age: { method: 'store_signal', sourceTier: 'confirmed' } });
    const refused = await expectError(
      await verify({ pendingToken, code, signup: store }, { client: 'web/1.4.0' }),
      400,
      'invalid_request',
    );
    expect(refused.error.fields).toEqual({ 'signup.age.method': 'not_allowed' });
    expect((await challengeRow(row.id))?.attempts).toBe(0);
    expect(await userCount()).toBe(0);
  });

  it('five attempts', async () => {
    const first = await challenge('four@example.test');
    for (let n = 0; n < 4; n += 1) {
      await expectError(
        await verify({
          pendingToken: first.pendingToken,
          code: otherThan(first.code),
          signup: signup(),
        }),
        422,
        'code_invalid',
      );
    }
    await expectSignedIn(
      await verify({ pendingToken: first.pendingToken, code: first.code, signup: signup() }),
    );

    const second = await challenge('five@example.test');
    const wrong = {
      pendingToken: second.pendingToken,
      code: otherThan(second.code),
      signup: signup(),
    };
    for (let n = 0; n < 4; n += 1) {
      await expectError(await verify(wrong), 422, 'code_invalid');
    }
    expect((await challengeRow(second.row.id))?.attempts).toBe(4);
    await expectError(await verify(wrong), 422, 'code_attempts_exhausted');
    expect(await challengeRow(second.row.id)).toBeUndefined();
    await expectError(
      await verify({ pendingToken: second.pendingToken, code: second.code, signup: signup() }),
      422,
      'code_expired',
    );
  });

  it('expires in 10 minutes', async () => {
    const now = testApp.deps.clock.now();
    const { row, pendingToken, code } = await challenge('expired@example.test', {
      expiresAt: new Date(now.getTime() - SECOND_MS),
    });
    await expectError(await verify({ pendingToken, code, signup: signup() }), 422, 'code_expired');
    expect(await challengeRow(row.id)).toBeUndefined();
  });

  it('verify needs the pending token', async () => {
    const a = await challenge('token-a@example.test');
    let codeB = newEmailCode();
    while (codeB === a.code) {
      codeB = newEmailCode();
    }
    const b = await challenge('token-b@example.test', { code: codeB });
    await expectError(
      await verify({ pendingToken: a.pendingToken, code: b.code, signup: signup() }),
      422,
      'code_invalid',
    );
    expect((await challengeRow(a.row.id))?.attempts).toBe(1);
    expect((await challengeRow(b.row.id))?.attempts).toBe(0);
    await expectError(
      await verify({ pendingToken: randomToken(), code: a.code, signup: signup() }),
      422,
      'code_expired',
    );
    expect(await userCount()).toBe(0);
  });

  it('an existing email signs in', async () => {
    const user = await insertUser(testApp.deps.db, { email: 'existing@example.test' });
    const { pendingToken, code } = await challenge('existing@example.test');
    const info = await expectSignedIn(await verify({ pendingToken, code }));
    expect(info.created).toBe(false);
    expect(info.me.id).toBe(user.id);
    expect(await userCount()).toBe(1);
    expect(await testApp.deps.db.select().from(appEvents)).toEqual([]);
    expect(await queuedJobs(testApp.deps.db, 'notify.email')).toEqual([]);
  });

  it('a completed email code signs in to the user holding that email, with a notice when a method is attached', async () => {
    const email = 'apple-user@example.test';
    const user = await insertUser(testApp.deps.db, { email });
    await testApp.deps.db.delete(authIdentities).where(eq(authIdentities.userId, user.id));
    await insertIdentity(testApp.deps.db, {
      userId: user.id,
      provider: 'apple',
      subject: 'fixture-apple-subject-1',
      email,
    });
    const { pendingToken, code } = await challenge(email);
    const info = await expectSignedIn(await verify({ pendingToken, code }));
    expect(info.created).toBe(false);
    expect(info.me.id).toBe(user.id);
    expect(info.me.signInMethods).toEqual(['apple', 'email']);
    const identities = await testApp.deps.db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, user.id));
    expect(identities.map((identity) => [identity.provider, identity.subject]).sort()).toEqual([
      ['apple', 'fixture-apple-subject-1'],
      ['email', email],
    ]);
    const jobs = await queuedJobs(testApp.deps.db, 'notify.email');
    expect(jobs.map((job) => job.data)).toEqual([
      { template: 'signin_method_added', userId: user.id, provider: 'email' },
    ]);
    expect(await userCount()).toBe(1);
  });

  it('the web never sees the token, and cookie attributes', async () => {
    const web = await challenge('web@example.test');
    const response = await verify(
      { pendingToken: web.pendingToken, code: web.code, signup: signup() },
      { client: 'web/1.4.0' },
    );
    const info = await expectSignedIn(response);
    expect(info.token).toBeNull();
    const cookie = response.headers.get('set-cookie') ?? '';
    const [pair, ...attributes] = cookie.split(';').map((part) => part.trim());
    expect(pair).toMatch(/^__Host-os_session=[A-Za-z0-9_-]{43}$/);
    expect(attributes.sort()).toEqual(
      ['HttpOnly', `Max-Age=${String(NINETY_DAYS_S)}`, 'Path=/', 'SameSite=Lax', 'Secure'].sort(),
    );
    expect(cookie).not.toMatch(/domain/i);
    expect(info.me.session.platform).toBe('web');

    const phone = await challenge('phone@example.test');
    const phoneResponse = await verify({
      pendingToken: phone.pendingToken,
      code: phone.code,
      signup: signup(),
    });
    const phoneInfo = await expectSignedIn(phoneResponse);
    expect(phoneInfo.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(phoneResponse.headers.get('set-cookie')).toBeNull();
  });

  it('reauth', async () => {
    const user = await insertUser(testApp.deps.db, { email: 'reauth@example.test' });
    const earlier = new Date(testApp.deps.clock.now().getTime() - 2 * HOUR_MS);
    const auth = await signIn(testApp.deps.db, user, 'bearer', { authenticatedAt: earlier });
    const [old] = await sessionsOf(user.id);
    const own = await challenge('reauth@example.test');
    const info = await expectSignedIn(
      await verify({ pendingToken: own.pendingToken, code: own.code, intent: 'reauth' }, { auth }),
    );
    expect(info.created).toBe(false);
    const after = await sessionsOf(user.id);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).not.toBe(old?.id);
    expect(after[0]?.authenticatedAt).toEqual(testApp.deps.clock.now());
    const fresh: TestAuth = { kind: 'bearer', token: info.token ?? '' };

    const other = await insertUser(testApp.deps.db, { email: 'other@example.test' });
    const theirs = await challenge('other@example.test');
    await expectError(
      await verify(
        { pendingToken: theirs.pendingToken, code: theirs.code, intent: 'reauth' },
        { auth: fresh },
      ),
      409,
      'reauth_mismatch',
    );
    expect(await challengeRow(theirs.row.id)).toBeUndefined();
    expect(await sessionsOf(user.id)).toHaveLength(1);
    expect(await sessionsOf(other.id)).toEqual([]);

    const unknown = await challenge('nobody@example.test');
    await expectError(
      await verify(
        {
          pendingToken: unknown.pendingToken,
          code: unknown.code,
          intent: 'reauth',
          signup: signup(),
        },
        { auth: fresh },
      ),
      409,
      'reauth_mismatch',
    );
    expect(await userByEmail('nobody@example.test')).toBeUndefined();

    const loggedOut = await challenge('reauth@example.test');
    await expectError(
      await verify({
        pendingToken: loggedOut.pendingToken,
        code: loggedOut.code,
        intent: 'reauth',
      }),
      401,
      'unauthenticated',
    );
    expect((await challengeRow(loggedOut.row.id))?.attempts).toBe(0);
  });

  it('add email', async () => {
    const user = await insertUser(testApp.deps.db, { email: null });
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const [session] = await sessionsOf(user.id);
    const { row, pendingToken, code } = await challenge('added@example.test');
    const response = await verify({ pendingToken, code, intent: 'add_email' }, { auth });
    const info = await expectSignedIn(response);
    expect(info.token).toBeNull();
    expect(info.created).toBe(false);
    expect(info.expiresAt).toBe(session?.expiresAt.toISOString());
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(info.me.email).toBe('added@example.test');
    expect((await userByEmail('added@example.test'))?.id).toBe(user.id);
    const identities = await testApp.deps.db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, user.id));
    expect(
      identities.map((identity) => [identity.provider, identity.subject, identity.emailVerified]),
    ).toEqual([['email', 'added@example.test', true]]);
    expect((await sessionsOf(user.id)).map((kept) => kept.id)).toEqual([session?.id]);
    expect(await challengeRow(row.id)).toBeUndefined();
    const jobs = await queuedJobs(testApp.deps.db, 'notify.email');
    expect(jobs.map((job) => job.data)).toEqual([
      { template: 'signin_method_added', userId: user.id, provider: 'email' },
    ]);

    const holder = await insertUser(testApp.deps.db, { email: 'held@example.test' });
    const second = await insertUser(testApp.deps.db, { email: null });
    const secondAuth = await signIn(testApp.deps.db, second, 'bearer');
    const held = await challenge('held@example.test');
    await expectError(
      await verify(
        { pendingToken: held.pendingToken, code: held.code, intent: 'add_email' },
        { auth: secondAuth },
      ),
      409,
      'email_in_use',
    );
    expect((await userByEmail('held@example.test'))?.id).toBe(holder.id);
    expect(await challengeRow(held.row.id)).toBeDefined();

    const withEmail = await insertUser(testApp.deps.db, { email: 'has@example.test' });
    const withEmailAuth = await signIn(testApp.deps.db, withEmail, 'bearer');
    const extra = await challenge('extra@example.test');
    await expectError(
      await verify(
        { pendingToken: extra.pendingToken, code: extra.code, intent: 'add_email' },
        { auth: withEmailAuth },
      ),
      409,
      'email_already_set',
    );
    expect((await userByEmail('has@example.test'))?.id).toBe(withEmail.id);
    expect(await queuedJobs(testApp.deps.db, 'notify.email')).toHaveLength(1);
  });

  it('a sign-in replaces the carried session', async () => {
    const carried = await insertUser(testApp.deps.db, { email: 'carried@example.test' });
    const auth = await signIn(testApp.deps.db, carried, 'cookie');
    const [carriedSession] = await sessionsOf(carried.id);
    const target = await insertUser(testApp.deps.db, { email: 'target@example.test' });
    const { pendingToken, code } = await challenge('target@example.test');
    const info = await expectSignedIn(await verify({ pendingToken, code }, { auth }));
    expect(info.me.id).toBe(target.id);
    const [gone] = await testApp.deps.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, carriedSession?.id ?? ''));
    expect(gone).toBeUndefined();
    expect(await sessionsOf(target.id)).toHaveLength(1);
  });

  it('admin from ADMIN_EMAILS only when verified', async () => {
    const { pendingToken, code } = await challenge('admin@example.test');
    const info = await expectSignedIn(await verify({ pendingToken, code, signup: signup() }));
    expect(info.me.role).toBe('admin');
    expect((await userByEmail('admin@example.test'))?.role).toBe('admin');
    const lines = testApp.logs.filter((line) => line.parsed['event'] === 'auth.admin_bootstrap');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.parsed['level']).toBe('info');
    expect(lines[0]?.parsed['userId']).toBe(info.me.id);
    expect(Object.keys(lines[0]?.parsed ?? {}).sort()).toEqual(
      [...STANDARD_LOG_KEYS, 'userId'].sort(),
    );
    expect(Object.keys(info.me.session).sort()).toEqual(
      ['authenticatedAt', 'expiresAt', 'platform', 'sensitiveActionsUntil'].sort(),
    );
    expect('adminActionsUntil' in info.me.session).toBe(false);

    // Another sign-in of the same admin promotes nothing and logs nothing more.
    const again = await challenge('admin@example.test');
    await expectSignedIn(await verify({ pendingToken: again.pendingToken, code: again.code }));
    expect(
      testApp.logs.filter((line) => line.parsed['event'] === 'auth.admin_bootstrap'),
    ).toHaveLength(1);

    const plain = await challenge('plain@example.test');
    const plainInfo = await expectSignedIn(
      await verify({ pendingToken: plain.pendingToken, code: plain.code, signup: signup() }),
    );
    expect(plainInfo.me.role).toBe('user');
  });

  it('no sign-in while deleting', async () => {
    await insertUser(testApp.deps.db, {
      email: 'deleting@example.test',
      status: 'deleting',
      deletionRequestedAt: testApp.deps.clock.now(),
    });
    const deleting = await challenge('deleting@example.test');
    await expectError(
      await verify({ pendingToken: deleting.pendingToken, code: deleting.code }),
      403,
      'account_deleting',
    );
    expect(await challengeRow(deleting.row.id)).toBeUndefined();
    expect(await testApp.deps.db.select().from(sessions)).toEqual([]);

    await insertUser(testApp.deps.db, {
      email: 'suspended@example.test',
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'spam',
    });
    const suspended = await challenge('suspended@example.test');
    const info = await expectSignedIn(
      await verify({ pendingToken: suspended.pendingToken, code: suspended.code }),
    );
    expect(info.me.status).toBe('suspended');
    expect(info.me.suspension?.reason).toBe('spam');
  });

  it('per-state sign-up rule, and per-state rules at sign-up', async () => {
    const atDefault = await challenge('default@example.test');
    await expectSignedIn(
      await verify({
        pendingToken: atDefault.pendingToken,
        code: atDefault.code,
        signup: signup(),
      }),
    );
    await testApp.deps.db.execute(
      sql`update state_rules set signup = 'withhold' where state = 'MS'`,
    );
    testApp.deps.clock.advance(FLAG_CACHE_MS);

    const stateless = await challenge('stateless@example.test');
    const required = await expectError(
      await verify({
        pendingToken: stateless.pendingToken,
        code: stateless.code,
        signup: signup(),
      }),
      400,
      'invalid_request',
    );
    expect(required.error.fields).toEqual({ 'signup.state': 'required' });
    await expectError(
      await verify({
        pendingToken: stateless.pendingToken,
        code: stateless.code,
        signup: signup({ state: 'MS' }),
      }),
      403,
      'unavailable_in_state',
    );
    expect(await userByEmail('stateless@example.test')).toBeUndefined();
    expect((await challengeRow(stateless.row.id))?.attempts).toBe(0);
    await expectSignedIn(
      await verify({
        pendingToken: stateless.pendingToken,
        code: stateless.code,
        signup: signup({ state: 'TX' }),
      }),
    );

    await testApp.deps.db.execute(
      sql`update state_rules set age_method = 'store_signal_required' where state = 'TX'`,
    );
    testApp.deps.clock.advance(FLAG_CACHE_MS);
    const texan = await challenge('texan@example.test');
    await expectError(
      await verify({
        pendingToken: texan.pendingToken,
        code: texan.code,
        signup: signup({ state: 'TX' }),
      }),
      422,
      'age_signal_required',
    );
    expect(await userByEmail('texan@example.test')).toBeUndefined();
    // The state is never stored: no column of the new users holds it.
    const stored = await testApp.deps.db.execute<{ text: string }>(
      sql`select coalesce(string_agg(u::text, ''), '') as text from users u`,
      'objects',
    );
    expect(stored[0]?.text ?? '').not.toMatch(/\bTX\b|\bMS\b/);
  });

  it('the sixth account from one address in a day is refused', async () => {
    const ip = '203.0.113.7';
    for (let n = 1; n <= 5; n += 1) {
      const { pendingToken, code } = await challenge(`daily${String(n)}@example.test`);
      const info = await expectSignedIn(
        await verify({ pendingToken, code, signup: signup() }, { ip }),
      );
      expect(info.created, `sign-up ${String(n)}`).toBe(true);
    }
    const sixth = await challenge('daily6@example.test');
    const refused = await verify(
      { pendingToken: sixth.pendingToken, code: sixth.code, signup: signup() },
      { ip },
    );
    await expectError(refused, 429, 'signup_limit_reached');
    // Noon UTC: twelve hours to the next day.
    expect(refused.headers.get('retry-after')).toBe(String(12 * 60 * 60));
    expect(await userByEmail('daily6@example.test')).toBeUndefined();
    expect((await challengeRow(sixth.row.id))?.attempts).toBe(0);

    await insertUser(testApp.deps.db, { email: 'returning@example.test' });
    const returning = await challenge('returning@example.test');
    const back = await expectSignedIn(
      await verify({ pendingToken: returning.pendingToken, code: returning.code }, { ip }),
    );
    expect(back.created).toBe(false);

    const key = `ip:${addressHashOf(testApp.deps.keyRing, ip, testApp.deps.clock.now())}:signup:1d`;
    const [counted] = await testApp.deps.db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(eq(rateLimits.key, key));
    expect(counted?.count).toBe(5);
  });

  it('the verify route is limited', async () => {
    const ip = '203.0.113.9';
    for (let n = 1; n <= 60; n += 1) {
      const response = await verify({ pendingToken: randomToken(), code: '123456' }, { ip });
      expect(response.status, `verify ${String(n)}`).toBe(422);
    }
    const limited = await verify({ pendingToken: randomToken(), code: '123456' }, { ip });
    await expectError(limited, 429, 'rate_limited');
    expect(limited.headers.get('retry-after')).toBe(String(60 * 60));
  });

  it('rejects invalid input', async () => {
    const bad = await expectError(
      await verify({ pendingToken: 'short', code: '12345', intent: 'other' }),
      400,
      'invalid_request',
    );
    expect(bad.error.fields).toEqual({
      pendingToken: 'invalid_format',
      code: 'invalid_format',
      intent: 'invalid_value',
    });
  });

  it('a marker email and code reach no log line', async () => {
    const email = `person.${marker()}@example.test`.toLowerCase();
    const started = await testApp.request.post(START, { ip: freshIp(), body: { email } });
    expect(started.status).toBe(200);
    const { pendingToken } = await started.json<{ pendingToken: string }>();
    const code = testApp.fakes.mailer.codeFor(email) ?? '';
    expect(code).toMatch(/^[0-9]{6}$/);
    await expectError(
      await verify({ pendingToken, code: otherThan(code), signup: signup() }),
      422,
      'code_invalid',
    );
    const info = await expectSignedIn(await verify({ pendingToken, code, signup: signup() }));
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(marker());
      expect(line.raw).not.toContain(marker().toLowerCase());
      expect(line.raw).not.toContain('@example.test');
      expect(line.raw).not.toContain(pendingToken);
      expect(line.raw).not.toContain(code);
      expect(line.raw).not.toContain(info.token ?? 'no token');
    }
  });
});
