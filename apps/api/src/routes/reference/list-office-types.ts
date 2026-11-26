import type { Handler } from 'hono';
import { ErrorEnvelopeSchema, OfficeTypePageSchema } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { listOfficeTypes } from '../../services/reference/list-office-types.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };
// L-cache-headers: the body never depends on the caller.
const CACHE_CONTROL = 'public, max-age=3600';

/** E-REF-02 `GET /v1/office-types`: every office type in id order, the same for every caller. */
export const listOfficeTypesRoute = defineRoute({
  method: 'get',
  path: '/office-types',
  operationId: 'listOfficeTypes',
  tags: ['reference'],
  responses: {
    200: {
      description: 'Every office type in id order, never paged.',
      content: { 'application/json': { schema: OfficeTypePageSchema } },
    },
    400: { description: 'The client header is missing or malformed.', content: ERROR_RESPONSE },
    426: { description: 'The build is too old.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'optional', rateLimit: 'ref.read', public: true },
  errors: ['client_header_required', 'upgrade_required', 'rate_limited'],
});

/** The handler of E-REF-02, which sets its own row of L-cache-headers. */
export function listOfficeTypesHandler(deps: Deps): Handler<RouterEnv> {
  return async (c) => {
    const items = await listOfficeTypes(deps.db);
    c.header('Cache-Control', CACHE_CONTROL);
    return respond(c, OfficeTypePageSchema, { items, nextCursor: null });
  };
}
