import type { Handler } from 'hono';
import { ErrorEnvelopeSchema, MeSchema, UpdateMeBodySchema } from '@citizenrun/shared';
import type { UpdateMeBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { loadMe } from '../../services/me/load-me.ts';
import { updateProfile } from '../../services/me/update-profile.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-02 `PATCH /v1/me`: edits the profile, attaches or removes the avatar. */
export const updateMeRoute = defineRoute({
  method: 'patch',
  path: '/me',
  operationId: 'updateMe',
  tags: ['me'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: UpdateMeBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The account after the change.',
      content: { 'application/json': { schema: MeSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    422: {
      description: 'The upload cannot be used, or the bio needs an AI-screening answer.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.write' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_suspended',
    'upload_invalid',
    'ai_consent_required',
    'rate_limited',
  ],
});

type UpdateMeInput = {
  in: { json: unknown };
  out: { json: UpdateMeBody };
};

/** The handler of E-ME-02. Name, bio, link and the upload key are never logged. */
export function updateMeHandler(deps: Deps): Handler<RouterEnv, string, UpdateMeInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const { userId, sessionId, platform } = signedInOf(c);
    const now = deps.clock.now();
    await updateProfile(deps, { userId, body, now, platform });
    return respond(c, MeSchema, await loadMe(deps, { userId, sessionId, now }));
  };
}
