import { SignJWT, importPKCS8 } from 'jose';
import type { WorkerEnv } from '../../env.ts';
import { OUTBOUND_HOSTS, OUTBOUND_TIMEOUT_MS } from '../../lib/outbound-fetch.ts';
import type { OutboundFetch } from '../../lib/outbound-fetch.ts';
import { RetryableJobError } from '../types.ts';

/** The worker's three Apple values, all present. */
export type AppleRevokeConfig = { teamId: string; keyId: string; privateKeyPem: string };

// The audience of an Apple client secret (D-242).
const APPLE_AUDIENCE = 'https://appleid.apple.com';
// A client secret lives one hour (D-242).
const CLIENT_SECRET_TTL_S = 3600;
const REVOKE_PATH = '/auth/revoke';

const OK = 200;
const TOO_MANY_REQUESTS = 429;
const FIRST_CLIENT_ERROR = 400;
const FIRST_SERVER_ERROR = 500;

/** The worker's three Apple variables, or null while any of them is unset (OI-apple-identifiers). */
export function appleRevokeConfig(
  env: Pick<WorkerEnv, 'APPLE_TEAM_ID' | 'APPLE_KEY_ID' | 'APPLE_PRIVATE_KEY'>,
): AppleRevokeConfig | null {
  const { APPLE_TEAM_ID: teamId, APPLE_KEY_ID: keyId, APPLE_PRIVATE_KEY: privateKeyPem } = env;
  if (teamId === null || keyId === null || privateKeyPem === null) {
    return null;
  }
  return { teamId, keyId, privateKeyPem };
}

/**
 * The ES256 client secret: header { alg: 'ES256', kid }, claims { iss, iat, exp: iat + 3600, aud:
 * 'https://appleid.apple.com', sub: clientId }. A new secret for each call; nothing is cached.
 */
export async function appleClientSecret(
  config: AppleRevokeConfig,
  clientId: string,
  now: Date,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const key = await importPKCS8(config.privateKeyPem, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + CLIENT_SECRET_TTL_S)
    .setAudience(APPLE_AUDIENCE)
    .setSubject(clientId)
    .sign(key);
}

// Why a call that never answered failed; a fixed code, never the error's text.
function unansweredReason(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) {
    return 'shutdown';
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'timeout';
  }
  return 'network';
}

/**
 * POST /auth/revoke; 'revoked' on 200, 'rejected' on any other 4xx but 429; throws
 * RetryableJobError on 429, 5xx, a network error or the timeout. Reads the status only, never the
 * body, and logs nothing: the token, the secret and the subject never reach a log.
 */
export async function revokeAppleToken(
  outbound: OutboundFetch,
  args: {
    config: AppleRevokeConfig;
    clientId: string;
    refreshToken: string;
    now: Date;
    signal: AbortSignal;
  },
): Promise<'revoked' | 'rejected'> {
  const clientSecret = await appleClientSecret(args.config, args.clientId, args.now);
  let response: Response;
  try {
    response = await outbound(OUTBOUND_HOSTS.apple, REVOKE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: args.clientId,
        client_secret: clientSecret,
        token: args.refreshToken,
        token_type_hint: 'refresh_token',
      }).toString(),
      // CTL-37: Apple answers within 5 seconds or the call is abandoned.
      signal: AbortSignal.any([args.signal, AbortSignal.timeout(OUTBOUND_TIMEOUT_MS.apple)]),
    });
  } catch (error) {
    throw new RetryableJobError(unansweredReason(error, args.signal));
  }
  const { status } = response;
  // The body is never read; cancelling it frees the connection.
  await response.body?.cancel().catch(() => undefined);
  if (status === OK) {
    return 'revoked';
  }
  if (status === TOO_MANY_REQUESTS) {
    throw new RetryableJobError('provider_429');
  }
  if (status >= FIRST_SERVER_ERROR) {
    throw new RetryableJobError('provider_5xx');
  }
  if (status >= FIRST_CLIENT_ERROR) {
    // Apple's invalid_grant or invalid_client: already revoked, or never revocable.
    return 'rejected';
  }
  throw new RetryableJobError('unexpected_status');
}
