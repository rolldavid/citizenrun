import { authIdentities, userConsents, users } from '@citizenrun/db';
import type { Db, FlagReader, Tx } from '@citizenrun/db';
import { ApiError, LEGAL_VERSIONS, SIGNUPS_PER_ADDRESS_PER_DAY, newId } from '@citizenrun/shared';
import type { SignInIntent, SignupDetails } from '@citizenrun/shared';
import { and, eq, isNull } from 'drizzle-orm';
import {
  addrKey,
  countWindow,
  readWindow,
  retryAfterSeconds,
} from '../../middleware/rate-limit-store.ts';
import type { Platform } from '../../middleware/session.ts';
import { writeAppEvent } from '../events/app-events.ts';
import type { IdentityInput } from './resolve-identity.ts';

/** Which creation checks a sign-in runs: every one, E-AUTH-05's, or E-AUTH-06's. */
export type CreationMode = 'full' | 'callback' | 'handoff';

/** A created user, or a lost race the caller answers by resolving again. */
export type CreateResult = { kind: 'created'; userId: string } | { kind: 'retry' };

// The address limit's action and window: `ip:<address hash>:signup:1d` (L-account-link).
const SIGNUP_ACTION = 'signup';
const SIGNUP_WINDOW = '1d';

function signupKey(addrHash: string): string {
  return addrKey(addrHash, SIGNUP_ACTION, SIGNUP_WINDOW);
}

function signupLimitReached(now: Date): ApiError {
  return new ApiError('signup_limit_reached', {
    retryAfterSeconds: retryAfterSeconds(SIGNUP_WINDOW, now),
  });
}

// Check 2: no session for a user without an age record (INV-24).
function requireSignup(signup: SignupDetails | null): SignupDetails {
  if (signup === null) {
    throw new ApiError('signup_details_required');
  }
  return signup;
}

// Check 3: each agreement at its current version.
function checkAgreements(signup: SignupDetails): void {
  const { agreements } = signup;
  if (
    agreements.termsVersion !== LEGAL_VERSIONS.terms ||
    agreements.contentPolicyVersion !== LEGAL_VERSIONS.content_policy ||
    agreements.privacyPolicyVersion !== LEGAL_VERSIONS.privacy_policy
  ) {
    throw new ApiError('consent_version_outdated');
  }
}

// Check 6: at most five new users a UTC day from one address; the count is added on creation.
async function checkAddressLimit(db: Db | Tx, addrHash: string, now: Date): Promise<void> {
  if (
    (await readWindow(db, signupKey(addrHash), SIGNUP_WINDOW, now)) >= SIGNUPS_PER_ADDRESS_PER_DAY
  ) {
    throw signupLimitReached(now);
  }
}

// Check 7: the per-state rules, only while some state differs from the launch default (D-463,
// D-530). The state is read here and never stored.
async function checkStateRules(signup: SignupDetails, flags: FlagReader): Promise<void> {
  if (await flags.stateRulesAtLaunchDefault()) {
    return;
  }
  const state = signup.state ?? null;
  if (state === null) {
    throw new ApiError('invalid_request', { fields: { 'signup.state': 'required' } });
  }
  const rule = await flags.stateRule(state);
  if (rule?.signup === 'withhold') {
    throw new ApiError('unavailable_in_state');
  }
  if (rule?.ageMethod === 'store_signal_required' && signup.age.method !== 'store_signal') {
    throw new ApiError('age_signal_required');
  }
}

function notReadAhead(): Promise<never> {
  return Promise.reject(new Error('A state rule was asked for that was not read ahead.'));
}

/**
 * Reads, on the pool, every state rule check 7 can ask about for `signup`, and returns a reader
 * that answers from those values alone. A caller that runs the creation checks inside a
 * transaction calls this before opening it, so no pool query is awaited while the transaction
 * holds a client (D-138: one client per request).
 */
export async function readStateRulesAhead(
  flags: FlagReader,
  signup: SignupDetails | null,
): Promise<FlagReader> {
  if (signup === null) {
    // Check 2 refuses before check 7 asks anything.
    return { stateRulesAtLaunchDefault: notReadAhead, stateRule: notReadAhead };
  }
  const atLaunchDefault = await flags.stateRulesAtLaunchDefault();
  const state = atLaunchDefault ? null : (signup.state ?? null);
  const rule = state === null ? null : await flags.stateRule(state);
  return {
    stateRulesAtLaunchDefault: () => Promise.resolve(atLaunchDefault),
    stateRule: (asked) =>
      state !== null && asked === state ? Promise.resolve(rule) : notReadAhead(),
  };
}

/** Creation checks of L-account-link in order; throws the first refusal as an ApiError. */
export async function checkCreationPreconditions(
  db: Db | Tx,
  input: {
    mode: CreationMode;
    intent: SignInIntent | 'add_email';
    signup: SignupDetails | null;
    platform: Platform;
    addrHash: string;
    flags: FlagReader;
    now: Date;
  },
): Promise<void> {
  const { mode } = input;
  if (mode === 'callback') {
    await checkAddressLimit(db, input.addrHash, input.now);
    return;
  }
  if (mode === 'full' && input.intent !== 'sign_in') {
    throw new ApiError('reauth_mismatch');
  }
  const signup = requireSignup(input.signup);
  checkAgreements(signup);
  if (mode === 'full') {
    if (input.platform === 'web' && signup.age.method === 'store_signal') {
      throw new ApiError('invalid_request', { fields: { 'signup.age.method': 'not_allowed' } });
    }
    await checkAddressLimit(db, input.addrHash, input.now);
  }
  await checkStateRules(signup, input.flags);
}

