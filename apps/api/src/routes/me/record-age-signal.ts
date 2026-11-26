import type { Handler } from 'hono';
import {
  AccountDeletionViewSchema,
  ErrorEnvelopeSchema,
  MeSchema,
  RecordAgeSignalBodySchema,
  assertNever,
} from '@citizenrun/shared';
import type { RecordAgeSignalBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { clearSessionCookie } from '../../middleware/session-cookie.ts';
import { publicSessionOptions } from '../../middleware/session.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { recordAgeSignal } from '../../services/me/age-signal.ts';
import { loadMe } from '../../services/me/load-me.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-12 `POST /v1/me/age`: records a store age signal; a minor result starts the account's deletion. */
export const recordAgeSignalRoute = defineRoute({
  method: 'post',
  path: '/me/age',
  operationId: 'recordAgeSignal',
  tags: ['me'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: RecordAgeSignalBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'An adult signal: the account with its new age record.',
      content: { 'application/json': { schema: MeSchema } },
    },
    202: {
      description: 'A minor signal: the account is suspended and its deletion is under way.',
      content: { 'application/json': { schema: AccountDeletionViewSchema } },
    },
    400: {
      description: 'The request is not valid, or it came from a browser.',
      content: ERROR_RESPONSE,
    },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.write', allowWhenSuspended: true },
  errors: ['invalid_request', 'unauthenticated', 'rate_limited'],
});

type RecordAgeSignalInput = {
  in: { json: unknown };
  out: { json: RecordAgeSignalBody };
};

/** The handler of E-ME-12. Only the minor band is ever logged, by the service. */
export function recordAgeSignalHandler(
  deps: Deps,
): Handler<RouterEnv, string, RecordAgeSignalInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const { userId, sessionId, platform } = signedInOf(c);
    const now = deps.clock.now();
    const outcome = await recordAgeSignal(deps, {
      userId,
      body,
      platform,
      now,
      logger: deps.logger,
    });
    switch (outcome.kind) {
      case 'adult':
        return respond(c, MeSchema, await loadMe(deps, { userId, sessionId, now }));
      case 'minor':
        // Every session has ended, so any session cookie is cleared as well.
        clearSessionCookie(c, publicSessionOptions(deps.env.PUBLIC_URL));
        return respond(c, AccountDeletionViewSchema, outcome.deletion, 202);
      default:
        return assertNever(outcome);
    }
  };
}
