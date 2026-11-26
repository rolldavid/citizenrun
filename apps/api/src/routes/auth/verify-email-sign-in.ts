import type { Handler } from 'hono';
import {
  ErrorEnvelopeSchema,
  SessionInfoSchema,
  VerifyEmailSignInBodySchema,
} from '@citizenrun/shared';
import type { VerifyEmailSignInBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { parseAdminEmails } from '../../middleware/gates.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { answerSignIn } from '../../services/auth/complete-sign-in.ts';
import { verifyEmailSignIn } from '../../services/auth/email-codes.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-AUTH-02 `POST /v1/auth/email/verify`: signs in with the code of a challenge. */
export const verifyEmailSignInRoute = defineRoute({
  method: 'post',
  path: '/auth/email/verify',
  operationId: 'verifyEmailSignIn',
  tags: ['auth'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: VerifyEmailSignInBodySchema } },
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
      description: 'The code or the sign-up details cannot be used.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests or sign-ups.', content: ERROR_RESPONSE },
  },
  meta: {
    auth: 'optional',
    rateLimit: 'auth.emailVerify',
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
    'email_already_set',
    'email_in_use',
    'code_expired',
    'code_invalid',
    'code_attempts_exhausted',
    'signup_details_required',
    'consent_version_outdated',
    'rate_limited',
    'signup_limit_reached',
  ],
});

type VerifyEmailSignInInput = {
  in: { json: unknown };
  out: { json: VerifyEmailSignInBody };
};

/** The handler of E-AUTH-02. The body, the code and the session token are never logged. */
export function verifyEmailSignInHandler(
  deps: Deps,
): Handler<RouterEnv, string, VerifyEmailSignInInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const client = c.get('client');
    const addrHash = c.get('addrHash');
    if (client === null || addrHash === null) {
      throw new Error('The middleware chain set no client or address hash.');
    }
    const session = c.get('session');
    const now = deps.clock.now();
    const result = await verifyEmailSignIn(deps, deps.env, {
      pendingToken: body.pendingToken,
      code: body.code,
      intent: body.intent,
      signup: body.signup ?? null,
      viewer: c.get('viewer'),
      session: session === null ? null : { id: session.id, expiresAt: session.expiresAt },
      platform: client.value.platform,
      addrHash,
      now,
    });
    return answerSignIn(c, deps, {
      userId: result.userId,
      session: result.session,
      keptSession: result.keptSession,
      created: result.created,
      platform: client.value.platform,
      now,
      adminEmails: parseAdminEmails(deps.env.ADMIN_EMAILS),
      publicUrl: deps.env.PUBLIC_URL,
    });
  };
}
