import { appEvents, authChallenges, authIdentities, sessions, users } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { brandVariant, variantForAppEnv } from '@citizenrun/shared';
import { sha256Hex, signToken } from '@citizenrun/shared/crypto';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { insertIdentity } from '../../testing/factories.ts';
import { FIXTURE_APPLE, FakeIdentityProviders } from '../../testing/fakes/identity.ts';
import type { AppleTokenClaims } from '../../testing/fakes/identity.ts';

// E-AUTH-05: TEST-api-AUTH; TEST-auth-providers `Apple on Android`; CTL-10 `each exempt route
// rejects a bad signature or state`; CTL-13.
const PATH = '/v1/auth/apple/callback';
const SECOND_MS = 1000;
const HANDOFF_TTL_MS = 60 * SECOND_MS;
const APPLE_ORIGIN = 'https://appleid.apple.com';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// auth.appleCallback allows 30 an hour per address.
const PER_ADDRESS_HOURLY = 30;
const BODY_LIMIT_BYTES = 16_384;
// Computed from the brand module, never written as a literal.
const PREFIX = `${brandVariant(variantForAppEnv('ci')).scheme}://auth/apple?`;

type NonceResult = { nonce: string; nonceHash: string; state: string; expiresAt: string };

let nextHost = 1;
function freshIp(): string {
  const ip = `198.51.100.${String(nextHost % 250)}`;
  nextHost += 1;
  return ip;
}

let nextSubject = 1;
function freshSubject(): string {
  const subject = `000777.fixture.${String(nextSubject)}`;
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

async function issueNonce(client = 'android/1.4.0'): Promise<NonceResult> {
  const response = await testApp.request.post('/v1/auth/nonce', {
    ip: freshIp(),
    body: {},
    client,
  });
  expect(response.status).toBe(200);
  return response.json<NonceResult>();
}

/** Apple's form post: url-encoded, from Apple's origin, with no client header. */
function postRaw(
  body: string,
  options: { ip?: string; contentType?: string } = {},
): Promise<Response> {
  return Promise.resolve(
    testApp.app.request(new URL(PATH, testApp.deps.env.PUBLIC_URL).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': options.contentType ?? 'application/x-www-form-urlencoded',
        Origin: APPLE_ORIGIN,
        'x-real-ip': options.ip ?? freshIp(),
      },
      body,
    }),
  );
}

function postForm(
  fields: Record<string, string>,
  options: { ip?: string } = {},
): Promise<Response> {
  return postRaw(new URLSearchParams(fields).toString(), options);
}

function servicesToken(nonce: NonceResult, claims: AppleTokenClaims = {}): Promise<string> {
  return identity.appleIdToken({
    aud: FIXTURE_APPLE.servicesId,
    nonce: nonce.nonceHash,
    sub: freshSubject(),
    ...claims,
  });
}

/** Asserts the redirect shape and returns the Location's query. */
async function expectRedirect(response: Response): Promise<URLSearchParams> {
  expect(response.status).toBe(302);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBeNull();
  expect(await response.text()).toBe('');
  const location = response.headers.get('location') ?? '';
  expect(location.startsWith(PREFIX)).toBe(true);
  return new URLSearchParams(location.slice(PREFIX.length));
}

