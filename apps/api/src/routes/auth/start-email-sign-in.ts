import type { Handler } from 'hono';
import {
  EmailStartResultSchema,
  ErrorEnvelopeSchema,
  StartEmailSignInBodySchema,
} from '@citizenrun/shared';
import type { StartEmailSignInBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { startEmailSignIn } from '../../services/auth/email-codes.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-AUTH-01 `POST /v1/auth/email/start`: sends a sign-in code, or resends one. */
export const startEmailSignInRoute = defineRoute({
  method: 'post',
  path: '/auth/email/start',
  operationId: 'startEmailSignIn',
  tags: ['auth'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: StartEmailSignInBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The challenge, its expiry and the earliest resend.',
      content: { 'application/json': { schema: EmailStartResultSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    403: { description: 'The request-forgery check failed.', content: ERROR_RESPONSE },
    422: { description: 'Email to this address is not deliverable.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
    503: {
      description: 'Email sign-in is paused, or the mail provider failed.',
      content: ERROR_RESPONSE,
    },
  },
  meta: { auth: 'none', rateLimit: 'auth.emailStart', public: true },
  errors: [
    'invalid_request',
    'client_header_required',
    'origin_rejected',
    'email_undeliverable',
    'rate_limited',
    'email_signin_paused',
    'unavailable',
  ],
});

type StartEmailSignInInput = {
  in: { json: unknown };
  out: { json: StartEmailSignInBody };
};

/** The handler of E-AUTH-01. The body is never logged. */
export function startEmailSignInHandler(
  deps: Deps,
): Handler<RouterEnv, string, StartEmailSignInInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const result = await startEmailSignIn(deps, deps.env, {
      email: body.email,
      pendingToken: body.pendingToken ?? null,
      now: deps.clock.now(),
    });
    return respond(c, EmailStartResultSchema, result);
  };
}
