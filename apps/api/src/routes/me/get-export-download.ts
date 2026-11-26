import type { Handler } from 'hono';
import { ErrorEnvelopeSchema, ExportDownloadSchema } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { getExportDownload } from '../../services/me/exports.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-06 `GET /v1/me/export/download`: a 300-second link to the newest export's file. */
export const getExportDownloadRoute = defineRoute({
  method: 'get',
  path: '/me/export/download',
  operationId: 'getExportDownload',
  tags: ['me'],
  responses: {
    200: {
      description: 'A short-lived link to the export file.',
      content: { 'application/json': { schema: ExportDownloadSchema } },
    },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: { description: 'The sign-in is not recent enough.', content: ERROR_RESPONSE },
    404: {
      description: 'No export, or the newest one failed or expired.',
      content: ERROR_RESPONSE,
    },
    409: { description: 'The newest export is not ready yet.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.export', recentSignIn: '15m' },
  errors: [
    'unauthenticated',
    'recent_sign_in_required',
    'not_found',
    'export_not_ready',
    'rate_limited',
  ],
});

/** The handler of E-ME-06. The link is never logged. */
export function getExportDownloadHandler(deps: Deps): Handler<RouterEnv> {
  return async (c) => {
    const { userId } = signedInOf(c);
    const now = deps.clock.now();
    return respond(
      c,
      ExportDownloadSchema,
      await getExportDownload(deps.db, { userId, now }, deps.storage.media),
    );
  };
}
