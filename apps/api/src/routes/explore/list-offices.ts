import type { Handler } from 'hono';
import {
  ErrorEnvelopeSchema,
  ListOfficesQuerySchema,
  OfficeListPageSchema,
  parseOfficeListQuery,
} from '@citizenrun/shared';
import type { ListOfficesQuery } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { listOffices } from '../../services/explore/list-offices.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-EXP-01 `GET /v1/offices`: Home's and Explore's office list. */
export const listOfficesRoute = defineRoute({
  method: 'get',
  path: '/offices',
  operationId: 'listOffices',
  tags: ['explore'],
  request: { query: ListOfficesQuerySchema },
  responses: {
    200: {
      description:
        'One page of offices in the sort order, and the number of matches on a district, jurisdiction or own-districts list.',
      content: { 'application/json': { schema: OfficeListPageSchema } },
    },
    400: { description: 'The request or the cursor is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    422: { description: 'The area holds more than 5,000 offices.', content: ERROR_RESPONSE },
    426: { description: 'The build is too old.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'explore_list' },
  errors: [
    'invalid_request',
    'invalid_cursor',
    'unauthenticated',
    'client_header_required',
    'area_too_large',
    'upgrade_required',
    'rate_limited',
  ],
});

type ListOfficesInput = {
  in: { query: Record<string, string> };
  out: { query: ListOfficesQuery };
};

/** The handler of E-EXP-01. The query string is never logged. */
export function listOfficesHandler(deps: Deps): Handler<RouterEnv, string, ListOfficesInput> {
  return async (c) => {
    const viewer = c.get('viewer');
    if (viewer === null) {
      throw new Error('The middleware chain set no viewer.');
    }
    const page = await listOffices(deps, {
      viewer,
      query: parseOfficeListQuery(c.req.valid('query')),
      now: deps.clock.now(),
    });
    return respond(c, OfficeListPageSchema, page);
  };
}
