import { decodeProtectedHeader, jwtVerify } from 'jose';
import { ApiError } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import type { Deps } from '../../deps.ts';
import { FIXTURE_APPLE, FakeIdentityProviders } from '../../testing/fakes/identity.ts';
import { createFakeOutbound } from '../../testing/fakes/outbound.ts';
import type { FakeOutbound } from '../../testing/fakes/outbound.ts';
import { createUnitDeps } from '../../testing/unit-deps.ts';
import {
  appleClientSecret,
  appleConfig,
  appleIdentityInput,
  appleNonceMatches,
  exchangeAppleCode,
  verifyAppleIdToken,
} from './apple.ts';
import type { AppleConfig, AppleIdClaims } from './apple.ts';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const NONCE_HASH = 'a'.repeat(64);

function setup(): {
  clock: FakeClock;
  identity: FakeIdentityProviders;
  deps: ReturnType<typeof createUnitDeps>;
  config: AppleConfig;
  outbound: FakeOutbound;
} {
  const clock = new FakeClock();
  const identity = new FakeIdentityProviders(clock);
  const outbound = createFakeOutbound();
  const deps = {
    ...createUnitDeps({ clock, env: identity.appleEnv() }),
    identityKeys: identity.keys,
    outbound: outbound.fetch,
  };
  const config = appleConfig(deps.env);
  if (config === null) {
    throw new Error('The fixture Apple values did not configure Apple.');
  }
  return { clock, identity, deps, config, outbound };
}

function claimsWith(overrides: Partial<AppleIdClaims>): AppleIdClaims {
  return {
    sub: '000123.fixture',
    aud: FIXTURE_APPLE.bundleId,
    nonce: NONCE_HASH,
    nonceSupported: true,
    email: null,
    emailVerified: false,
    isPrivateEmail: false,
    ...overrides,
  };
}

const AUDIENCES = [FIXTURE_APPLE.bundleId, FIXTURE_APPLE.servicesId];

