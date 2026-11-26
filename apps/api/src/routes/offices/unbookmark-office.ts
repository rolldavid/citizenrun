import type { Handler } from 'hono';
import {
  ErrorEnvelopeSchema,
  OfficeBookmarkStateSchema,
  OfficeIdParamsSchema,
} from '@citizenrun/shared';
import type { OfficeIdParams } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { unbookmarkOffice } from '../../services/offices/office-toggles.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-OFF-07 `DELETE /v1/offices/:id/bookmark`: removes a saved office; a missing one answers the same. */
export const unbookmarkOfficeRoute = defineRoute({
  method: 'delete',
  path: '/offices/{id}/bookmark',
  operationId: 'unbookmarkOffice',
  tags: ['offices'],
  request: { params: OfficeIdParamsSchema },
  responses: {
    200: {
      description: 'The office is not saved.',
      content: { 'application/json': { schema: OfficeBookmarkStateSchema } },
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

/** The handler of E-OFF-07. */
export function unbookmarkOfficeHandler(deps: Deps): Handler<RouterEnv, string, OfficeIdInput> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const viewer = c.get('viewer');
    if (viewer === null) {
      throw new Error('The middleware chain set no viewer.');
    }
    const state = await unbookmarkOffice(deps, { userId: viewer.userId, officeId: id });
    return respond(c, OfficeBookmarkStateSchema, state);
  };
}
