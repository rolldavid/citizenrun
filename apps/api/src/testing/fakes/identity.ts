import { generateKeyPairSync } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import { SignJWT, createLocalJWKSet } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { IdentityKeys } from '../../deps.ts';
import type { FakeOutbound, FakeRequest, FakeResponse } from './outbound.ts';

/** Visibly fake Apple identifiers; none is a value of the brand module. */
export const FIXTURE_APPLE = {
  teamId: 'FIXTURE001',
  keyId: 'FIXTUREK01',
  bundleId: 'org.example.fixture',
  servicesId: 'org.example.fixture.web',
} as const;
/** Visibly fake Google client ids: the web client first, then the iOS client. */
export const FIXTURE_GOOGLE_CLIENT_IDS = [
  'fixture-web.apps.googleusercontent.com',
  'fixture-ios.apps.googleusercontent.com',
] as const;

/** Apple's identity-token claims; a claim set to `undefined` is left out of the token. */
export type AppleTokenClaims = {
  iss?: string | undefined;
  aud?: string | undefined;
  sub?: string | undefined;
  exp?: number | undefined;
  iat?: number | undefined;
  nonce?: string | undefined;
  nonce_supported?: boolean | 'true' | 'false' | undefined;
  email?: string | undefined;
  email_verified?: boolean | 'true' | 'false' | undefined;
  is_private_email?: boolean | 'true' | 'false' | undefined;
} & Record<string, unknown>;
/** Google's identity-token claims; a claim set to `undefined` is left out of the token. */
export type GoogleTokenClaims = {
  iss?: string | undefined;
  aud?: string | undefined;
  sub?: string | undefined;
  exp?: number | undefined;
  iat?: number | undefined;
  nonce?: string | undefined;
  email?: string | undefined;
  email_verified?: boolean | undefined;
  hd?: string | undefined;
} & Record<string, unknown>;
export type AppleNotificationEvent = {
  type: string;
  sub: string;
  email?: string;
  is_private_email?: boolean | string;
  event_time?: number;
};
export type SignOptions = { foreignKey?: boolean; alg?: 'RS256' | 'RS384' };

type Exchange = {
  clientId: string;
  clientSecret: string;
  code: string;
  grantType: string;
  redirectUri: string | null;
};
type Revocation = { clientId: string; clientSecret: string; token: string; tokenTypeHint: string };

type Pair = { privateKey: KeyObject; publicKey: KeyObject };
type Material = {
  apple: Pair;
  google: Pair;
  foreign: Pair;
  clientSecret: Pair;
  appleJwk: JsonWebKey;
  googleJwk: JsonWebKey;
};

const APPLE_ISSUER = 'https://appleid.apple.com';
const GOOGLE_ISSUER = 'https://accounts.google.com';
const APPLE_KID = 'fixture-apple-1';
const GOOGLE_KID = 'fixture-google-1';
const FOREIGN_KID = 'fixture-foreign-1';
const TOKEN_LIFE_S = 600;
const RSA_BITS = 2048;

// RSA key generation takes tens of milliseconds a key, so the pairs are made once per test
// process, on first use, and shared by every instance.
let material: Material | null = null;

function rsaPair(): Pair {
  return generateKeyPairSync('rsa', { modulusLength: RSA_BITS });
}

function publicJwk(pair: Pair, kid: string): JsonWebKey {
  return { ...pair.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
}

function keyMaterial(): Material {
  if (material === null) {
    const apple = rsaPair();
    const google = rsaPair();
    material = {
      apple,
      google,
      foreign: rsaPair(),
      clientSecret: generateKeyPairSync('ec', { namedCurve: 'P-256' }),
      appleJwk: publicJwk(apple, APPLE_KID),
      googleJwk: publicJwk(google, GOOGLE_KID),
    };
  }
  return material;
}

// A key set over one public JWK, built on its first use.
function lazyKeySet(jwk: () => JsonWebKey): JWTVerifyGetKey {
  let set: ReturnType<typeof createLocalJWKSet> | null = null;
  return (header, token) => {
    set ??= createLocalJWKSet({ keys: [jwk()] });
    return set(header, token);
  };
}

// The claims with every key whose value is undefined left out.
function defined(claims: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(claims).filter(([, value]) => value !== undefined));
}

function formOf(request: FakeRequest): URLSearchParams {
  return new URLSearchParams(request.body ?? '');
}

/**
 * Apple and Google in tests (TEST-fake-identity): key sets in place of the providers' remote
 * ones, signed fixture tokens and notices, and Apple's token and revoke endpoints on the fake
 * outbound, which record each exchange and revocation with its client id (D-242).
 */
export class FakeIdentityProviders {
  readonly #clock: { now(): Date };
  #refreshCount = 0;

  /** In place of `deps.identityKeys`: local key sets over the two providers' public keys. */
  readonly keys: IdentityKeys = {
    apple: lazyKeySet(() => keyMaterial().appleJwk),
    google: lazyKeySet(() => keyMaterial().googleJwk),
  };

  readonly exchanges: Exchange[] = [];
  readonly revocations: Revocation[] = [];

  constructor(clock: { now(): Date }) {
    this.#clock = clock;
  }

