import type { Handler } from 'hono';
import { ErrorEnvelopeSchema, LogoutBodySchema } from '@citizenrun/shared';
import type { LogoutBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { clearSessionCookie } from '../../middleware/session-cookie.ts';
import { publicSessionOptions } from '../../middleware/session.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { logout } from '../../services/auth/logout.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-AUTH-09 `POST /v1/auth/logout`: ends this session; on the web the cookie is cleared. */
export const logoutRoute = defineRoute({
  method: 'post',
  path: '/auth/logout',
  operationId: 'logout',
  tags: ['auth'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: LogoutBodySchema } },
    },
  },
  responses: {
    204: { description: 'Signed out; on the web the session cookie is cleared.' },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'The bearer token does not resolve.', content: ERROR_RESPONSE },
    403: { description: 'The request-forgery check failed.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: {
    auth: 'optional',
    rateLimit: 'auth.logout',
    public: true,
    allowWhenSuspended: true,
  },
  errors: ['invalid_request', 'unauthenticated', 'origin_rejected', 'rate_limited'],
});

type LogoutInput = {
  in: { json: unknown };
  out: { json: LogoutBody };
};

/** The handler of E-AUTH-09. The session token is never logged. */
export function logoutHandler(deps: Deps): Handler<RouterEnv, string, LogoutInput> {
  return async (c) => {
    // The body is `{}` (LogoutBody): validation has stripped every key, so nothing is read from it.
    await logout(deps.db, c.get('session')?.id ?? null);
    if (c.get('client')?.value.platform === 'web') {
      clearSessionCookie(c, publicSessionOptions(deps.env.PUBLIC_URL));
    }
    return c.body(null, 204);
  };
}
