import type { Handler } from 'hono';
import { ErrorEnvelopeSchema, MeSchema, SetHandleBodySchema } from '@citizenrun/shared';
import type { SetHandleBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { setHandle } from '../../services/me/handles.ts';
import { loadMe } from '../../services/me/load-me.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-08 `PUT /v1/me/handle`: sets or changes the handle. */
export const setHandleRoute = defineRoute({
  method: 'put',
  path: '/me/handle',
  operationId: 'setHandle',
  tags: ['me'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SetHandleBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The account with its handle.',
      content: { 'application/json': { schema: MeSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    409: { description: 'The handle is reserved or taken.', content: ERROR_RESPONSE },
    422: { description: 'The handle changed too recently.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.handleSet' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_suspended',
    'handle_reserved',
    'handle_taken',
    'handle_change_too_soon',
    'rate_limited',
  ],
});

type SetHandleInput = {
  in: { json: unknown };
  out: { json: SetHandleBody };
};

/** The handler of E-ME-08. The typed handle is never logged. */
export function setHandleHandler(deps: Deps): Handler<RouterEnv, string, SetHandleInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const { userId, sessionId, platform } = signedInOf(c);
    const now = deps.clock.now();
    await setHandle(deps.db, { userId, raw: body.handle, now, platform }, deps.keyRing);
    return respond(c, MeSchema, await loadMe(deps, { userId, sessionId, now }));
  };
}
