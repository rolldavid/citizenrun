import type { Handler } from 'hono';
import { CreateClientErrorBodySchema, ErrorEnvelopeSchema, LIMITS } from '@citizenrun/shared';
import type { CreateClientErrorBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { recordClientError } from '../../services/safety/record-client-error.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-SAFE-02 `POST /v1/client-errors`: a client error report with the fixed schema. */
export const createClientErrorRoute = defineRoute({
  method: 'post',
  path: '/client-errors',
  operationId: 'createClientError',
  tags: ['safety'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateClientErrorBodySchema } },
    },
  },
  responses: {
    204: { description: 'The report was stored.' },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    413: { description: 'The body is over 4,096 bytes.', content: ERROR_RESPONSE },
    426: { description: 'The build is too old.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: {
    auth: 'optional',
    rateLimit: 'clientErrors',
    bodyLimitBytes: LIMITS.clientErrorBytes,
    public: true,
  },
  errors: [
    'invalid_request',
    'client_header_required',
    'payload_too_large',
    'upgrade_required',
    'rate_limited',
  ],
});

type CreateClientErrorInput = {
  in: { json: unknown };
  out: { json: CreateClientErrorBody };
};

/** The handler of E-SAFE-02: stores the validated report and answers 204. The body is never logged. */
export function createClientErrorHandler(
  deps: Deps,
): Handler<RouterEnv, string, CreateClientErrorInput> {
  return async (c) => {
    const body = c.req.valid('json');
    await recordClientError(deps.db, body);
    return c.body(null, 204);
  };
}
