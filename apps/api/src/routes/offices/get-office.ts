import type { Handler } from 'hono';
import {
  ApiError,
  ErrorEnvelopeSchema,
  GetOfficeParamsSchema,
  GetOfficeQuerySchema,
  OfficeDetailSchema,
} from '@citizenrun/shared';
import type { GetOfficeParams, GetOfficeQuery } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { LOGGED_OUT_VIEWER_CACHE_CONTROL } from '../../services/civic/cache.ts';
import { loadOfficeDetail } from '../../services/offices/get-office.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-OFF-01 `GET /v1/offices/:idOrSlug`: the office page, logged out or signed in. */
export const getOfficeRoute = defineRoute({
  method: 'get',
  path: '/offices/{idOrSlug}',
  operationId: 'getOffice',
  tags: ['offices'],
  request: { params: GetOfficeParamsSchema, query: GetOfficeQuerySchema },
  responses: {
    200: {
      description: 'Every fact of the office with its proof, and the next fileable election.',
      content: { 'application/json': { schema: OfficeDetailSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    404: { description: 'No office has that id or slug.', content: ERROR_RESPONSE },
    426: { description: 'The build is too old.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'optional', rateLimit: 'civic_read', public: true },
  errors: [
    'invalid_request',
    'client_header_required',
    'not_found',
    'upgrade_required',
    'rate_limited',
  ],
});

type GetOfficeInput = {
  in: { param: Record<string, string>; query: Record<string, string> };
  out: { param: GetOfficeParams; query: GetOfficeQuery };
};

/** The handler of E-OFF-01. A logged-out answer is private to the browser (L-cache-headers). */
export function getOfficeHandler(deps: Deps): Handler<RouterEnv, string, GetOfficeInput> {
  return async (c) => {
    const { idOrSlug } = c.req.valid('param');
    const query = c.req.valid('query');
    const viewer = c.get('viewer');
    const now = deps.clock.now();
    const detail = await loadOfficeDetail(deps, {
      idOrSlug,
      viewerId: viewer?.userId ?? null,
      singleIssueId: query.issue ?? null,
      now,
    });
    if (detail === null) {
      throw new ApiError('not_found');
    }
    if (viewer === null) {
      c.header('Cache-Control', LOGGED_OUT_VIEWER_CACHE_CONTROL);
    }
    return respond(c, OfficeDetailSchema, detail);
  };
}
