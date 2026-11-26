import type { Handler } from 'hono';
import {
  ConsentStateSchema,
  ErrorEnvelopeSchema,
  RecordConsentBodySchema,
} from '@citizenrun/shared';
import type { RecordConsentBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { recordConsent } from '../../services/me/consents.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-11 `POST /v1/me/consents`: records an agreement or the AI-screening answer. */
export const recordConsentRoute = defineRoute({
  method: 'post',
  path: '/me/consents',
  operationId: 'recordConsent',
  tags: ['me'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: RecordConsentBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The agreements and the AI-screening answer after the change.',
      content: { 'application/json': { schema: ConsentStateSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: { description: 'The request-forgery check failed.', content: ERROR_RESPONSE },
    422: { description: 'The version is not the current one.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.write', allowWhenSuspended: true },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'consent_version_outdated',
    'rate_limited',
  ],
});

type RecordConsentInput = {
  in: { json: unknown };
  out: { json: RecordConsentBody };
};

/** The handler of E-ME-11. The answer and the version are never logged. */
export function recordConsentHandler(deps: Deps): Handler<RouterEnv, string, RecordConsentInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const { userId, platform } = signedInOf(c);
    const now = deps.clock.now();
    return respond(
      c,
      ConsentStateSchema,
      await recordConsent(deps.db, { userId, body, platform, now }),
    );
  };
}
