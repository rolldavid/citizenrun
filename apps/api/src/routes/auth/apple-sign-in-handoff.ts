import type { Handler } from 'hono';
import { AppleHandoffBodySchema, ErrorEnvelopeSchema, SessionInfoSchema } from '@citizenrun/shared';
import type { AppleHandoffBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { parseAdminEmails } from '../../middleware/gates.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { appleHandoff } from '../../services/auth/apple-handoff.ts';
import { answerSignIn } from '../../services/auth/complete-sign-in.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-AUTH-06 `POST /v1/auth/apple/handoff`: the Android app trades the hand-off code and its nonce for a session. */
export const appleSignInHandoffRoute = defineRoute({
  method: 'post',
  path: '/auth/apple/handoff',
  operationId: 'appleSignInHandoff',
  tags: ['auth'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: AppleHandoffBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Signed in; the session token is in the body.',
      content: { 'application/json': { schema: SessionInfoSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'The intent needs a session.', content: ERROR_RESPONSE },
    403: { description: 'The sign-in is refused.', content: ERROR_RESPONSE },
    409: { description: 'The intent conflicts with the account.', content: ERROR_RESPONSE },
    422: {
      description: 'The hand-off code or the sign-up details cannot be used.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
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
    'account_deleting',
    'reauth_mismatch',
    'handoff_invalid',
    'signup_details_required',
    'consent_version_outdated',
    'unavailable_in_state',
    'age_signal_required',
    'rate_limited',
  ],
});

type AppleSignInHandoffInput = {
  in: { json: unknown };
  out: { json: AppleHandoffBody };
};

/** The handler of E-AUTH-06. Never logged: the code, the nonce and the session token. */
export function appleSignInHandoffHandler(
  deps: Deps,
): Handler<RouterEnv, string, AppleSignInHandoffInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const client = c.get('client');
    const addrHash = c.get('addrHash');
    if (client === null || addrHash === null) {
      throw new Error('The middleware chain set no client or address hash.');
    }
    const session = c.get('session');
    const platform = client.value.platform;
    const now = deps.clock.now();
    const result = await appleHandoff(deps, deps.env, {
      code: body.code,
      nonce: body.nonce,
      intent: body.intent,
      signup: body.signup ?? null,
      viewer: c.get('viewer'),
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
