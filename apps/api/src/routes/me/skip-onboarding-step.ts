import type { Handler } from 'hono';
import { ErrorEnvelopeSchema, MeSchema, SkipOnboardingStepBodySchema } from '@citizenrun/shared';
import type { SkipOnboardingStepBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { loadMe } from '../../services/me/load-me.ts';
import { skipOnboardingStep } from '../../services/me/skip-onboarding-step.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-10 `POST /v1/me/onboarding/skip`: skips one of the two optional onboarding steps. */
export const skipOnboardingStepRoute = defineRoute({
  method: 'post',
  path: '/me/onboarding/skip',
  operationId: 'skipOnboardingStep',
  tags: ['me'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SkipOnboardingStepBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The account at its onboarding step.',
      content: { 'application/json': { schema: MeSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    409: { description: 'The step has not been reached.', content: ERROR_RESPONSE },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.write' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_suspended',
    'onboarding_step_mismatch',
    'rate_limited',
  ],
});

type SkipOnboardingStepInput = {
  in: { json: unknown };
  out: { json: SkipOnboardingStepBody };
};

/** The handler of E-ME-10. */
export function skipOnboardingStepHandler(
  deps: Deps,
): Handler<RouterEnv, string, SkipOnboardingStepInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const { userId, sessionId, platform } = signedInOf(c);
    const now = deps.clock.now();
    await skipOnboardingStep(deps.db, { userId, step: body.step, now, platform });
    return respond(c, MeSchema, await loadMe(deps, { userId, sessionId, now }));
  };
}
