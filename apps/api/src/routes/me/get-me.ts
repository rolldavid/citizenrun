import type { Context, Handler } from 'hono';
import { ErrorEnvelopeSchema, MeSchema } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import type { Platform } from '../../middleware/session.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { loadMe } from '../../services/me/load-me.ts';

/** The signed-in caller of an account route: the user, the session in use and the request's platform. */
export type SignedIn = { userId: string; sessionId: string; platform: Platform };

/**
 * Reads the viewer, the session and the `X-OS-Client` platform the middleware set. A route of level
 * `user` always has all three; their absence is a broken chain, never a caller's error.
 */
export function signedInOf(c: Context<RouterEnv>): SignedIn {
  const viewer = c.get('viewer');
  const session = c.get('session');
  const client = c.get('client');
  if (viewer === null || session === null || client === null) {
    throw new Error('The middleware chain set no viewer, session or client.');
  }
  return { userId: viewer.userId, sessionId: session.id, platform: client.value.platform };
}

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-01 `GET /v1/me`: the signed-in user's own account. */
export const getMeRoute = defineRoute({
  method: 'get',
  path: '/me',
  operationId: 'getMe',
  tags: ['me'],
  responses: {
    200: {
      description: "The signed-in user's account.",
      content: { 'application/json': { schema: MeSchema } },
    },
    400: { description: 'The client header is missing or malformed.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    426: { description: 'The build is too old.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.read' },
  errors: ['client_header_required', 'unauthenticated', 'upgrade_required', 'rate_limited'],
});

/** The handler of E-ME-01. */
export function getMeHandler(deps: Deps): Handler<RouterEnv> {
  return async (c) => {
    const { userId, sessionId } = signedInOf(c);
    const now = deps.clock.now();
    return respond(c, MeSchema, await loadMe(deps, { userId, sessionId, now }));
  };
}
