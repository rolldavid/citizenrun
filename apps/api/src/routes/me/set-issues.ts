import type { Handler } from 'hono';
import { ErrorEnvelopeSchema, MeSchema, SetIssuesBodySchema } from '@citizenrun/shared';
import type { SetIssuesBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { loadMe } from '../../services/me/load-me.ts';
import { setIssues } from '../../services/me/set-issues.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-09 `PUT /v1/me/issues`: replaces the user's issue picks. */
export const setIssuesRoute = defineRoute({
  method: 'put',
  path: '/me/issues',
  operationId: 'setIssues',
  tags: ['me'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SetIssuesBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The account with its new issue picks.',
      content: { 'application/json': { schema: MeSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    422: { description: 'An issue id is not known.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.write' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_suspended',
    'unknown_issue',
    'rate_limited',
  ],
});

type SetIssuesInput = {
  in: { json: unknown };
  out: { json: SetIssuesBody };
};

/** The handler of E-ME-09. Issue picks are never logged. */
export function setIssuesHandler(deps: Deps): Handler<RouterEnv, string, SetIssuesInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const { userId, sessionId, platform } = signedInOf(c);
    const now = deps.clock.now();
    await setIssues(deps.db, { userId, issues: body.issues, now, platform });
    return respond(c, MeSchema, await loadMe(deps, { userId, sessionId, now }));
  };
}
