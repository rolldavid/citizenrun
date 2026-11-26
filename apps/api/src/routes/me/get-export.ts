import type { Handler } from 'hono';
import { DataExportStatusSchema, ErrorEnvelopeSchema } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { getExportStatus } from '../../services/me/exports.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-05 `GET /v1/me/export`: the newest export request and when another may be asked for. */
export const getExportRoute = defineRoute({
  method: 'get',
  path: '/me/export',
  operationId: 'getExport',
  tags: ['me'],
  responses: {
    200: {
      description: 'The newest export request, if any.',
      content: { 'application/json': { schema: DataExportStatusSchema } },
    },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.read' },
  errors: ['unauthenticated', 'rate_limited'],
});

/** The handler of E-ME-05. */
export function getExportHandler(deps: Deps): Handler<RouterEnv> {
  return async (c) => {
    const { userId } = signedInOf(c);
    const now = deps.clock.now();
    return respond(c, DataExportStatusSchema, await getExportStatus(deps.db, { userId, now }));
  };
}
