import type { Handler } from 'hono';
import { ErrorEnvelopeSchema, IssuePageSchema } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { listIssues } from '../../services/reference/list-issues.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-REF-01 `GET /v1/issues`: every issue in sort order, the same for every caller. */
export const listIssuesRoute = defineRoute({
  method: 'get',
  path: '/issues',
  operationId: 'listIssues',
  tags: ['reference'],
  responses: {
    200: {
      description: 'Every issue in sort order, never paged.',
      content: { 'application/json': { schema: IssuePageSchema } },
    },
    400: { description: 'The client header is missing or malformed.', content: ERROR_RESPONSE },
    426: { description: 'The build is too old.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'optional', rateLimit: 'ref.read', public: true },
  errors: ['client_header_required', 'upgrade_required', 'rate_limited'],
});

/** The handler of E-REF-01. Its cache header is the operation's row of L-cache-headers. */
export function listIssuesHandler(deps: Deps): Handler<RouterEnv> {
  return async (c) => {
    const items = await listIssues(deps.db);
    return respond(c, IssuePageSchema, { items, nextCursor: null });
  };
}
