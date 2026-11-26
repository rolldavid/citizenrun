import type { Handler } from 'hono';
import {
  CreateAuthNonceBodySchema,
  ErrorEnvelopeSchema,
  NonceResultSchema,
} from '@citizenrun/shared';
import type { CreateAuthNonceBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { issueNonce } from '../../services/auth/nonces.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-AUTH-03 `POST /v1/auth/nonce`: issues a single-use sign-in nonce and the signed Apple state. */
export const createAuthNonceRoute = defineRoute({
  method: 'post',
  path: '/auth/nonce',
  operationId: 'createAuthNonce',
  tags: ['auth'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateAuthNonceBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The nonce, its hash for the provider, the signed Apple state and the expiry.',
      content: { 'application/json': { schema: NonceResultSchema } },
    },
    400: { description: 'The client header is missing or malformed.', content: ERROR_RESPONSE },
    403: { description: 'The request-forgery check failed.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'none', rateLimit: 'auth.nonce', public: true },
  errors: ['client_header_required', 'origin_rejected', 'rate_limited'],
});

type CreateAuthNonceInput = {
  in: { json: unknown };
  out: { json: CreateAuthNonceBody };
};

/** The handler of E-AUTH-03. The nonce, its hash and the Apple state are never logged. */
export function createAuthNonceHandler(
  deps: Deps,
): Handler<RouterEnv, string, CreateAuthNonceInput> {
  return async (c) => {
    // The body is `{}`: validation has stripped every key, so nothing is read from it.
    const client = c.get('client');
    if (client === null) {
      throw new Error('The middleware chain set no client.');
    }
    const result = await issueNonce(deps.db, {
      platform: client.value.platform,
      ring: deps.keyRing,
      now: deps.clock.now(),
    });
    return respond(c, NonceResultSchema, result);
  };
}