describe('L-apple', () => {
  it('booleans may be strings', async () => {
    const { identity, deps, clock } = setup();
    const stringy = await verifyAppleIdToken(
      deps.identityKeys.apple,
      await identity.appleIdToken({
        email: 'Relay@Example.Test',
        email_verified: 'true',
        is_private_email: 'true',
        nonce_supported: 'false',
      }),
      AUDIENCES,
      clock.now(),
    );
    expect(stringy).toMatchObject({
      email: 'relay@example.test',
      emailVerified: true,
      isPrivateEmail: true,
      nonceSupported: false,
    });
    const real = await verifyAppleIdToken(
      deps.identityKeys.apple,
      await identity.appleIdToken({
        email: 'relay@example.test',
        email_verified: true,
        is_private_email: false,
        nonce_supported: false,
      }),
      AUDIENCES,
      clock.now(),
    );
    expect(real).toMatchObject({
      emailVerified: true,
      isPrivateEmail: false,
      nonceSupported: false,
    });
    const strFalse = await verifyAppleIdToken(
      deps.identityKeys.apple,
      await identity.appleIdToken({ email_verified: 'false', is_private_email: 'false' }),
      AUDIENCES,
      clock.now(),
    );
    expect(strFalse).toMatchObject({
      email: null,
      emailVerified: false,
      isPrivateEmail: false,
      nonceSupported: true,
    });
  });

  it('a token with a missing subject or an unknown issuer is identity_token_invalid', async () => {
    const { identity, deps, clock } = setup();
    for (const token of [
      await identity.appleIdToken({ sub: undefined }),
      await identity.appleIdToken({ iss: 'https://evil.example.test' }),
      await identity.appleIdToken({}, { foreignKey: true }),
    ]) {
      await expect(
        verifyAppleIdToken(deps.identityKeys.apple, token, AUDIENCES, clock.now()),
      ).rejects.toMatchObject({ code: 'identity_token_invalid' });
    }
    await expect(
      verifyAppleIdToken(deps.identityKeys.apple, 'not-a-token', AUDIENCES, clock.now()),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('the nonce check honours nonce_supported', () => {
    expect(appleNonceMatches(claimsWith({}), NONCE_HASH)).toBe(true);
    expect(appleNonceMatches(claimsWith({ nonce: 'b'.repeat(64) }), NONCE_HASH)).toBe(false);
    expect(appleNonceMatches(claimsWith({ nonce: null }), NONCE_HASH)).toBe(false);
    expect(appleNonceMatches(claimsWith({ nonce: null, nonceSupported: false }), NONCE_HASH)).toBe(
      true,
    );
    expect(
      appleNonceMatches(claimsWith({ nonce: 'b'.repeat(64), nonceSupported: false }), NONCE_HASH),
    ).toBe(true);
  });

  it('only a verified email is authoritative', () => {
    expect(
      appleIdentityInput(claimsWith({ email: 'one@example.test', emailVerified: true })),
    ).toEqual({
      provider: 'apple',
      subject: '000123.fixture',
      email: 'one@example.test',
      emailVerified: true,
      emailVerifiedAuthoritative: true,
      isPrivateEmail: false,
    });
    expect(
      appleIdentityInput(claimsWith({ email: 'one@example.test' })).emailVerifiedAuthoritative,
    ).toBe(false);
    expect(appleIdentityInput(claimsWith({ emailVerified: true })).emailVerifiedAuthoritative).toBe(
      false,
    );
  });

  it('Apple is configured only when all five values are set', () => {
    const identity = new FakeIdentityProviders(new FakeClock());
    expect(appleConfig(createUnitDeps({ env: identity.appleEnv() }).env)).toEqual({
      teamId: FIXTURE_APPLE.teamId,
      keyId: FIXTURE_APPLE.keyId,
      privateKey: identity.appleEnv().APPLE_PRIVATE_KEY.trim(),
      bundleId: FIXTURE_APPLE.bundleId,
      servicesId: FIXTURE_APPLE.servicesId,
    });
    for (const name of Object.keys(identity.appleEnv())) {
      const env = createUnitDeps({ env: { ...identity.appleEnv(), [name]: undefined } }).env;
      expect(appleConfig(env), name).toBeNull();
    }
    expect(appleConfig(createUnitDeps().env)).toBeNull();
  });

  it("the client secret's claims", async () => {
    const { identity, deps, config, clock } = setup();
    const secret = await appleClientSecret(deps, config, FIXTURE_APPLE.servicesId, clock.now());
    expect(decodeProtectedHeader(secret)).toEqual({ alg: 'ES256', kid: FIXTURE_APPLE.keyId });
    const { payload } = await jwtVerify(secret, identity.applePublicKeyForClientSecret, {
      algorithms: ['ES256'],
      currentDate: clock.now(),
    });
    const iat = Math.floor(clock.now().getTime() / SECOND_MS);
    expect(payload).toEqual({
      iss: FIXTURE_APPLE.teamId,
      aud: 'https://appleid.apple.com',
      sub: FIXTURE_APPLE.servicesId,
      iat,
      exp: iat + 3600,
    });
  });

  it('the client secret is cached for 50 minutes', async () => {
    const { deps, config, clock } = setup();
    const start = clock.now();
    const first = await appleClientSecret(deps, config, FIXTURE_APPLE.bundleId, start);
    const at = (ms: number): Date => new Date(start.getTime() + ms);
    expect(
      await appleClientSecret(
        deps,
        config,
        FIXTURE_APPLE.bundleId,
        at(49 * MINUTE_MS + 59 * SECOND_MS),
      ),
    ).toBe(first);
    // Each client id has its own secret.
    const other = await appleClientSecret(deps, config, FIXTURE_APPLE.servicesId, start);
    expect(other).not.toBe(first);
    const renewed = await appleClientSecret(
      deps,
      config,
      FIXTURE_APPLE.bundleId,
      at(50 * MINUTE_MS),
    );
    expect(renewed).not.toBe(first);
    // Another app keeps its own cache.
    const otherApp: Deps = { ...deps };
    expect(
      await appleClientSecret(otherApp, config, FIXTURE_APPLE.servicesId, at(SECOND_MS)),
    ).not.toBe(other);
  });

  it('the exchange sends the redirect URI only for the Services ID', async () => {
    const { identity, deps, config, clock, outbound } = setup();
    identity.registerAppleEndpoints(outbound);
    const publicUrl = 'https://app.example.test';
    const base = { code: 'fixture-code', publicUrl, now: clock.now(), log: deps.logger };
    expect(
      await exchangeAppleCode(deps, config, { ...base, clientId: FIXTURE_APPLE.bundleId }),
    ).toBe('fixture-refresh-1');
    expect(
      await exchangeAppleCode(deps, config, { ...base, clientId: FIXTURE_APPLE.servicesId }),
    ).toBe('fixture-refresh-2');
    expect(identity.exchanges.map((exchange) => [exchange.clientId, exchange.redirectUri])).toEqual(
      [
        [FIXTURE_APPLE.bundleId, null],
        [FIXTURE_APPLE.servicesId, `${publicUrl}/v1/auth/apple/callback`],
      ],
    );
    expect(
      identity.exchanges.every((exchange) => exchange.grantType === 'authorization_code'),
    ).toBe(true);
    expect(outbound.calls.map((call) => [call.host, call.method, call.path])).toEqual([
      ['appleid.apple.com', 'POST', '/auth/token'],
      ['appleid.apple.com', 'POST', '/auth/token'],
    ]);
    expect(
      deps.logs.filter((line) => line.parsed['event'] === 'auth.apple_exchange_failed'),
    ).toEqual([]);
  });

  it('a failed exchange logs only its error class and returns null', async () => {
    const { deps, config, clock, outbound } = setup();
    let answer: 'bad-status' | 'no-token' | 'throws' = 'bad-status';
    outbound.on('appleid.apple.com', 'POST', '/auth/token', () => {
      if (answer === 'throws') {
        throw new TypeError('fixture network failure');
      }
      return answer === 'bad-status'
        ? { status: 400, json: { error: 'invalid_grant' } }
        : { status: 200, json: { access_token: 'fixture-access' } };
    });
    const input = {
      code: 'fixture-code',
      clientId: FIXTURE_APPLE.bundleId,
      publicUrl: 'https://app.example.test',
      now: clock.now(),
      log: deps.logger,
    };
    expect(await exchangeAppleCode(deps, config, input)).toBeNull();
    answer = 'no-token';
    expect(await exchangeAppleCode(deps, config, input)).toBeNull();
    answer = 'throws';
    expect(await exchangeAppleCode(deps, config, input)).toBeNull();
    // One attempt each: the code is single-use, so nothing is retried.
    expect(outbound.calls).toHaveLength(3);
    const failures = deps.logs.filter(
      (line) => line.parsed['event'] === 'auth.apple_exchange_failed',
    );
    expect(failures.map((line) => line.parsed['errorClass'])).toEqual([
      'UnexpectedResponse',
      'UnexpectedResponse',
      'TypeError',
    ]);
    for (const line of failures) {
      expect(Object.keys(line.parsed).sort()).toEqual([
        'errorClass',
        'event',
        'level',
        'service',
        'time',
      ]);
      expect(line.parsed['level']).toBe('warn');
    }
  });
});