// The records every sign-up writes (L-account-link, L-app-events): the three agreements, the
// AI-screening answer when one was given, and `account_created`.
async function writeSignupRecords(
  tx: Tx,
  input: {
    userId: string;
    signup: SignupDetails;
    platform: Platform;
    method: 'email' | 'apple' | 'google';
  },
): Promise<void> {
  const { userId, signup, platform } = input;
  const consents: (typeof userConsents.$inferInsert)[] = [
    { id: newId(), userId, kind: 'terms', version: LEGAL_VERSIONS.terms, granted: true, platform },
    {
      id: newId(),
      userId,
      kind: 'content_policy',
      version: LEGAL_VERSIONS.content_policy,
      granted: true,
      platform,
    },
    {
      id: newId(),
      userId,
      kind: 'privacy_policy',
      version: LEGAL_VERSIONS.privacy_policy,
      granted: true,
      platform,
    },
  ];
  if (signup.aiScreening !== null) {
    consents.push({
      id: newId(),
      userId,
      kind: 'ai_screening',
      version: LEGAL_VERSIONS.ai_screening,
      granted: signup.aiScreening,
      platform,
    });
  }
  await tx.insert(userConsents).values(consents);
  await writeAppEvent(tx, {
    userId,
    name: 'account_created',
    props: { method: input.method },
    platform,
  });
}

// Thrown inside the creation savepoint to undo its writes when a concurrent sign-up won the race.
class LostRace extends Error {
  override readonly name = 'LostRace';
}

function ageColumns(signup: SignupDetails | null, now: Date) {
  if (signup === null) {
    return { ageMethod: null, ageResult: null, ageSourceTier: null, ageCheckedAt: null };
  }
  // Only a store signal claims a result; a sign-up with no signal records that none came (D-897).
  if (signup.age.method === 'none') {
    return { ageMethod: 'none', ageResult: null, ageSourceTier: null, ageCheckedAt: now };
  }
  return {
    ageMethod: signup.age.method,
    ageResult: 'adult',
    ageSourceTier: signup.age.sourceTier,
    ageCheckedAt: now,
  };
}

/**
 * Creates the user of rows 6 and 7 with its identity, inside a savepoint so a `retry` undoes its
 * own writes, the address count included. With `signup` it also writes the sign-up records.
 */
export async function createUserWithIdentity(
  tx: Tx,
  input: {
    identity: IdentityInput;
    signup: SignupDetails | null;
    platform: Platform;
    addrHash: string;
    now: Date;
    name: string | null;
    clientId: string | null;
    refreshTokenEnc: Uint8Array | null;
    method: 'email' | 'apple' | 'google';
  },
): Promise<CreateResult> {
  const { identity, now } = input;
  try {
    return await tx.transaction(async (sp): Promise<CreateResult> => {
      // The concurrent case check 6 could not see.
      const count = await countWindow(sp, signupKey(input.addrHash), SIGNUP_WINDOW, now);
      if (count > SIGNUPS_PER_ADDRESS_PER_DAY) {
        throw signupLimitReached(now);
      }
      const email = identity.emailVerifiedAuthoritative ? identity.email : null;
      const insertUser = (address: string | null) =>
        sp
          .insert(users)
          .values({
            id: newId(),
            email: address,
            onboardingStep: 'photo',
            locale: 'en',
            name: input.name,
            ...ageColumns(input.signup, now),
          })
          .onConflictDoNothing({ target: users.email })
          .returning({ id: users.id });
      let [created] = await insertUser(email);
      if (created === undefined && email !== null) {
        if (identity.provider !== 'apple' || identity.isPrivateEmail !== true) {
          throw new LostRace();
        }
        // An Apple relay address held by another user: the new user has none (D-462).
        [created] = await insertUser(null);
      }
      if (created === undefined) {
        throw new Error('The users insert returned no row.');
      }
      const userId = created.id;
      const [attached] = await sp
        .insert(authIdentities)
        .values({
          userId,
          provider: identity.provider,
          subject: identity.subject,
          email: identity.email,
          emailVerified: identity.emailVerified,
          isPrivateEmail: identity.isPrivateEmail,
          clientId: input.clientId,
          refreshTokenEnc: input.refreshTokenEnc,
        })
        .onConflictDoNothing({ target: [authIdentities.provider, authIdentities.subject] })
        .returning({ userId: authIdentities.userId });
      if (attached === undefined) {
        throw new LostRace();
      }
      if (input.signup !== null) {
        await writeSignupRecords(sp, {
          userId,
          signup: input.signup,
          platform: input.platform,
          method: input.method,
        });
      }
      return { kind: 'created', userId };
    });
  } catch (error) {
    if (error instanceof LostRace) {
      return { kind: 'retry' };
    }
    throw error;
  }
}

/** E-AUTH-06: completes a user created by E-AUTH-05 without an age record. */
export async function completeDeferredSignup(
  tx: Tx,
  input: { userId: string; signup: SignupDetails; platform: Platform; now: Date },
): Promise<void> {
  await tx
    .update(users)
    .set(ageColumns(input.signup, input.now))
    .where(and(eq(users.id, input.userId), isNull(users.ageMethod)));
  await writeSignupRecords(tx, {
    userId: input.userId,
    signup: input.signup,
    platform: input.platform,
    method: 'apple',
  });
}
