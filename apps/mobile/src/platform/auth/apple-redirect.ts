import type { AppleCallbackError, AppleSignInResult } from './types';

export type AuthorizeInput = {
  servicesId: string;
  apiOrigin: string;
  state: string;
  nonceHash: string;
};

/** The auth session's answer, as `parseAppleReturn` reads it. */
export type AuthSessionReturn =
  { type: 'success'; url: string } | { type: 'cancel' | 'dismiss' | 'locked' | 'opened' };

/** E-AUTH-05's redirect reasons other than `cancelled`. */
export const APPLE_CALLBACK_ERRORS = [
  'state_invalid',
  'token_invalid',
  'nonce_invalid',
  'account_deleting',
  'account_banned',
  'signups_closed',
  'signup_limit_reached',
  'rate_limited',
  'invalid_request',
  'unavailable',
  'provider_not_configured',
] as const satisfies readonly AppleCallbackError[];

const HANDOFF_CODE = /^[A-Za-z0-9_-]{43}$/;

function isAppleCallbackError(value: string): value is AppleCallbackError {
  return (APPLE_CALLBACK_ERRORS as readonly string[]).includes(value);
}

/** The authorize URL of PM-auth's Android flow: exactly seven parameters. */
export function appleAuthorizeUrl(input: AuthorizeInput): string {
  const params = new URLSearchParams({
    client_id: input.servicesId,
    redirect_uri: input.apiOrigin + '/v1/auth/apple/callback',
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope: 'name email',
    state: input.state,
    nonce: input.nonceHash,
  });
  return 'https://appleid.apple.com/auth/authorize?' + params.toString();
}

/** The redirect the auth session waits for (E-AUTH-05's Location). */
export function appleReturnUrl(scheme: string): string {
  return `${scheme}://auth/apple`;
}

function sameState(received: string | null, expected: string): boolean {
  if (received === null || received.length !== expected.length) {
    return false;
  }
  return received === expected;
}

/** Maps the auth session's result to an AppleSignInResult. Never throws and never logs. */
export function parseAppleReturn(
  result: AuthSessionReturn,
  expectedState: string,
): AppleSignInResult {
  if (result.type !== 'success') {
    return { kind: 'cancelled' };
  }
  let params: URLSearchParams;
  try {
    params = new URL(result.url).searchParams;
  } catch {
    return { kind: 'failed', code: 'auth.provider_error' };
  }
  const error = params.get('error');
  if (error !== null) {
    if (error === 'cancelled') {
      return { kind: 'cancelled' };
    }
    return isAppleCallbackError(error)
      ? { kind: 'server_refused', reason: error }
      : { kind: 'failed', code: 'auth.provider_error' };
  }
  if (!sameState(params.get('state'), expectedState)) {
    return { kind: 'failed', code: 'auth.state_mismatch' };
  }
  const code = params.get('code');
  if (code === null || !HANDOFF_CODE.test(code)) {
    return { kind: 'failed', code: 'auth.provider_error' };
  }
  return { kind: 'handoff', code };
}
