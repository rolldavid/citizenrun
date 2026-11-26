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
import { followOffice } from '../../services/offices/office-toggles.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-OFF-04 `POST /v1/offices/:id/follow`: follows an office; a repeat answers the same. */
export const followOfficeRoute = defineRoute({
  method: 'post',
  path: '/offices/{id}/follow',
  operationId: 'followOffice',
  tags: ['offices'],
  request: { params: OfficeIdParamsSchema },
  responses: {
    200: {
      description: 'The viewer follows the office.',
      content: { 'application/json': { schema: OfficeFollowStateSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description:
        'Onboarding is not finished, the request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    404: { description: 'No office has that id.', content: ERROR_RESPONSE },
    422: { description: 'The office is retired.', content: ERROR_RESPONSE },
    429: {
      description: 'The daily follow limit is reached, or too many requests.',
      content: ERROR_RESPONSE,
    },
  },
  meta: { auth: 'onboarded', rateLimit: 'office_toggle' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'onboarding_incomplete',
    'origin_rejected',
    'account_suspended',
    'not_found',
    'office_retired',
    'daily_limit_reached',
    'rate_limited',
  ],
});

type OfficeIdInput = {
  in: { param: Record<string, string> };
  out: { param: OfficeIdParams };
};

/** The handler of E-OFF-04. */
export function followOfficeHandler(deps: Deps): Handler<RouterEnv, string, OfficeIdInput> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const viewer = c.get('viewer');
    if (viewer === null) {
      throw new Error('The middleware chain set no viewer.');
    }
    const now = deps.clock.now();
    const state = await followOffice(deps, {
      viewer: { userId: viewer.userId, createdAt: viewer.createdAt },
      officeId: id,
      now,
    });
    return respond(c, OfficeFollowStateSchema, state);
  };
}
