import type { Handler } from 'hono';
import { AccountDeletionViewSchema, ErrorEnvelopeSchema } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { clearSessionCookie } from '../../middleware/session-cookie.ts';
import { publicSessionOptions } from '../../middleware/session.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { requestAccountDeletion } from '../../services/me/delete-account.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-03 `DELETE /v1/me`: marks the account deleting and ends every session; on the web the cookie is cleared. */
export const deleteMeRoute = defineRoute({
  method: 'delete',
  path: '/me',
  operationId: 'deleteMe',
  tags: ['me'],
  responses: {
    202: {
      description: 'The deletion is under way; on the web the session cookie is cleared.',
      content: { 'application/json': { schema: AccountDeletionViewSchema } },
    },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the sign-in is not recent enough.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: {
    auth: 'user',
    rateLimit: 'me.delete',
    recentSignIn: '15m',
    allowWhenSuspended: true,
  },
  errors: ['unauthenticated', 'origin_rejected', 'recent_sign_in_required', 'rate_limited'],
});

/** The handler of E-ME-03. */
export function deleteMeHandler(deps: Deps): Handler<RouterEnv> {
  return async (c) => {
    const { userId, platform } = signedInOf(c);
    const now = deps.clock.now();
    const deletion = await requestAccountDeletion(deps, { userId, now });
    if (platform === 'web') {
      clearSessionCookie(c, publicSessionOptions(deps.env.PUBLIC_URL));
    }
    return respond(c, AccountDeletionViewSchema, deletion, 202);
  };
}
