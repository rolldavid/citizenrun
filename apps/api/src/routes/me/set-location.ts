import type { Handler } from 'hono';
import {
  ErrorEnvelopeSchema,
  LocationResultSchema,
  SetLocationBodySchema,
} from '@citizenrun/shared';
import type { SetLocationBody } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { countOfficesInDistricts, viewerDistricts } from '../../services/me/location-state.ts';
import { loadMe } from '../../services/me/load-me.ts';
import { setLocation } from '../../services/me/set-location.ts';
import { signedInOf } from './get-me.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-ME-13 `PUT /v1/me/location`: stores the districts of a point or a typed address; both travel only in the body. */
export const setLocationRoute = defineRoute({
  method: 'put',
  path: '/me/location',
  operationId: 'setLocation',
  tags: ['me'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SetLocationBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'The stored districts, their counts and the account.',
      content: { 'application/json': { schema: LocationResultSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description:
        'The request-forgery check failed, the account is suspended, or the app is not available in the state.',
      content: ERROR_RESPONSE,
    },
    422: {
      description:
        'The address is a bare ZIP or was not found, the place is outside the United States, or the state needs the store age signal.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests.', content: ERROR_RESPONSE },
    503: { description: 'The address lookup service is unavailable.', content: ERROR_RESPONSE },
  },
  meta: { auth: 'user', rateLimit: 'me.location' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_suspended',
    'unavailable_in_state',
    'need_street_address',
    'address_not_found',
    'outside_us',
    'age_signal_required',
    'rate_limited',
    'geocoder_unavailable',
  ],
});

type SetLocationInput = {
  in: { json: unknown };
  out: { json: SetLocationBody };
};

/** The handler of E-ME-13. Nothing of the body, the geocoder's answer or the district ids is logged. */
export function setLocationHandler(deps: Deps): Handler<RouterEnv, string, SetLocationInput> {
  return async (c) => {
    const body = c.req.valid('json');
    const viewer = c.get('viewer');
    if (viewer === null) {
      throw new Error('The middleware chain set no viewer.');
    }
    const { userId, sessionId, platform } = signedInOf(c);
    const now = deps.clock.now();
    const result = await setLocation(deps, { viewer, platform, body, now });
    // Step 7, after the commit.
    return respond(c, LocationResultSchema, {
      outcome: result.outcome,
      territory: result.territory,
      districts: await viewerDistricts(deps.db, result.districtIds),
      exactDistrictCount: result.exactIds.length,
      officeCount: await countOfficesInDistricts(deps.db, result.exactIds),
      me: await loadMe(deps, { userId, sessionId, now }),
    });
  };
}
