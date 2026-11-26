import type { Handler } from 'hono';
import {
  CandidacyViewPageSchema,
  ErrorEnvelopeSchema,
  ListOfficeCandidatesQuerySchema,
  OfficeIdParamsSchema,
} from '@citizenrun/shared';
import type { ListOfficeCandidatesQuery, OfficeIdParams } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { LOGGED_OUT_VIEWER_CACHE_CONTROL } from '../../services/civic/cache.ts';
import { listOfficeCandidates } from '../../services/offices/list-candidates.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-OFF-02 `GET /v1/offices/:id/candidates`: an office's candidacies, paged. */
export const listOfficeCandidatesRoute = defineRoute({
  method: 'get',
  path: '/offices/{id}/candidates',
  operationId: 'listOfficeCandidates',
  tags: ['offices'],
  request: { params: OfficeIdParamsSchema, query: ListOfficeCandidatesQuerySchema },
  responses: {
    200: {
      description: 'One page of candidacies by election date, status, name and id.',
      content: { 'application/json': { schema: CandidacyViewPageSchema } },
    },
    400: { description: 'The request or the cursor is not valid.', content: ERROR_RESPONSE },
    404: {
      description: 'No office has that id, or the election is not one of its elections.',
      content: ERROR_RESPONSE,
    },
    426: { description: 'The build is too old.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'optional', rateLimit: 'civic_read', public: true },
  errors: [
    'invalid_request',
    'invalid_cursor',
    'client_header_required',
    'not_found',
    'upgrade_required',
    'rate_limited',
  ],
});

type ListOfficeCandidatesInput = {
  in: { param: Record<string, string>; query: Record<string, string> };
  out: { param: OfficeIdParams; query: ListOfficeCandidatesQuery };
};

/** The handler of E-OFF-02. A logged-out answer is private to the browser (L-cache-headers). */
export function listOfficeCandidatesHandler(
  deps: Deps,
): Handler<RouterEnv, string, ListOfficeCandidatesInput> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    const viewer = c.get('viewer');
    const now = deps.clock.now();
    const page = await listOfficeCandidates(deps, {
      officeId: id,
      electionId: query.electionId ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit,
      viewerId: viewer?.userId ?? null,
      now,
    });
    if (viewer === null) {
      c.header('Cache-Control', LOGGED_OUT_VIEWER_CACHE_CONTROL);
    }
    return respond(c, CandidacyViewPageSchema, page);
  };
}
