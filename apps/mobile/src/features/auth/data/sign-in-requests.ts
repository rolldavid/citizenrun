import type { EmailStartResult, NonceResult, SessionInfo, SignupDetails } from '@citizenrun/shared';
import type { SignupDetails as SignupDetailsBody } from '@citizenrun/shared/api';
import {
  appleSignInHandoff,
  createAuthNonce,
  signInWithApple,
  signInWithGoogle,
  startEmailSignIn,
  verifyEmailSignIn,
} from '@citizenrun/shared/api';

import { attempt } from '@/lib/view-models/query';
import type { ApiFailure, Outcome } from '@/lib/view-models/query';

export type SignInIntent = 'sign_in' | 'reauth';

/** The wait a refusal carries (Retry-After), else null. */
export function retryAfterOf(failure: ApiFailure): number | null {
  return failure.kind === 'api' ? failure.retryAfterSeconds : null;
}

// The body's optional `state` key is present only when it holds a value.
function signupBody(signup: SignupDetails | undefined): { signup?: SignupDetailsBody } {
  if (signup === undefined) return {};
  const { state, ...rest } = signup;
  return { signup: { ...rest, ...(state === undefined ? {} : { state }) } };
}

// E-AUTH-01
export function requestEmailCode(body: {
  email: string;
  pendingToken?: string;
}): Promise<Outcome<EmailStartResult>> {
  return attempt(() => startEmailSignIn(body));
}

// E-AUTH-02
export function verifyEmailCode(body: {
  pendingToken: string;
  code: string;
  intent: SignInIntent | 'add_email';
  signup?: SignupDetails;
}): Promise<Outcome<SessionInfo>> {
  const { signup, ...rest } = body;
  return attempt(() => verifyEmailSignIn({ ...rest, ...signupBody(signup) }));
}

// E-AUTH-03
export function requestNonce(): Promise<Outcome<NonceResult>> {
  return attempt(() => createAuthNonce({}));
}

// E-AUTH-04
export function postAppleToken(body: {
  idToken: string;
  code: string | null;
  nonce: string;
  name?: { givenName: string | null; familyName: string | null };
  intent: SignInIntent;
  signup?: SignupDetails;
}): Promise<Outcome<SessionInfo>> {
  const { signup, ...rest } = body;
  return attempt(() => signInWithApple({ ...rest, ...signupBody(signup) }));
}

// E-AUTH-06
export function postAppleHandoff(body: {
  code: string;
  nonce: string;
  intent: SignInIntent;
  signup?: SignupDetails;
}): Promise<Outcome<SessionInfo>> {
  const { signup, ...rest } = body;
  return attempt(() => appleSignInHandoff({ ...rest, ...signupBody(signup) }));
}

// E-AUTH-08
export function postGoogleToken(body: {
  idToken: string;
  nonce: string;
  intent: SignInIntent;
  signup?: SignupDetails;
}): Promise<Outcome<SessionInfo>> {
  const { signup, ...rest } = body;
  return attempt(() => signInWithGoogle({ ...rest, ...signupBody(signup) }));
}
