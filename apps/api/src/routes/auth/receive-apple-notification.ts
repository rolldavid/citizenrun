import type { Handler } from 'hono';
import {
  AppleNotificationBodySchema,
  ErrorEnvelopeSchema,
  ReceiveAppleNotificationResponseSchema,
} from '@citizenrun/shared';
import type { AppleNotificationBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { receiveAppleNotification } from '../../services/auth/apple-notifications.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-AUTH-07 `POST /v1/auth/apple/notifications`: Apple's signed server-to-server notice. */
export const receiveAppleNotificationRoute = defineRoute({
  method: 'post',
  path: '/auth/apple/notifications',
  operationId: 'receiveAppleNotification',
  tags: ['auth'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: AppleNotificationBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The notice was received; an unknown subject changes nothing.',
      content: { 'application/json': { schema: ReceiveAppleNotificationResponseSchema } },
    },
    400: {
      description: 'The body is not valid or its signature does not verify.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
    503: { description: 'Apple sign-in is not configured.', content: ERROR_RESPONSE },
  },
  meta: {
    auth: 'none',
    rateLimit: 'auth.appleNotify',
    public: true,
    clientHeader: 'exempt',
    originCheck: 'exempt',
  },
  errors: ['invalid_request', 'signature_invalid', 'rate_limited', 'provider_not_configured'],
});

type ReceiveAppleNotificationInput = {
  in: { json: unknown };
  out: { json: AppleNotificationBody };
};

/** The handler of E-AUTH-07. Never logged: the payload, the subject and the email. */
export function receiveAppleNotificationHandler(
  deps: Deps,
): Handler<RouterEnv, string, ReceiveAppleNotificationInput> {
  return async (c) => {
    const body = c.req.valid('json');
    await receiveAppleNotification(deps, deps.env, {
      payload: body.payload,
      now: deps.clock.now(),
    });
    return respond(c, ReceiveAppleNotificationResponseSchema, {});
  };
}