async function expectRefusal(
  response: Response,
  error: string,
  appleState: string | null,
): Promise<void> {
  const query = await expectRedirect(response);
  expect([...query.keys()]).toEqual(appleState === null ? ['error'] : ['error', 'state']);
  expect(query.get('error')).toBe(error);
  expect(query.get('state')).toBe(appleState);
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

async function userCount(): Promise<number> {
  return (await testApp.deps.db.select({ id: users.id }).from(users)).length;
}

describe('POST /v1/auth/apple/callback', () => {
  it('ok', async () => {
    const nonce = await issueNonce();
    const response = await postForm({
      state: nonce.state,
      code: 'fixture-code',
      id_token: await servicesToken(nonce),
    });
    const query = await expectRedirect(response);
    expect([...query.keys()]).toEqual(['code', 'state']);
  });

  it('a valid form redirects with a hand-off code', async () => {
    const nonce = await issueNonce();
    const response = await postForm({
      state: nonce.state,
      code: 'fixture-code',
      id_token: await servicesToken(nonce),
    });
    expect(response.headers.get('set-cookie')).toBeNull();
    const query = await expectRedirect(response);
    const code = query.get('code') ?? '';
    expect(code).toMatch(TOKEN_PATTERN);
    expect(query.get('state')).toBe(nonce.state);
    const [handoff] = await testApp.deps.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.secretHash, sha256Hex(`${code}.${nonce.nonceHash}`)));
    expect(handoff).toMatchObject({ kind: 'apple_handoff', platform: 'android', usedAt: null });
    expect(handoff?.expiresAt.getTime()).toBe(testApp.deps.clock.now().getTime() + HANDOFF_TTL_MS);
    // The code alone finds no row (D-440).
    const byCode = await testApp.deps.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.secretHash, sha256Hex(code)));
    expect(byCode).toHaveLength(0);
    expect((await nonceRow(nonce))?.usedAt).not.toBeNull();
    expect(await testApp.deps.db.select().from(sessions)).toHaveLength(0);
    // The code was exchanged with the Services ID and the callback's redirect URI.
    expect(identity.exchanges).toHaveLength(1);
    expect(identity.exchanges[0]).toMatchObject({
      clientId: FIXTURE_APPLE.servicesId,
      redirectUri: 'https://app.example.test/v1/auth/apple/callback',
    });
  });

  it("a request from Apple's origin with no client header is accepted", async () => {
    const nonce = await issueNonce();
    const response = await postForm({ state: nonce.state, id_token: await servicesToken(nonce) });
    const query = await expectRedirect(response);
    expect(query.get('code')).toMatch(TOKEN_PATTERN);
    // No code in the form: nothing to exchange.
    expect(identity.exchanges).toHaveLength(0);
  });

  it('a tampered or expired state', async () => {
    const nonce = await issueNonce();
    const idToken = await servicesToken(nonce);
    const last = nonce.state.slice(-1);
    const tampered = nonce.state.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    await expectRefusal(
      await postForm({ state: tampered, id_token: idToken }),
      'state_invalid',
      null,
    );
    const expired = signToken(
      testApp.deps.keyRing,
      'apple_state',
      { n: nonce.nonceHash },
      600,
      new Date(testApp.deps.clock.now().getTime() - 601 * SECOND_MS),
    );
    await expectRefusal(
      await postForm({ state: expired, id_token: idToken }),
      'state_invalid',
      null,
    );
    // A state signed for another purpose.
    const otherPurpose = signToken(
      testApp.deps.keyRing,
      'search',
      { n: nonce.nonceHash },
      600,
      testApp.deps.clock.now(),
    );
    await expectRefusal(
      await postForm({ state: otherPurpose, id_token: idToken }),
      'state_invalid',
      null,
    );
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('callback with a forged state refused', async () => {
    const nonce = await issueNonce();
    const forged = `${Buffer.from(JSON.stringify({ p: 'apple_state', k: 'x', e: 9_999_999_999, n: nonce.nonceHash })).toString('base64url')}.forged`;
    await expectRefusal(
      await postForm({ state: forged, id_token: await servicesToken(nonce) }),
      'state_invalid',
      null,
    );
    expect(await userCount()).toBe(0);
  });

  it('each exempt route rejects a bad signature or state', async () => {
    const nonce = await issueNonce();
    await expectRefusal(
      await postForm({ state: 'x', id_token: await servicesToken(nonce) }),
      'state_invalid',
      null,
    );
    const unknownKey = await identity.appleIdToken(
      { aud: FIXTURE_APPLE.servicesId, nonce: nonce.nonceHash },
      { foreignKey: true },
    );
    await expectRefusal(
      await postForm({ state: nonce.state, id_token: unknownKey }),
      'token_invalid',
      nonce.state,
    );
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('a state whose nonce was issued to ios', async () => {
    const nonce = await issueNonce('ios/1.4.0');
    await expectRefusal(
      await postForm({ state: nonce.state, id_token: await servicesToken(nonce) }),
      'nonce_invalid',
      nonce.state,
    );
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('a used nonce', async () => {
    const nonce = await issueNonce();
    const subject = freshSubject();
    await expectRedirect(
      await postForm({
        state: nonce.state,
        id_token: await servicesToken(nonce, { sub: subject }),
      }),
    );
    await expectRefusal(
      await postForm({
        state: nonce.state,
        id_token: await servicesToken(nonce, { sub: subject }),
      }),
      'nonce_invalid',
      nonce.state,
    );
  });

  it('a token for the bundle id redirects error=token_invalid', async () => {
    const nonce = await issueNonce();
    const bundle = await servicesToken(nonce, { aud: FIXTURE_APPLE.bundleId });
    await expectRefusal(
      await postForm({ state: nonce.state, id_token: bundle }),
      'token_invalid',
      nonce.state,
    );
    // A form with no identity token.
    await expectRefusal(await postForm({ state: nonce.state }), 'token_invalid', nonce.state);
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('a nonce claim that differs redirects error=nonce_invalid', async () => {
    const nonce = await issueNonce();
    const differs = await servicesToken(nonce, { nonce: sha256Hex('another') });
    await expectRefusal(
      await postForm({ state: nonce.state, id_token: differs }),
      'nonce_invalid',
      nonce.state,
    );
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('a cancelled authorisation', async () => {
    const nonce = await issueNonce();
    await expectRefusal(
      await postForm({ state: nonce.state, error: 'user_cancelled_authorize' }),
      'cancelled',
      null,
    );
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('a new subject gets a user with no age record', async () => {
    const nonce = await issueNonce();
    const subject = freshSubject();
    const user = JSON.stringify({
      name: { firstName: 'Ada', lastName: 'Lovelace' },
      email: 'ada@example.test',
    });
    await expectRedirect(
      await postForm({
        state: nonce.state,
        code: 'fixture-code',
        id_token: await servicesToken(nonce, { sub: subject }),
        user,
      }),
    );
    const row = await appleIdentity(subject);
    expect(row?.clientId).toBe(FIXTURE_APPLE.servicesId);
    expect(row?.refreshTokenEnc).not.toBeNull();
    const [created] = await testApp.deps.db
      .select()
      .from(users)
      .where(eq(users.id, row?.userId ?? ''));
    expect(created).toMatchObject({
      ageMethod: null,
      ageResult: null,
      ageSourceTier: null,
      ageCheckedAt: null,
      onboardingStep: 'photo',
      name: 'Ada Lovelace',
    });
    const events = await testApp.deps.db
      .select()
      .from(appEvents)
      .where(eq(appEvents.name, 'account_created'));
    expect(events).toHaveLength(0);

    // An existing subject creates no user.
    const before = await userCount();
    const again = await issueNonce();
    await expectRedirect(
      await postForm({
        state: again.state,
        id_token: await servicesToken(again, { sub: subject }),
      }),
    );
    expect(await userCount()).toBe(before);
  });

  it('a user field that does not parse gives no name', async () => {
    const nonce = await issueNonce();
    const subject = freshSubject();
    await expectRedirect(
      await postForm({
        state: nonce.state,
        id_token: await servicesToken(nonce, { sub: subject }),
        user: '{"name":',
      }),
    );
    const row = await appleIdentity(subject);
    const [created] = await testApp.deps.db
      .select()
      .from(users)
      .where(eq(users.id, row?.userId ?? ''));
    expect(created?.name).toBeNull();
  });

  it('a deleting user redirects error=account_deleting', async () => {
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
    await expectRefusal(
      await postForm({
        state: nonce.state,
        code: 'fixture-code',
        id_token: await servicesToken(nonce, { sub: subject }),
      }),
      'account_deleting',
      nonce.state,
    );
    expect(identity.exchanges).toHaveLength(0);
  });

  it('every Location uses the fixed scheme', async () => {
    const nonce = await issueNonce();
    for (const fields of [
      { state: 'https://evil.example.test', user: 'https://evil.example.test' },
      { state: nonce.state, error: 'https://evil.example.test' },
      { state: nonce.state, id_token: 'https://evil.example.test' },
    ]) {
      const query = await expectRedirect(await postForm(fields));
      for (const value of query.values()) {
        expect(value).not.toContain('evil');
      }
    }
  });

  it('rate limited and malformed requests redirect', async () => {
    const ip = '203.0.113.180';
    for (let n = 1; n <= PER_ADDRESS_HOURLY; n += 1) {
      const response = await postForm({ state: 'x' }, { ip });
      expect(response.status, `call ${String(n)}`).toBe(302);
    }
    await expectRefusal(await postForm({ state: 'x' }, { ip }), 'rate_limited', null);
    await expectRefusal(await postForm({ code: 'fixture-code' }), 'invalid_request', null);
    await expectRefusal(await postForm({ state: 'x'.repeat(1025) }), 'invalid_request', null);
    const prefix = 'state=';
    const oversized = prefix + 'x'.repeat(BODY_LIMIT_BYTES + 1 - prefix.length);
    expect(Buffer.byteLength(oversized)).toBe(BODY_LIMIT_BYTES + 1);
    await expectRefusal(await postRaw(oversized), 'invalid_request', null);
    // A JSON body is not Apple's form: it gets a redirect too, never an envelope.
    await expectRefusal(
      await postRaw('{"state":"x"}', { contentType: 'application/json' }),
      'unavailable',
      null,
    );
  });

  it('providers without configuration', async () => {
    testApp = await makeApp({ APPLE_SERVICES_ID: undefined });
    const nonce = await issueNonce();
    await expectRefusal(
      await postForm({
        state: nonce.state,
        code: 'fixture-code',
        id_token: await servicesToken(nonce),
      }),
      'provider_not_configured',
      null,
    );
    expect(testApp.fakes.outbound.calls).toHaveLength(0);
    expect((await nonceRow(nonce))?.usedAt).toBeNull();
  });

  it('no form field reaches a log line', async () => {
    const value = marker();
    const nonce = await issueNonce();
    const idToken = await servicesToken(nonce);
    await expectRedirect(
      await postForm({
        state: nonce.state,
        code: value,
        id_token: idToken,
        user: JSON.stringify({ name: { firstName: value } }),
      }),
    );
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(value);
      expect(line.raw).not.toContain(idToken);
      expect(line.raw).not.toContain(nonce.state);
      expect(line.raw).not.toContain(nonce.nonceHash);
    }
  });
});
