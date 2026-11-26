import type { Handler } from 'hono';
import {
  ApiError,
  ErrorEnvelopeSchema,
  GetPersonParamsSchema,
  PersonDetailSchema,
} from '@citizenrun/shared';
import type { GetPersonParams } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { LOGGED_OUT_VIEWER_CACHE_CONTROL } from '../../services/civic/cache.ts';
import { loadPersonDetail } from '../../services/people/get-person.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-PPL-01 `GET /v1/people/:idOrSlug`: the person page, logged out or signed in. */
export const getPersonRoute = defineRoute({
  method: 'get',
  path: '/people/{idOrSlug}',
  operationId: 'getPerson',
  tags: ['people'],
  request: { params: GetPersonParamsSchema },
  responses: {
    200: {
      description:
        'The person, their seats and their candidacies; a merged person answers the survivor.',
      content: { 'application/json': { schema: PersonDetailSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    404: {
      description: 'No person has that id or slug, or the person has no profile.',
      content: ERROR_RESPONSE,
    },
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

type GetPersonInput = {
  in: { param: Record<string, string> };
  out: { param: GetPersonParams };
};

/** The handler of E-PPL-01. A logged-out answer is private to the browser (L-cache-headers). */
export function getPersonHandler(deps: Deps): Handler<RouterEnv, string, GetPersonInput> {
  return async (c) => {
    const { idOrSlug } = c.req.valid('param');
    const viewer = c.get('viewer');
    const detail = await loadPersonDetail(deps, {
      idOrSlug,
      viewerId: viewer?.userId ?? null,
      now: deps.clock.now(),
    });
    if (detail === null) {
      throw new ApiError('not_found');
    }
    if (viewer === null) {
      c.header('Cache-Control', LOGGED_OUT_VIEWER_CACHE_CONTROL);
    }
    return respond(c, PersonDetailSchema, detail);
  };
}
