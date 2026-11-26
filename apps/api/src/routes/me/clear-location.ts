import type { Handler } from 'hono';
import { ErrorEnvelopeSchema } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { clearLocation } from '../../services/me/clear-location.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-14 `DELETE /v1/me/location`: forgets the user's districts. */
export const clearLocationRoute = defineRoute({
  method: 'delete',
  path: '/me/location',
  operationId: 'clearLocation',
  tags: ['me'],
  responses: {
    204: { description: 'The districts are forgotten.' },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.location' },
  errors: ['unauthenticated', 'origin_rejected', 'account_suspended', 'rate_limited'],
});

/** The handler of E-ME-14; a repeat answers 204 too. */
export function clearLocationHandler(deps: Deps): Handler<RouterEnv> {
  return async (c) => {
    const { userId } = signedInOf(c);
    await clearLocation(deps.db, { userId });
    return c.body(null, 204);
  };
}
