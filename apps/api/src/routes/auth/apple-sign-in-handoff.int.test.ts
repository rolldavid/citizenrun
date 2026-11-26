import { appEvents, authChallenges, sessions, userConsents, users } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import {
  ERROR_CODES,
  ErrorEnvelopeSchema,
  LEGAL_VERSIONS,
  MeSchema,
  brandVariant,
  variantForAppEnv,
} from '@citizenrun/shared';
import type { ErrorCode, SessionInfo } from '@citizenrun/shared';
import { sha256Hex } from '@citizenrun/shared/crypto';
import { FakeClock } from '@citizenrun/shared/testing';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertIdentity } from '../../testing/factories.ts';
import { FIXTURE_APPLE, FakeIdentityProviders } from '../../testing/fakes/identity.ts';
import type { TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-AUTH-06: TEST-api-AUTH; TEST-auth-providers `Apple on Android`; CTL-13.
const PATH = '/v1/auth/apple/handoff';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ANDROID = 'android/1.4.0';
// auth.token allows 60 an hour per address.
const PER_ADDRESS_HOURLY = 60;
const PREFIX = `${brandVariant(variantForAppEnv('ci')).scheme}://auth/apple?`;

type NonceResult = { nonce: string; nonceHash: string; state: string; expiresAt: string };

function signup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    age: { method: 'self_declared', sourceTier: 'self' },
    agreements: {
      termsVersion: LEGAL_VERSIONS.terms,
      contentPolicyVersion: LEGAL_VERSIONS.content_policy,
      privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
    },
    aiScreening: null,
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
  const subject = `000888.fixture.${String(nextSubject)}`;
  nextSubject += 1;
  return subject;
}

let identity: FakeIdentityProviders;
let testApp: TestApp;

beforeEach(async () => {
  const clock = new FakeClock();
  identity = new FakeIdentityProviders(clock);
  testApp = await createTestApp({
    clock,
    identity,
    env: { ...identity.appleEnv(), ...identity.googleEnv() },
  });
  identity.registerAppleEndpoints(testApp.fakes.outbound);
});

/** E-AUTH-03 then E-AUTH-05 for `subject`: the redirect's hand-off code, the nonce and the Location. */
async function callback(
  options: { subject?: string; beforeCallback?: () => void } = {},
): Promise<{ code: string; nonce: NonceResult; subject: string; location: string }> {
  const issued = await testApp.request.post('/v1/auth/nonce', {
    ip: freshIp(),
    body: {},
    client: ANDROID,
  });
  expect(issued.status).toBe(200);
  const nonce = await issued.json<NonceResult>();
  options.beforeCallback?.();
  const subject = options.subject ?? freshSubject();
  const idToken = await identity.appleIdToken({
    aud: FIXTURE_APPLE.servicesId,
    nonce: nonce.nonceHash,
    sub: subject,
  });
  const response = await testApp.app.request(
    new URL('/v1/auth/apple/callback', testApp.deps.env.PUBLIC_URL).toString(),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://appleid.apple.com',
        'x-real-ip': freshIp(),
      },
      body: new URLSearchParams({ state: nonce.state, code: 'fixture-code', id_token: idToken }),
    },
  );
  expect(response.status).toBe(302);
  const location = response.headers.get('location') ?? '';
  expect(location.startsWith(PREFIX)).toBe(true);
  const code = new URLSearchParams(location.slice(PREFIX.length)).get('code') ?? '';
  expect(code).toMatch(TOKEN_PATTERN);
  return { code, nonce, subject, location };
}

function handoff(
  body: Record<string, unknown>,
  options: TestRequestOptions = {},
): Promise<TestResponse> {
  return testApp.request.post(PATH, { ip: freshIp(), client: ANDROID, body, ...options });
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

async function handoffRow(code: string, nonce: NonceResult) {
  const [row] = await testApp.deps.db
    .select()
    .from(authChallenges)
    .where(eq(authChallenges.secretHash, sha256Hex(`${code}.${nonce.nonceHash}`)));
  return row;
}

async function userById(id: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, id));
  return row;
}

