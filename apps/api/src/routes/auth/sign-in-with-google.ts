import type { Handler } from 'hono';
import {
  ApiError,
  ErrorEnvelopeSchema,
  SessionInfoSchema,
  SignInWithGoogleBodySchema,
} from '@citizenrun/shared';
import type { SignInWithGoogleBody } from '@citizenrun/shared';
import { sha256Hex } from '@citizenrun/shared/crypto';
import type { Deps } from '../../deps.ts';
import { parseAdminEmails } from '../../middleware/gates.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { answerSignIn } from '../../services/auth/complete-sign-in.ts';
import {
  googleAudiences,
  googleIdentityInput,
  verifyGoogleIdToken,
} from '../../services/auth/google.ts';
import { providerSignIn } from '../../services/auth/provider-sign-in.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-AUTH-08 `POST /v1/auth/google`: signs in with a Google identity token. */
export const signInWithGoogleRoute = defineRoute({
  method: 'post',
  path: '/auth/google',
  operationId: 'signInWithGoogle',
  tags: ['auth'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SignInWithGoogleBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Signed in; on the web the session cookie is set and the token is null.',
      content: { 'application/json': { schema: SessionInfoSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'The intent needs a session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the sign-in is refused.',
      content: ERROR_RESPONSE,
    },
    409: { description: 'The intent conflicts with the account.', content: ERROR_RESPONSE },
    422: {
      description: 'The token, the nonce or the sign-up details cannot be used.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests or sign-ups.', content: ERROR_RESPONSE },
    503: { description: 'Google sign-in is not configured.', content: ERROR_RESPONSE },
  },
  meta: {
    auth: 'optional',
    rateLimit: 'auth.token',
    public: true,
    allowWhenSuspended: true,
  },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_deleting',
    'unavailable_in_state',
    'age_signal_required',
    'reauth_mismatch',
    'identity_token_invalid',
    'nonce_invalid',
    'signup_details_required',
    'consent_version_outdated',
    'rate_limited',
    'signup_limit_reached',
    'provider_not_configured',
  ],
});

type SignInWithGoogleInput = {
  in: { json: unknown };
  out: { json: SignInWithGoogleBody };
};

/** The handler of E-AUTH-08. Never logged: the token, the nonce and the email. */
export function signInWithGoogleHandler(
  deps: Deps,
): Handler<RouterEnv, string, SignInWithGoogleInput> {
  return async (c) => {
    const body = c.req.valid('json');
    // Before anything else: no token is verified without its audiences (PC3A-47).
    const audiences = googleAudiences(deps.env);
    if (audiences.length === 0) {
      throw new ApiError('provider_not_configured');
    }
    const viewer = c.get('viewer');
    if (body.intent === 'reauth' && viewer === null) {
      throw new ApiError('unauthenticated');
    }
    const client = c.get('client');
    const addrHash = c.get('addrHash');
    if (client === null || addrHash === null) {
      throw new Error('The middleware chain set no client or address hash.');
    }
    const now = deps.clock.now();
    const claims = await verifyGoogleIdToken(
      deps.identityKeys.google,
      body.idToken,
      audiences,
      now,
    );
    const session = c.get('session');
    const platform = client.value.platform;
    const result = await providerSignIn(deps, deps.env, {
      identity: googleIdentityInput(claims),
      method: 'google',
      rawNonce: body.nonce,
      nonceClaimOk: claims.nonce === sha256Hex(body.nonce),
      intent: body.intent,
      signup: body.signup ?? null,
      name: null,
      clientId: null,
      exchange: null,
      viewer,
      session: session === null ? null : { id: session.id },
      platform,
      addrHash,
      now,
    });
    return answerSignIn(c, deps, {
      userId: result.userId,
      session: result.session,
      keptSession: null,
      created: result.created,
      platform,
      now,
      adminEmails: parseAdminEmails(deps.env.ADMIN_EMAILS),
      publicUrl: deps.env.PUBLIC_URL,
    });
  };
}
