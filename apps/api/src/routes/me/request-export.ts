import type { Handler } from 'hono';
import {
  DataExportViewSchema,
  ErrorEnvelopeSchema,
  RequestExportBodySchema,
} from '@citizenrun/shared';
import type { RequestExportBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { requestExport } from '../../services/me/exports.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-04 `POST /v1/me/export`: queues one data export a day. */
export const requestExportRoute = defineRoute({
  method: 'post',
  path: '/me/export',
  operationId: 'requestExport',
  tags: ['me'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: RequestExportBodySchema } },
    },
  },
  responses: {
    202: {
      description: 'The export is queued.',
      content: { 'application/json': { schema: DataExportViewSchema } },
    },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the sign-in is not recent enough.',
      content: ERROR_RESPONSE,
    },
    429: {
      description: 'An export was requested in the last 24 hours, or too many requests.',
      content: ERROR_RESPONSE,
    },
  },
  meta: {
    auth: 'user',
    rateLimit: 'me.export',
    recentSignIn: '15m',
    allowWhenSuspended: true,
  },
  errors: [
    'unauthenticated',
    'origin_rejected',
    'recent_sign_in_required',
    'daily_limit_reached',
    'rate_limited',
  ],
});

type RequestExportInput = {
  in: { json: unknown };
  out: { json: RequestExportBody };
};

/** The handler of E-ME-04. */
export function requestExportHandler(deps: Deps): Handler<RouterEnv, string, RequestExportInput> {
  return async (c) => {
    // The body is `{}` (RequestExportBody): validation has stripped every key, so nothing is read from it.
    c.req.valid('json');
    const { userId } = signedInOf(c);
    const now = deps.clock.now();
    return respond(c, DataExportViewSchema, await requestExport(deps, { userId, now }), 202);
  };
}