describe('POST /v1/auth/apple/handoff', () => {
  it('ok', async () => {
    const { code, nonce } = await callback();
    const info = await expectSignedIn(
      await handoff({ code, nonce: nonce.nonce, signup: signup() }),
    );
    expect(Object.keys(info).sort()).toEqual(['created', 'expiresAt', 'me', 'token']);
  });

  it('the hand-off signs the new user in', async () => {
    const { code, nonce } = await callback();
    const row = await handoffRow(code, nonce);
    const userId = row?.userId ?? '';
    expect((await userById(userId))?.ageMethod).toBeNull();
    const info = await expectSignedIn(
      await handoff({ code, nonce: nonce.nonce, signup: signup() }),
    );
    expect(info.token).toMatch(TOKEN_PATTERN);
    expect(info.created).toBe(true);
    expect(info.me.id).toBe(userId);
    expect(await userById(userId)).toMatchObject({
      ageMethod: 'self_declared',
      ageResult: 'adult',
      ageSourceTier: 'self',
    });
    const consents = await testApp.deps.db
      .select()
      .from(userConsents)
      .where(eq(userConsents.userId, userId));
    expect(consents.map((consent) => consent.kind).sort()).toEqual([
      'content_policy',
      'privacy_policy',
      'terms',
    ]);
    expect(consents.every((consent) => consent.platform === 'android')).toBe(true);
    const events = await testApp.deps.db
      .select()
      .from(appEvents)
      .where(and(eq(appEvents.userId, userId), eq(appEvents.name, 'account_created')));
    expect(events).toHaveLength(1);
    expect(events[0]?.props).toEqual({ method: 'apple' });
    const [session] = await testApp.deps.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(session?.platform).toBe('android');
    expect(session?.tokenHash).toBe(sha256Hex(info.token ?? ''));
    expect((await handoffRow(code, nonce))?.usedAt).not.toBeNull();
  });

  it('without signup the code stays usable', async () => {
    const { code, nonce } = await callback();
    await expectError(await handoff({ code, nonce: nonce.nonce }), 'signup_details_required');
    expect((await handoffRow(code, nonce))?.usedAt).toBeNull();
    await expectError(
      await handoff({
        code,
        nonce: nonce.nonce,
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
    expect((await handoffRow(code, nonce))?.usedAt).toBeNull();
    const info = await expectSignedIn(
      await handoff({ code, nonce: nonce.nonce, signup: signup() }),
    );
    expect(info.created).toBe(true);
  });

  it('the code works once', async () => {
    const { code, nonce } = await callback();
    await expectSignedIn(await handoff({ code, nonce: nonce.nonce, signup: signup() }));
    await expectError(
      await handoff({ code, nonce: nonce.nonce, signup: signup() }),
      'handoff_invalid',
    );
    // A code 61 seconds old: the row's expiry is placed one second in the past, because the consume
    // compares with the database's clock.
    const now = testApp.deps.clock.now();
    const old = await callback({
      beforeCallback: () => {
        testApp.deps.clock.set(new Date(now.getTime() - 61 * SECOND_MS));
      },
    });
    await expectError(
      await handoff({ code: old.code, nonce: old.nonce.nonce, signup: signup() }),
      'handoff_invalid',
    );
  });

  it('only android may hand off', async () => {
    const { code, nonce } = await callback();
    for (const client of ['ios/1.4.0', 'web/1.4.0']) {
      await expectError(
        await handoff({ code, nonce: nonce.nonce, signup: signup() }, { client }),
        'handoff_invalid',
      );
    }
    expect((await handoffRow(code, nonce))?.usedAt).toBeNull();
  });

  it('the code needs the raw nonce', async () => {
    const { code, nonce } = await callback();
    const other = await callback();
    await expectError(
      await handoff({ code, nonce: other.nonce.nonce, signup: signup() }),
      'handoff_invalid',
    );
    // The nonce hash in place of the nonce finds nothing either.
    await expectError(
      await handoff({ code, nonce: nonce.nonceHash.slice(0, 43), signup: signup() }),
      'handoff_invalid',
    );
    const missing = await handoff({ code, signup: signup() });
    expect(missing.status).toBe(400);
    expect(
      (await missing.json<{ error: { fields: Record<string, string> } }>()).error.fields,
    ).toEqual({
      nonce: 'required',
    });
    expect((await handoffRow(code, nonce))?.usedAt).toBeNull();
    await expectSignedIn(await handoff({ code, nonce: nonce.nonce, signup: signup() }));
  });

  it('the hand-off code works once, only for android and only with the raw nonce', async () => {
    const { code, nonce } = await callback();
    await expectError(
      await handoff({ code, nonce: nonce.nonce, signup: signup() }, { client: 'ios/1.4.0' }),
      'handoff_invalid',
    );
    await expectError(await handoff({ code, nonce: code, signup: signup() }), 'handoff_invalid');
    await expectSignedIn(await handoff({ code, nonce: nonce.nonce, signup: signup() }));
    await expectError(
      await handoff({ code, nonce: nonce.nonce, signup: signup() }),
      'handoff_invalid',
    );
  });

  it('an existing user needs no signup', async () => {
    const owner = await insertUser(testApp.deps.db);
    const subject = freshSubject();
    await insertIdentity(testApp.deps.db, {
      userId: owner.id,
      provider: 'apple',
      subject,
      email: null,
      emailVerified: null,
    });
    const { code, nonce } = await callback({ subject });
    const info = await expectSignedIn(await handoff({ code, nonce: nonce.nonce }));
    expect(info.created).toBe(false);
    expect(info.me.id).toBe(owner.id);
    const events = await testApp.deps.db
      .select()
      .from(appEvents)
      .where(eq(appEvents.name, 'account_created'));
    expect(events).toHaveLength(0);
  });

  it('reauth for another user answers 409', async () => {
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
    const { code, nonce } = await callback({ subject });
    await expectError(
      await handoff({ code, nonce: nonce.nonce, intent: 'reauth' }),
      'unauthenticated',
    );
    expect((await handoffRow(code, nonce))?.usedAt).toBeNull();
    await expectError(
      await handoff({ code, nonce: nonce.nonce, intent: 'reauth' }, { auth }),
      'reauth_mismatch',
    );
    expect((await handoffRow(code, nonce))?.usedAt).not.toBeNull();
    // The owner may re-authenticate.
    const ownerAuth = await signIn(testApp.deps.db, owner, 'bearer');
    const again = await callback({ subject });
    const info = await expectSignedIn(
      await handoff(
        { code: again.code, nonce: again.nonce.nonce, intent: 'reauth' },
        { auth: ownerAuth },
      ),
    );
    expect(info.me.id).toBe(owner.id);
  });

  it('a user with no age record never satisfies reauth', async () => {
    const { code, nonce } = await callback();
    const userId = (await handoffRow(code, nonce))?.userId ?? '';
    const [user] = await testApp.deps.db.select().from(users).where(eq(users.id, userId));
    if (user === undefined) {
      throw new Error('The callback made no user.');
    }
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    await expectError(
      await handoff({ code, nonce: nonce.nonce, intent: 'reauth', signup: signup() }, { auth }),
      'reauth_mismatch',
    );
  });

  it('a deleting user answers 403 account_deleting', async () => {
    const { code, nonce } = await callback();
    const userId = (await handoffRow(code, nonce))?.userId ?? '';
    await testApp.deps.db
      .update(users)
      .set({ status: 'deleting', deletionRequestedAt: new Date() })
      .where(eq(users.id, userId));
    await expectError(
      await handoff({ code, nonce: nonce.nonce, signup: signup() }),
      'account_deleting',
    );
    expect((await handoffRow(code, nonce))?.usedAt).not.toBeNull();
    expect(await testApp.deps.db.select().from(sessions)).toHaveLength(0);
  });

  it('no session token is ever in a URL', async () => {
    const { code, nonce, location } = await callback();
    const info = await expectSignedIn(
      await handoff({ code, nonce: nonce.nonce, signup: signup() }),
    );
    const token = info.token ?? '';
    expect(token).toMatch(TOKEN_PATTERN);
    expect(location).not.toContain(token);
    expect(code).not.toBe(token);
    const [session] = await testApp.deps.db.select().from(sessions);
    expect(session?.tokenHash).not.toBe(sha256Hex(code));
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(token);
      expect(line.raw).not.toContain(code);
      expect(line.raw).not.toContain(nonce.nonce);
    }
  });

  it('rejects invalid input', async () => {
    const { code, nonce } = await callback();
    const cases: [Record<string, unknown>, string, string][] = [
      [{ nonce: nonce.nonce }, 'code', 'required'],
      [{ code: `${code}x`, nonce: nonce.nonce }, 'code', 'invalid_format'],
      [{ code, nonce: 'short' }, 'nonce', 'invalid_format'],
      [{ code, nonce: nonce.nonce, intent: 'add_email' }, 'intent', 'invalid_value'],
      [{ code, nonce: nonce.nonce, signup: 'yes' }, 'signup', 'invalid_type'],
    ];
    for (const [body, field, fieldCode] of cases) {
      const response = await handoff(body);
      expect(response.status, field).toBe(400);
      const envelope = await response.json<{
        error: { code: string; fields: Record<string, string> };
      }>();
      expect(envelope.error.code).toBe('invalid_request');
      expect(envelope.error.fields[field], field).toBe(fieldCode);
    }
    expect((await handoffRow(code, nonce))?.usedAt).toBeNull();
  });

  it('envelope on every error', async () => {
    await expectError(await handoff({}), 'invalid_request');
    await expectError(await handoff({}, { client: null }), 'client_header_required');
    const unknown = 'A'.repeat(43);
    await expectError(await handoff({ code: unknown, nonce: unknown }), 'handoff_invalid');
  });

  it('rate-limited', async () => {
    const ip = '203.0.113.190';
    for (let n = 1; n <= PER_ADDRESS_HOURLY; n += 1) {
      expect((await handoff({}, { ip })).status, `call ${String(n)}`).toBe(400);
    }
    const limited = await handoff({}, { ip });
    await expectError(limited, 'rate_limited');
    const now = testApp.deps.clock.now().getTime();
    const toHourEnd = Math.ceil((Math.ceil(now / HOUR_MS) * HOUR_MS - now) / SECOND_MS);
    expect(limited.headers.get('retry-after')).toBe(String(toHourEnd));
  });
});
