import type { Handler } from 'hono';
import {
  CreateUploadBodySchema,
  ErrorEnvelopeSchema,
  UploadTicketSchema,
} from '@citizenrun/shared';
import type { CreateUploadBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { createUpload } from '../../services/uploads/create-upload.ts';
import { signedInOf } from '../me/get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-UPL-01 `POST /v1/uploads`: a presigned POST policy for one upload. */
export const createUploadRoute = defineRoute({
  method: 'post',
  path: '/uploads',
  operationId: 'createUpload',
  tags: ['uploads'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateUploadBodySchema } },
    },
  },
  responses: {
    201: {
      description: 'Where and how to send the upload.',
      content: { 'application/json': { schema: UploadTicketSchema } },
    },
    400: {
      description: 'The request is not valid, or the client header is missing or malformed.',
      content: ERROR_RESPONSE,
    },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    422: { description: 'The declared size is over the limit.', content: ERROR_RESPONSE },
    426: { description: 'The build is too old.', content: ERROR_RESPONSE },
    429: {
      description: 'The daily avatar limit is reached, or too many requests.',
      content: ERROR_RESPONSE,
    },
  },
  meta: { auth: 'user', rateLimit: 'uploads.create' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_suspended',
    'upload_too_large',
    'daily_limit_reached',
    'rate_limited',
    'client_header_required',
    'upgrade_required',
  ],
});

type CreateUploadInput = {
  in: { json: unknown };
  out: { json: CreateUploadBody };
};

/** The handler of E-UPL-01. */
export function createUploadHandler(deps: Deps): Handler<RouterEnv, string, CreateUploadInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const { userId, platform } = signedInOf(c);
    const now = deps.clock.now();
    const ticket = await createUpload(deps.db, { userId, body, platform, now }, deps.storage.media);
    return respond(c, UploadTicketSchema, ticket, 201);
  };
}
