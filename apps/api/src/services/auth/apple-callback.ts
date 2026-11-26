import { authChallenges } from '@citizenrun/db';
import {
  APPLE_HANDOFF_TTL_MS,
  ApiError,
  appleDisplayName,
  brandVariant,
  newId,
  variantForAppEnv,
} from '@citizenrun/shared';
import type { AppleCallbackForm, Logger } from '@citizenrun/shared';
import {
  encryptRefreshToken,
  randomToken,
  sha256Hex,
  verifyToken,
} from '@citizenrun/shared/crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { enqueueOf, flagsOf } from '../../deps.ts';
import type { Deps } from '../../deps.ts';
import type { ApiEnv } from '../../env.ts';
import {
  appleConfig,
  appleIdentityInput,
  appleNonceMatches,
  exchangeAppleCode,
  verifyAppleIdToken,
} from './apple.ts';
import type { AppleIdClaims } from './apple.ts';
import { consumeNonce } from './nonces.ts';
import { applyExistingIdentity, resolveIdentity } from './resolve-identity.ts';
import { checkCreationPreconditions, createUserWithIdentity } from './sign-up.ts';

// The app's return path; the scheme in front of it comes from the brand module only (E-AUTH-05).
const RETURN_PATH = '://auth/apple?';
// How many times the callback resolves inside its transaction after a concurrent sign-up won a race.
const MAX_RESOLUTIONS = 3;

/** <scheme>://auth/apple with the given query; the scheme is fixed by the brand module, never taken from the request. */
export function appleReturnLocation(
  env: ApiEnv,
  query: { code?: string; error?: string; appleState?: string },
): string {
  const params = new URLSearchParams();
  if (query.code !== undefined) {
    params.set('code', query.code);
  }
  if (query.error !== undefined) {
    params.set('error', query.error);
  }
  if (query.appleState !== undefined) {
    params.set('state', query.appleState);
  }
  return brandVariant(variantForAppEnv(env.APP_ENV)).scheme + RETURN_PATH + params.toString();
}

// Apple's `user` field of the first authorization: only the name is read from it.
const AppleUserSchema = z.object({
  name: z.object({ firstName: z.string().optional(), lastName: z.string().optional() }).optional(),
});

// The new user's name from Apple's `user` field, through the one Apple name rule; a value that does
// not parse gives no name, and a name over the limit gives null (L-apple).
function nameFromUserField(user: string | undefined): string | null {
  if (user === undefined) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(user);
  } catch {
    return null;
  }
  const parsed = AppleUserSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const firstName = parsed.data.name?.firstName;
  const lastName = parsed.data.name?.lastName;
  const r = appleDisplayName(firstName ?? null, lastName ?? null);
  return r.ok ? r.value : null;
}

/**
 * E-AUTH-05: Apple's form post on Android. Every outcome is the Location of a redirect to the app;
 * nothing throws for a refusal. A success makes the 60-second hand-off code bound to the nonce
 * hash and creates no session (D-169, D-440). Never logs a form field.
 */
