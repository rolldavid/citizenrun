import type { Handler } from 'hono';
import {
  ErrorEnvelopeSchema,
  GeoSuggestionsPageSchema,
  SuggestPlacesBodySchema,
} from '@citizenrun/shared';
import type { SuggestPlacesBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { suggestPlaces } from '../../services/geo/suggest-places.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-GEO-01 `POST /v1/geo/autocomplete`: place search or address suggestions; the text travels only in the body. */
export const suggestPlacesRoute = defineRoute({
  method: 'post',
  path: '/geo/autocomplete',
  operationId: 'suggestPlaces',
  tags: ['geo'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SuggestPlacesBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'At most five suggestions; an empty list when none can be given.',
      content: { 'application/json': { schema: GeoSuggestionsPageSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'geo.suggest' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_suspended',
    'rate_limited',
  ],
});

type SuggestPlacesInput = {
  in: { json: unknown };
  out: { json: SuggestPlacesBody };
};

/** The handler of E-GEO-01. The answer is never cached; the text and the answer are never logged. */
export function suggestPlacesHandler(deps: Deps): Handler<RouterEnv, string, SuggestPlacesInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const viewer = c.get('viewer');
    if (viewer === null) {
      throw new Error('The middleware chain set no viewer.');
    }
    const now = deps.clock.now();
    const page = await suggestPlaces(deps, {
      q: body.q,
      kind: body.kind,
      onboardingStep: viewer.onboardingStep,
      now,
    });
    return respond(c, GeoSuggestionsPageSchema, page);
  };
}
