import { SignJWT, importPKCS8, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { ApiError } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import type { ApiEnv } from '../../env.ts';
import { OUTBOUND_HOSTS } from '../../lib/outbound-fetch.ts';
import type { IdentityInput } from './resolve-identity.ts';

/** The five Apple values a configured process holds (L-apple). */
export type AppleConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  servicesId: string;
};

/** The claims of a verified Apple identity token that sign-in reads. */
export type AppleIdClaims = {
  sub: string;
  aud: string;
  nonce: string | null;
  nonceSupported: boolean;
  email: string | null;
  emailVerified: boolean;
  isPrivateEmail: boolean;
};

/** Apple's issuer, and the audience of a client secret (L-apple). */
export const APPLE_ISSUER = 'https://appleid.apple.com';
/** Seconds of clock skew every provider token is allowed (D-241). */
export const PROVIDER_CLOCK_TOLERANCE_S = 60;
/** The one algorithm a provider token may use (D-241). */
export const PROVIDER_TOKEN_ALGORITHMS = ['RS256'];

// The client secret lives an hour and is reused for 50 minutes (D-242).
const CLIENT_SECRET_LIFE_S = 3600;
const CLIENT_SECRET_REUSE_MS = 50 * 60 * 1000;
const MS_PER_SECOND = 1000;
const TOKEN_PATH = '/auth/token';
const CALLBACK_PATH = '/v1/auth/apple/callback';
const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
// The class logged for an answer from Apple that is not a refresh token.
const UNEXPECTED_RESPONSE = 'UnexpectedResponse';
const HTTP_OK = 200;

/** The five APPLE_* values, or null while any one is unset (03a 1.25, PC3A-47). */
export function appleConfig(env: ApiEnv): AppleConfig | null {
  const {
    APPLE_TEAM_ID: teamId,
    APPLE_KEY_ID: keyId,
    APPLE_PRIVATE_KEY: privateKey,
    APPLE_BUNDLE_ID: bundleId,
    APPLE_SERVICES_ID: servicesId,
  } = env;
  if (
    teamId === null ||
    keyId === null ||
    privateKey === null ||
    bundleId === null ||
    servicesId === null
  ) {
    return null;
  }
  return { teamId, keyId, privateKey, bundleId, servicesId };
}

// Apple may send a boolean claim as a string (CTL-13).
function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

function isFalse(value: unknown): boolean {
  return value === false || value === 'false';
}

const AppleClaimsSchema = z.object({
  sub: z.string().min(1),
  aud: z.string(),
  nonce: z.string().optional(),
  nonce_supported: z.unknown().optional(),
  email: z.string().optional(),
  email_verified: z.unknown().optional(),
  is_private_email: z.unknown().optional(),
});

/** Throws ApiError('identity_token_invalid') on any failure. */
export async function verifyAppleIdToken(
  keys: JWTVerifyGetKey,
  idToken: string,
  audiences: readonly string[],
  now: Date,
): Promise<AppleIdClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: APPLE_ISSUER,
      audience: [...audiences],
      algorithms: PROVIDER_TOKEN_ALGORITHMS,
      clockTolerance: PROVIDER_CLOCK_TOLERANCE_S,
      currentDate: now,
    }));
  } catch {
    throw new ApiError('identity_token_invalid');
  }
  const parsed = AppleClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError('identity_token_invalid');
  }
  const claims = parsed.data;
  return {
    sub: claims.sub,
    aud: claims.aud,
    nonce: claims.nonce ?? null,
    nonceSupported: !isFalse(claims.nonce_supported),
    email: claims.email === undefined ? null : claims.email.toLowerCase(),
    emailVerified: isTrue(claims.email_verified),
    isPrivateEmail: isTrue(claims.is_private_email),
  };
}

/** True when the token's nonce claim equals nonceHash, or the token says nonce_supported is false (D-241). */
export function appleNonceMatches(claims: AppleIdClaims, nonceHash: string): boolean {
  return !claims.nonceSupported || claims.nonce === nonceHash;
}

/** Input V of L-account-link for an Apple token (D-245). */
export function appleIdentityInput(claims: AppleIdClaims): IdentityInput {
  return {
    provider: 'apple',
    subject: claims.sub,
    email: claims.email,
    emailVerified: claims.emailVerified,
    emailVerifiedAuthoritative: claims.email !== null && claims.emailVerified,
    isPrivateEmail: claims.isPrivateEmail,
  };
}

// One cache of client secrets per app, keyed by client id (D-242, D-462). A WeakMap holds no
// connection and starts no timer.
const clientSecrets = new WeakMap<Deps, Map<string, { secret: string; madeAt: number }>>();

/** The ES256 client secret for `clientId`, made at most every 50 minutes per app (D-242). */
export async function appleClientSecret(
  deps: Deps,
  config: AppleConfig,
  clientId: string,
  now: Date,
): Promise<string> {
  let cache = clientSecrets.get(deps);
  if (cache === undefined) {
    cache = new Map();
    clientSecrets.set(deps, cache);
  }
  const nowMs = now.getTime();
  const cached = cache.get(clientId);
  if (cached !== undefined && nowMs - cached.madeAt < CLIENT_SECRET_REUSE_MS) {
    return cached.secret;
  }
  const iat = Math.floor(nowMs / MS_PER_SECOND);
  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + CLIENT_SECRET_LIFE_S)
    .setAudience(APPLE_ISSUER)
    .setSubject(clientId)
    .sign(await importPKCS8(config.privateKey, 'ES256'));
  cache.set(clientId, { secret, madeAt: nowMs });
  return secret;
}

// The class a failure is logged under; never the error's text, which may hold a value.
function errorClassOf(error: unknown): string {
  try {
    const name: unknown = error instanceof Error ? error.name : undefined;
    return typeof name === 'string' && ERROR_CLASS_PATTERN.test(name) ? name : 'Error';
  } catch {
    return 'Error';
  }
}

const TokenAnswerSchema = z.object({ refresh_token: z.string() });

/**
 * Exchanges Apple's authorization code once, with no retry (the code is single-use). The refresh
 * token, or null after logging `auth.apple_exchange_failed` with the error class only (D-242).
 */
export async function exchangeAppleCode(
  deps: Deps,
  config: AppleConfig,
  input: { code: string; clientId: string; publicUrl: string; now: Date; log: Logger },
): Promise<string | null> {
  const { clientId } = input;
  try {
    const clientSecret = await appleClientSecret(deps, config, clientId, input.now);
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: input.code,
      grant_type: 'authorization_code',
      ...(clientId === config.servicesId ? { redirect_uri: input.publicUrl + CALLBACK_PATH } : {}),
    });
    const response = await deps.outbound(OUTBOUND_HOSTS.apple, TOKEN_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: form,
    });
    if (response.status !== HTTP_OK) {
      await response.body?.cancel();
      input.log.warn('auth.apple_exchange_failed', { errorClass: UNEXPECTED_RESPONSE });
      return null;
    }
    let answer: unknown;
    try {
      answer = await response.json();
    } catch {
      answer = null;
    }
    const parsed = TokenAnswerSchema.safeParse(answer);
    if (!parsed.success) {
      input.log.warn('auth.apple_exchange_failed', { errorClass: UNEXPECTED_RESPONSE });
      return null;
    }
    return parsed.data.refresh_token;
  } catch (error) {
    input.log.warn('auth.apple_exchange_failed', { errorClass: errorClassOf(error) });
    return null;
  }
}