export async function appleCallback(
  deps: Deps,
  env: ApiEnv,
  input: { form: AppleCallbackForm; addrHash: string; now: Date; log: Logger },
): Promise<string> {
  const { form, now } = input;
  // 1. Before anything else (PC3A-47).
  const config = appleConfig(env);
  if (config === null) {
    return appleReturnLocation(env, { error: 'provider_not_configured' });
  }
  // 2.
  if (form.error !== undefined) {
    return appleReturnLocation(env, { error: 'cancelled' });
  }
  // 3. Named appleState, never state (D-450).
  const verified = verifyToken(deps.keyRing, 'apple_state', form.state, now);
  const n = verified?.['n'];
  if (typeof n !== 'string') {
    return appleReturnLocation(env, { error: 'state_invalid' });
  }
  const appleState = form.state;
  const refuse = (error: string): string => appleReturnLocation(env, { error, appleState });

  // 4. The nonce challenge an Android app asked for, unused and unexpired.
  // index: auth_challenges_secret_hash_key
  const [challenge] = await deps.db
    .select({ id: authChallenges.id })
    .from(authChallenges)
    .where(
      and(
        eq(authChallenges.secretHash, n),
        eq(authChallenges.kind, 'nonce'),
        eq(authChallenges.platform, 'android'),
        isNull(authChallenges.usedAt),
        gt(authChallenges.expiresAt, sql`now()`),
      ),
    );
  if (challenge === undefined) {
    return refuse('nonce_invalid');
  }

  // 5. The audience is the Services ID only.
  if (form.id_token === undefined) {
    return refuse('token_invalid');
  }
  let claims: AppleIdClaims;
  try {
    claims = await verifyAppleIdToken(
      deps.identityKeys.apple,
      form.id_token,
      [config.servicesId],
      now,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return refuse('token_invalid');
    }
    throw error;
  }
  if (!appleNonceMatches(claims, n)) {
    return refuse('nonce_invalid');
  }

  // 6. Refusals redirect with their code; a new user needs only the address limit here.
  const identity = appleIdentityInput(claims);
  const resolution = await resolveIdentity(deps.db, identity);
  if (resolution.kind === 'refused') {
    return refuse(resolution.code);
  }
  if (resolution.kind === 'new') {
    try {
      await checkCreationPreconditions(deps.db, {
        mode: 'callback',
        intent: 'sign_in',
        signup: null,
        platform: 'android',
        addrHash: input.addrHash,
        flags: flagsOf(deps),
        now,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return refuse('signup_limit_reached');
      }
      throw error;
    }
  }

  // 7. The exchange runs before the transaction (00 section 5.7).
  let refreshTokenEnc: Uint8Array | null = null;
  if (form.code !== undefined) {
    const refreshToken = await exchangeAppleCode(deps, config, {
      code: form.code,
      clientId: config.servicesId,
      publicUrl: env.PUBLIC_URL,
      now,
      log: input.log,
    });
    refreshTokenEnc =
      refreshToken === null ? null : encryptRefreshToken(deps.keyRing, refreshToken, claims.sub);
  }

  // 8. One transaction: consume the nonce, resolve again, create or attach, make the hand-off.
  const name = nameFromUserField(form.user);
  let handoff: string;
  try {
    handoff = await deps.db.transaction(async (tx): Promise<string> => {
      if (!(await consumeNonce(tx, n))) {
        throw new ApiError('nonce_invalid');
      }
      for (let attempt = 1; attempt <= MAX_RESOLUTIONS; attempt += 1) {
        const current = await resolveIdentity(tx, identity);
        if (current.kind === 'refused') {
          throw new ApiError(current.code);
        }
        let userId: string;
        if (current.kind === 'existing') {
          await applyExistingIdentity(tx, identity, current, {
            clientId: config.servicesId,
            refreshTokenEnc,
            enqueue: enqueueOf(deps),
          });
          userId = current.userId;
        } else {
          // The age record stays null until E-AUTH-06 (02 T-users allows it for this route only).
          const made = await createUserWithIdentity(tx, {
            identity,
            signup: null,
            platform: 'android',
            addrHash: input.addrHash,
            now,
            name,
            clientId: config.servicesId,
            refreshTokenEnc,
            method: 'apple',
          });
          if (made.kind === 'retry') {
            continue;
          }
          userId = made.userId;
        }
        // The stored hash needs the nonce hash as well, so the code alone finds no row (D-440).
        const code = randomToken();
        await tx.insert(authChallenges).values({
          id: newId(),
          kind: 'apple_handoff',
          secretHash: sha256Hex(code + '.' + n),
          userId,
          platform: 'android',
          expiresAt: new Date(now.getTime() + APPLE_HANDOFF_TTL_MS),
        });
        return code;
      }
      throw new Error('The callback lost its race three times.');
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return refuse(error.code);
    }
    throw error;
  }

  // 9. No session and no cookie here (D-169).
  return appleReturnLocation(env, { code: handoff, appleState });
}
