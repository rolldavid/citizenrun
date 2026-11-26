import { ApiError } from '@citizenrun/shared';
import type { ErrorCode, SignInIntent, SignupDetails } from '@citizenrun/shared';
import { enqueueOf, flagsOf } from '../../deps.ts';
import type { Deps } from '../../deps.ts';
import type { ApiEnv } from '../../env.ts';
import { parseAdminEmails } from '../../middleware/gates.ts';
import type { Platform, Viewer } from '../../middleware/session.ts';
import { finishSignIn } from './complete-sign-in.ts';
import { consumeNonce, findUsableNonce } from './nonces.ts';
import { applyExistingIdentity, resolveIdentity } from './resolve-identity.ts';
import type { IdentityInput, Resolution } from './resolve-identity.ts';
import type { NewSession } from './sessions.ts';
import { checkCreationPreconditions, createUserWithIdentity } from './sign-up.ts';

/** What a finished provider sign-in hands its route. */
export type ProviderSignInResult = {
  userId: string;
  created: boolean;
  session: NewSession;
  promoted: boolean;
};

// How many times a sign-in resolves inside its transaction after a concurrent sign-up won a race.
const MAX_RESOLUTIONS = 3;

// A refusal that keeps the transaction's writes (the consumed nonce): returned from the callback,
// thrown after the commit.
type Outcome = { refuse: ErrorCode } | { done: ProviderSignInResult };

// The refusal of a resolution for this intent, or null when the sign-in may go on (L-account-link).
function refusalOf(
  resolution: Resolution,
  intent: SignInIntent,
  viewer: Viewer | null,
): ErrorCode | null {
  if (resolution.kind === 'refused') {
    return resolution.code;
  }
  if (
    intent === 'reauth' &&
    !(resolution.kind === 'existing' && resolution.userId === viewer?.userId)
  ) {
    return 'reauth_mismatch';
  }
  return null;
}

/**
 * The shared part of E-AUTH-04 and E-AUTH-08: checks the nonce without consuming it, resolves the
 * identity, runs the creation checks, makes the provider's network call before any transaction,
 * then consumes the nonce and signs in inside one transaction. A refusal of the resolution consumes
 * the nonce; a creation-check refusal leaves it usable. Logs `auth.admin_bootstrap` after the
 * commit when the user became an admin. Never logs the token, the nonce or the email.
 */
export async function providerSignIn(
  deps: Deps,
  env: ApiEnv,
  input: {
    identity: IdentityInput;
    method: 'apple' | 'google';
    rawNonce: string;
    nonceClaimOk: boolean;
    intent: SignInIntent;
    signup: SignupDetails | null;
    name: string | null;
    clientId: string | null;
    exchange: (() => Promise<Uint8Array | null>) | null; // Apple: exchanges the code and encrypts the refresh token
    viewer: Viewer | null;
    session: { id: string } | null;
    platform: Platform;
    addrHash: string;
    now: Date;
  },
): Promise<ProviderSignInResult> {
  const { identity, intent, viewer, now } = input;
  const creationInput = {
    mode: 'full',
    intent,
    signup: input.signup,
    platform: input.platform,
    addrHash: input.addrHash,
    flags: flagsOf(deps),
    now,
  } as const;

  // 1. The nonce is checked, not consumed (L-apple).
  const usable = await findUsableNonce(deps.db, input.rawNonce);
  if (usable === null || !input.nonceClaimOk) {
    throw new ApiError('nonce_invalid');
  }

  // 2. A refusal or a reauth mismatch consumes the nonce in its own transaction.
  const first = await resolveIdentity(deps.db, identity);
  const refused = refusalOf(first, intent, viewer);
  if (refused !== null) {
    await deps.db.transaction((tx) => consumeNonce(tx, usable.secretHash));
    throw new ApiError(refused);
  }

  // 3. A creation-check refusal leaves the nonce usable, so the request can be retried with it.
  if (first.kind === 'new') {
    await checkCreationPreconditions(deps.db, creationInput);
  }

  // 4. The network call runs before the transaction (00 section 5.7).
  const refreshTokenEnc = input.exchange === null ? null : await input.exchange();

  // 5. One transaction: consume, resolve again so a concurrent sign-up is seen, sign in.
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);
  const outcome = await deps.db.transaction(async (tx): Promise<Outcome> => {
    if (!(await consumeNonce(tx, usable.secretHash))) {
      throw new ApiError('nonce_invalid');
    }
    let checked = first.kind === 'new';
    for (let attempt = 1; attempt <= MAX_RESOLUTIONS; attempt += 1) {
      const resolution = await resolveIdentity(tx, identity);
      const refusal = refusalOf(resolution, intent, viewer);
      if (refusal !== null) {
        return { refuse: refusal };
      }
      let userId: string;
      let created = false;
      if (resolution.kind === 'existing') {
        await applyExistingIdentity(tx, identity, resolution, {
          clientId: input.clientId,
          refreshTokenEnc,
          enqueue: enqueueOf(deps),
        });
        userId = resolution.userId;
      } else {
        if (!checked) {
          // A refusal here rolls back, leaving the nonce usable.
          await checkCreationPreconditions(tx, creationInput);
          checked = true;
        }
        const made = await createUserWithIdentity(tx, {
          identity,
          signup: input.signup,
          platform: input.platform,
          addrHash: input.addrHash,
          now,
          name: input.name,
          clientId: input.clientId,
          refreshTokenEnc,
          method: input.method,
        });
        if (made.kind === 'retry') {
          continue;
        }
        userId = made.userId;
        created = true;
      }
      const finished = await finishSignIn(tx, {
        userId,
        carriedSessionId: input.session?.id ?? null,
        platform: input.platform,
        now,
        adminEmails,
      });
      return {
        done: { userId, created, session: finished.session, promoted: finished.promoted },
      };
    }
    throw new Error('The sign-in lost its race three times.');
  });

  if ('refuse' in outcome) {
    throw new ApiError(outcome.refuse);
  }
  // 6. After the commit, a promotion is logged with the user id only.
  if (outcome.done.promoted) {
    deps.logger.info('auth.admin_bootstrap', { userId: outcome.done.userId });
  }
  return outcome.done;
}
