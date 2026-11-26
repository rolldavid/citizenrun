import type { Handler } from 'hono';
import { AppleCallbackFormSchema } from '@citizenrun/shared';
import type { AppleCallbackForm } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { appleCallback } from '../../services/auth/apple-callback.ts';

const NO_STORE = 'no-store';
// Apple's form post is at most 16 KiB (L-body-limit).
const CALLBACK_BODY_LIMIT_BYTES = 16_384;

/**
 * E-AUTH-05 `POST /v1/auth/apple/callback`: Apple's form post from the Android browser tab. Every
 * answer, a refusal included, is a 302 to the app's fixed scheme (`errorRedirect`).
 */
export const appleSignInCallbackRoute = defineRoute({
  method: 'post',
  path: '/auth/apple/callback',
  operationId: 'appleSignInCallback',
  tags: ['auth'],
  request: {
    body: {
      required: true,
      content: { 'application/x-www-form-urlencoded': { schema: AppleCallbackFormSchema } },
    },
  },
  responses: {
    302: {
      description:
        'Back to the app: a hand-off code and the state on success, an error reason otherwise.',
      headers: {
        Location: {
          description: "The app's return URL on the scheme of the brand variant.",
          schema: { type: 'string' },
        },
        'Cache-Control': { description: 'Always no-store.', schema: { type: 'string' } },
      },
    },
  },
  meta: {
    auth: 'none',
    rateLimit: 'auth.appleCallback',
    public: true,
    clientHeader: 'exempt',
    originCheck: 'exempt',
    bodyLimitBytes: CALLBACK_BODY_LIMIT_BYTES,
    errorRedirect: true,
  },
  errors: [],
});

type AppleSignInCallbackInput = {
  in: { form: unknown };
  out: { form: AppleCallbackForm };
};

/** The handler of E-AUTH-05. No form field is ever logged. */
export function appleSignInCallbackHandler(
  deps: Deps,
): Handler<RouterEnv, string, AppleSignInCallbackInput> {
  return async (c) => {
    const form = c.req.valid('form');
    const addrHash = c.get('addrHash');
    if (addrHash === null) {
      throw new Error('The middleware chain set no address hash.');
    }
    const location = await appleCallback(deps, deps.env, {
      form,
      addrHash,
      now: deps.clock.now(),
      log: deps.logger,
    });
    c.header('Cache-Control', NO_STORE);
    return c.redirect(location, 302);
  };
}
