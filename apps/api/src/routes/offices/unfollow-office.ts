import type { Handler } from 'hono';
import {
  ErrorEnvelopeSchema,
  OfficeFollowStateSchema,
  OfficeIdParamsSchema,
} from '@citizenrun/shared';
import type { OfficeIdParams } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { unfollowOffice } from '../../services/offices/office-toggles.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-OFF-05 `DELETE /v1/offices/:id/follow`: stops following; a missing follow answers the same. */
export const unfollowOfficeRoute = defineRoute({
  method: 'delete',
  path: '/offices/{id}/follow',
  operationId: 'unfollowOffice',
  tags: ['offices'],
  request: { params: OfficeIdParamsSchema },
  responses: {
    200: {
      description: 'The viewer does not follow the office.',
      content: { 'application/json': { schema: OfficeFollowStateSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'office_toggle' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_suspended',
    'rate_limited',
  ],
});

type OfficeIdInput = {
  in: { param: Record<string, string> };
  out: { param: OfficeIdParams };
};

/** The handler of E-OFF-05. */
export function unfollowOfficeHandler(deps: Deps): Handler<RouterEnv, string, OfficeIdInput> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const viewer = c.get('viewer');
    if (viewer === null) {
      throw new Error('The middleware chain set no viewer.');
    }
    const state = await unfollowOffice(deps, { userId: viewer.userId, officeId: id });
    return respond(c, OfficeFollowStateSchema, state);
  };
}
