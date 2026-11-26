import type { Handler } from 'hono';
import { CheckHandleQuerySchema, ErrorEnvelopeSchema, HandleCheckSchema } from '@citizenrun/shared';
import type { CheckHandleQuery } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { checkHandleAvailability } from '../../services/me/handles.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-07 `GET /v1/handles/check`: whether a typed handle can be taken. */
export const checkHandleRoute = defineRoute({
  method: 'get',
  path: '/handles/check',
  operationId: 'checkHandle',
  tags: ['me'],
  request: { query: CheckHandleQuerySchema },
  responses: {
    200: {
      description: 'The normalised handle and whether it can be taken.',
      content: { 'application/json': { schema: HandleCheckSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.handleCheck' },
  errors: ['invalid_request', 'unauthenticated', 'rate_limited'],
});

type CheckHandleInput = {
  in: { query: Record<string, string> };
  out: { query: CheckHandleQuery };
};

/** The handler of E-ME-07. The typed value is never logged. */
export function checkHandleHandler(deps: Deps): Handler<RouterEnv, string, CheckHandleInput> {
  return async (c) => {
    const query = c.req.valid('query');
    const { userId } = signedInOf(c);
    const now = deps.clock.now();
    const result = await checkHandleAvailability(
      deps.db,
      { userId, raw: query.handle, now },
      deps.keyRing,
    );
    return respond(c, HandleCheckSchema, result);
  };
}
