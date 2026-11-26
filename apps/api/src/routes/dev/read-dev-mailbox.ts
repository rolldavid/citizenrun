import type { Handler } from 'hono';
import { z } from 'zod';
import { ApiError, EmailAddressSchema, ErrorEnvelopeSchema } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { isCaptureMailer } from '../../lib/mailer.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

// The idempotency-key prefix of the sign-in code emails (L-email-code).
const SIGN_IN_KEY_PREFIX = 'signin-';
// The first run of exactly six digits in a message's text (E-AUTH-11).
const SIX_DIGITS = /(?<![0-9])([0-9]{6})(?![0-9])/;

/** The body of E-AUTH-11: the address whose newest sign-in code is read. No app code calls the route. */
export const DevMailboxBodySchema = z.object({ to: EmailAddressSchema });

/** The answer of E-AUTH-11: the six-digit code of the newest sign-in email to the address. */
export const DevMailboxResultSchema = z.object({ code: z.string().regex(/^[0-9]{6}$/) });

/**
 * E-AUTH-11 `POST /v1/dev/mailbox`: the local development mailbox, hidden from the document and
 * registered only when the development routes and the capture mailer are both on.
 */
export const readDevMailboxRoute = defineRoute({
  method: 'post',
  path: '/dev/mailbox',
  hide: true,
  operationId: 'readDevMailbox',
  tags: ['dev'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: DevMailboxBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The code of the newest sign-in email to the address.',
      content: { 'application/json': { schema: DevMailboxResultSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    404: { description: 'No sign-in code was captured for the address.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: {
    auth: 'none',
    rateLimit: 'dev.mailbox',
    public: true,
    clientHeader: 'exempt',
    originCheck: 'exempt',
  },
  errors: ['invalid_request', 'not_found', 'rate_limited'],
});

type ReadDevMailboxInput = {
  in: { json: unknown };
  out: { json: z.infer<typeof DevMailboxBodySchema> };
};

/**
 * The handler of E-AUTH-11: reads the newest captured sign-in email to the address from process
 * memory, through the counted mailer, and answers its code. Writes nothing; the address and the code
 * are never logged.
 */
export function readDevMailboxHandler(deps: Deps): Handler<RouterEnv, string, ReadDevMailboxInput> {
  return (c) => {
    // The schema has trimmed and lower-cased the address.
    const { to } = c.req.valid('json');
    const mailer = deps.mailer;
    if (!isCaptureMailer(mailer)) {
      throw new ApiError('not_found');
    }
    const messages = mailer.captured();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (
        message === undefined ||
        !message.idempotencyKey.startsWith(SIGN_IN_KEY_PREFIX) ||
        !message.to.some((recipient) => recipient.trim().toLowerCase() === to)
      ) {
        continue;
      }
      const code = SIX_DIGITS.exec(message.text)?.[1];
      if (code === undefined) {
        break;
      }
      c.header('Cache-Control', 'no-store');
      return respond(c, DevMailboxResultSchema, { code });
    }
    throw new ApiError('not_found');
  };
}