  /** The ES256 public key that verifies the client secret made with `appleEnv()`'s key. */
  get applePublicKeyForClientSecret(): KeyObject {
    return keyMaterial().clientSecret.publicKey;
  }

  /** The five APPLE_* values: the fixture ids and the client-secret key as PKCS#8 PEM text. */
  appleEnv(): Record<
    | 'APPLE_TEAM_ID'
    | 'APPLE_KEY_ID'
    | 'APPLE_PRIVATE_KEY'
    | 'APPLE_BUNDLE_ID'
    | 'APPLE_SERVICES_ID',
    string
  > {
    const pem = keyMaterial().clientSecret.privateKey.export({ type: 'pkcs8', format: 'pem' });
    return {
      APPLE_TEAM_ID: FIXTURE_APPLE.teamId,
      APPLE_KEY_ID: FIXTURE_APPLE.keyId,
      APPLE_PRIVATE_KEY: pem.toString(),
      APPLE_BUNDLE_ID: FIXTURE_APPLE.bundleId,
      APPLE_SERVICES_ID: FIXTURE_APPLE.servicesId,
    };
  }

  /** The two fixture client ids, comma-separated. */
  googleEnv(): { GOOGLE_CLIENT_IDS: string } {
    return { GOOGLE_CLIENT_IDS: FIXTURE_GOOGLE_CLIENT_IDS.join(',') };
  }

  /** An Apple identity token for the bundle id, issued now for 10 minutes; claims override. */
  appleIdToken(claims: AppleTokenClaims = {}, options: SignOptions = {}): Promise<string> {
    const iat = this.#nowSeconds();
    return this.#sign(
      'apple',
      {
        iss: APPLE_ISSUER,
        aud: FIXTURE_APPLE.bundleId,
        sub: '000123.fixture',
        iat,
        exp: iat + TOKEN_LIFE_S,
        ...claims,
      },
      options,
    );
  }

  /** A Google identity token for the web client id, issued now for 10 minutes; claims override. */
  googleIdToken(claims: GoogleTokenClaims = {}, options: SignOptions = {}): Promise<string> {
    const iat = this.#nowSeconds();
    return this.#sign(
      'google',
      {
        iss: GOOGLE_ISSUER,
        aud: FIXTURE_GOOGLE_CLIENT_IDS[0],
        sub: '1000000000000000001',
        iat,
        exp: iat + TOKEN_LIFE_S,
        ...claims,
      },
      options,
    );
  }

  /** An Apple server-to-server notice: `events` is the event as a JSON string, as Apple sends it. */
  appleNotification(
    event: AppleNotificationEvent,
    options: SignOptions & { aud?: string } = {},
  ): Promise<string> {
    const iat = this.#nowSeconds();
    return this.#sign(
      'apple',
      {
        iss: APPLE_ISSUER,
        aud: options.aud ?? FIXTURE_APPLE.bundleId,
        iat,
        exp: iat + TOKEN_LIFE_S,
        events: JSON.stringify(event),
      },
      options,
    );
  }

  /**
   * Registers Apple's `POST /auth/token` (a refresh token `fixture-refresh-<n>`, or 400
   * `invalid_grant` when `behaviour.token` is `'fail'`) and `POST /auth/revoke` (200, no body) on
   * the fake outbound. Each call is recorded.
   */
  registerAppleEndpoints(outbound: FakeOutbound, behaviour: { token?: 'ok' | 'fail' } = {}): void {
    outbound.on('appleid.apple.com', 'POST', '/auth/token', (request): FakeResponse => {
      const form = formOf(request);
      this.exchanges.push({
        clientId: form.get('client_id') ?? '',
        clientSecret: form.get('client_secret') ?? '',
        code: form.get('code') ?? '',
        grantType: form.get('grant_type') ?? '',
        redirectUri: form.get('redirect_uri'),
      });
      if (behaviour.token === 'fail') {
        return { status: 400, json: { error: 'invalid_grant' } };
      }
      this.#refreshCount += 1;
      return {
        status: 200,
        json: {
          access_token: 'fixture-access',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: `fixture-refresh-${String(this.#refreshCount)}`,
        },
      };
    });
    outbound.on('appleid.apple.com', 'POST', '/auth/revoke', (request): FakeResponse => {
      const form = formOf(request);
      this.revocations.push({
        clientId: form.get('client_id') ?? '',
        clientSecret: form.get('client_secret') ?? '',
        token: form.get('token') ?? '',
        tokenTypeHint: form.get('token_type_hint') ?? '',
      });
      return { status: 200 };
    });
  }

  #nowSeconds(): number {
    return Math.floor(this.#clock.now().getTime() / 1000);
  }

  #sign(
    provider: 'apple' | 'google',
    claims: Record<string, unknown>,
    options: SignOptions,
  ): Promise<string> {
    const keys = keyMaterial();
    const pair = options.foreignKey === true ? keys.foreign : keys[provider];
    const kid =
      options.foreignKey === true ? FOREIGN_KID : provider === 'apple' ? APPLE_KID : GOOGLE_KID;
    return new SignJWT(defined(claims))
      .setProtectedHeader({ alg: options.alg ?? 'RS256', kid, typ: 'JWT' })
      .sign(pair.privateKey);
  }
}
