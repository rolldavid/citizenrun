import type { Handler } from 'hono';
import {
  ApiError,
  ErrorEnvelopeSchema,
  SessionInfoSchema,
  SignInWithAppleBodySchema,
  appleDisplayName,
} from '@citizenrun/shared';
import type { SignInWithAppleBody } from '@citizenrun/shared';
import { encryptRefreshToken, sha256Hex } from '@citizenrun/shared/crypto';
import type { Deps } from '../../deps.ts';
import { parseAdminEmails } from '../../middleware/gates.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import {
  appleConfig,
  appleIdentityInput,
  appleNonceMatches,
  exchangeAppleCode,
  verifyAppleIdToken,
} from '../../services/auth/apple.ts';
import { answerSignIn } from '../../services/auth/complete-sign-in.ts';
import { providerSignIn } from '../../services/auth/provider-sign-in.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-AUTH-04 `POST /v1/auth/apple`: signs in with an Apple identity token from iOS or the web. */
export const signInWithAppleRoute = defineRoute({
  method: 'post',
  path: '/auth/apple',
  operationId: 'signInWithApple',
  tags: ['auth'],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SignInWithAppleBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Signed in; on the web the session cookie is set and the token is null.',
      content: { 'application/json': { schema: SessionInfoSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'The intent needs a session.', content: ERROR_RESPONSE },
    403: {
      description: 'The request-forgery check failed, or the sign-in is refused.',
      content: ERROR_RESPONSE,
    },
    409: { description: 'The intent conflicts with the account.', content: ERROR_RESPONSE },
    422: {
      description: 'The token, the nonce or the sign-up details cannot be used.',
      content: ERROR_RESPONSE,
    },
    429: { description: 'Too many requests or sign-ups.', content: ERROR_RESPONSE },
    503: { description: 'Apple sign-in is not configured.', content: ERROR_RESPONSE },
  },
  meta: {
    auth: 'optional',
    rateLimit: 'auth.token',
    public: true,
    allowWhenSuspended: true,
  },
  errors: [
    'invalid_request',
    'unauthenticated',
    'origin_rejected',
    'account_deleting',
    'unavailable_in_state',
    'age_signal_required',
    'reauth_mismatch',
    'identity_token_invalid',
    'nonce_invalid',
    'signup_details_required',
    'consent_version_outdated',
    'rate_limited',
    'signup_limit_reached',
    'provider_not_configured',
  ],
});

type SignInWithAppleInput = {
  in: { json: unknown };
  out: { json: SignInWithAppleBody };
};

/**
 * The handler of E-AUTH-04. Never logged: the identity token, the code, the nonce, the refresh
 * token, the client secret, the name and the email.
 */
export function signInWithAppleHandler(
  deps: Deps,
): Handler<RouterEnv, string, SignInWithAppleInput> {
  return async (c) => {
    const body = c.req.valid('json');
    // Before anything else: no token is verified without its audiences (PC3A-47).
    const config = appleConfig(deps.env);
    if (config === null) {
      throw new ApiError('provider_not_configured');
    }
    const viewer = c.get('viewer');
    if (body.intent === 'reauth' && viewer === null) {
      throw new ApiError('unauthenticated');
    }
    const client = c.get('client');
    const addrHash = c.get('addrHash');
    if (client === null || addrHash === null) {
      throw new Error('The middleware chain set no client or address hash.');
    }
    const now = deps.clock.now();
    const claims = await verifyAppleIdToken(
      deps.identityKeys.apple,
      body.idToken,
      [config.bundleId, config.servicesId],
      now,
    );
    // The audience the user authorised with: the bundle id on iOS, the Services ID on the web (D-242).
    const clientId = claims.aud;
    const { code } = body;
    const exchange =
      code === null
        ? null
        : async (): Promise<Uint8Array | null> => {
            const refreshToken = await exchangeAppleCode(deps, config, {
              code,
              clientId,
              publicUrl: deps.env.PUBLIC_URL,
              now,
              log: deps.logger,
            });
            return refreshToken === null
              ? null
              : encryptRefreshToken(deps.keyRing, refreshToken, claims.sub);
          };
    const named = appleDisplayName(body.name?.givenName ?? null, body.name?.familyName ?? null);
    const name = named.ok ? named.value : null;
    const session = c.get('session');
    const platform = client.value.platform;
    const result = await providerSignIn(deps, deps.env, {
      identity: appleIdentityInput(claims),
      method: 'apple',
      rawNonce: body.nonce,
      nonceClaimOk: appleNonceMatches(claims, sha256Hex(body.nonce)),
      intent: body.intent,
      signup: body.signup ?? null,
      name,
      clientId,
      exchange,
      viewer,
      session: session === null ? null : { id: session.id },
      platform,
      addrHash,
      now,
    });
    return answerSignIn(c, deps, {
      userId: result.userId,
      session: result.session,
      keptSession: null,
      created: result.created,
      platform,
      now,
      adminEmails: parseAdminEmails(deps.env.ADMIN_EMAILS),
      publicUrl: deps.env.PUBLIC_URL,
    });
  };
}
