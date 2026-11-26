import { authChallenges, users } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import { ApiError } from '@citizenrun/shared';
import type { SignInIntent, SignupDetails } from '@citizenrun/shared';
import { sha256Hex } from '@citizenrun/shared/crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { flagsOf } from '../../deps.ts';
import type { Deps } from '../../deps.ts';
import type { ApiEnv } from '../../env.ts';
import { parseAdminEmails } from '../../middleware/gates.ts';
import type { Platform, Viewer } from '../../middleware/session.ts';
import { finishSignIn } from './complete-sign-in.ts';
import type { NewSession } from './sessions.ts';
import { checkCreationPreconditions, completeDeferredSignup } from './sign-up.ts';

/** What a finished hand-off hands its route. */
export type AppleHandoffResult = {
  userId: string;
  created: boolean;
  session: NewSession;
  promoted: boolean;
};

const HANDOFF_KIND = 'apple_handoff';
const ANDROID: Platform = 'android';

// T-auth_challenges' single-statement consume of a hand-off code; its user, or null when this call
// consumed nothing.
async function consumeHandoff(tx: Tx, secretHash: string): Promise<string | null> {
  // index: auth_challenges_secret_hash_key
  const [consumed] = await tx
    .update(authChallenges)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(authChallenges.secretHash, secretHash),
        eq(authChallenges.kind, HANDOFF_KIND),
        isNull(authChallenges.usedAt),
        gt(authChallenges.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: authChallenges.userId });
  return consumed?.userId ?? null;
}

// The live hand-off row with its user's status and age method; reads only.
async function findHandoff(db: Db, secretHash: string) {
  // index: auth_challenges_secret_hash_key
  const [row] = await db
    .select({
      userId: authChallenges.userId,
      status: users.status,
      ageMethod: users.ageMethod,
    })
    .from(authChallenges)
    .innerJoin(users, eq(users.id, authChallenges.userId))
    .where(
      and(
        eq(authChallenges.secretHash, secretHash),
        eq(authChallenges.kind, HANDOFF_KIND),
        eq(authChallenges.platform, ANDROID),
        isNull(authChallenges.usedAt),
        gt(authChallenges.expiresAt, sql`now()`),
      ),
    );
  return row ?? null;
}

/**
 * E-AUTH-06: trades the callback's hand-off code and the raw nonce for a session on Android. A
 * wrong nonce finds no row (D-440). A deleting user or a reauth mismatch consumes the code; a
 * creation-check refusal leaves it usable within its 60 seconds. Logs `auth.admin_bootstrap` after
 * the commit when the user became an admin. Never logs the code, the nonce or the session token.
 */
export async function appleHandoff(
  deps: Deps,
  env: ApiEnv,
  input: {
    code: string;
    nonce: string;
    intent: SignInIntent;
    signup: SignupDetails | null;
    viewer: Viewer | null;
    session: { id: string } | null;
    platform: Platform;
    addrHash: string;
    now: Date;
  },
): Promise<AppleHandoffResult> {
  const { intent, viewer, now } = input;
  // 1.
  if (input.platform !== ANDROID) {
    throw new ApiError('handoff_invalid');
  }
  // 2.
  if (intent === 'reauth' && viewer === null) {
    throw new ApiError('unauthenticated');
  }
  // 3. The row is keyed by the code and the nonce's hash together.
  const secretHash = sha256Hex(input.code + '.' + sha256Hex(input.nonce));
  const row = await findHandoff(deps.db, secretHash);
  if (row === null || row.userId === null) {
    throw new ApiError('handoff_invalid');
  }
  const userId = row.userId;
  // 4.
  if (row.status === 'deleting') {
    await deps.db.transaction((tx) => consumeHandoff(tx, secretHash));
    throw new ApiError('account_deleting');
  }
  const ageMissing = row.ageMethod === null;
  // 5. A user with no age record never satisfies reauth.
  if (intent === 'reauth' && !(userId === viewer?.userId && !ageMissing)) {
    await deps.db.transaction((tx) => consumeHandoff(tx, secretHash));
    throw new ApiError('reauth_mismatch');
  }
  // 6. The sign-up details E-AUTH-05 could not ask for (D-463); a refusal keeps the code.
  if (ageMissing) {
    await checkCreationPreconditions(deps.db, {
      mode: 'handoff',
      intent,
      signup: input.signup,
      platform: ANDROID,
      addrHash: input.addrHash,
      flags: flagsOf(deps),
      now,
    });
  }
  // 7.
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);
  const finished = await deps.db.transaction(async (tx) => {
    const consumedBy = await consumeHandoff(tx, secretHash);
    if (consumedBy === null) {
      throw new ApiError('handoff_invalid');
    }
    // The age record read again under the user's lock: of two hand-offs for one new user at once,
    // only the first writes the sign-up records.
    let completed = false;
    if (ageMissing) {
      if (input.signup === null) {
        throw new ApiError('signup_details_required');
      }
      // index: users_pkey
      const [locked] = await tx
        .select({ ageMethod: users.ageMethod })
        .from(users)
        .where(eq(users.id, consumedBy))
        .for('update');
      if (locked?.ageMethod === null) {
        await completeDeferredSignup(tx, {
          userId: consumedBy,
          signup: input.signup,
          platform: ANDROID,
          now,
        });
        completed = true;
      }
    }
    const signedIn = await finishSignIn(tx, {
      userId: consumedBy,
      carriedSessionId: input.session?.id ?? null,
      platform: ANDROID,
      now,
      adminEmails,
    });
    return { ...signedIn, completed };
  });
  if (finished.promoted) {
    deps.logger.info('auth.admin_bootstrap', { userId });
  }
  // 8. `created` is true when this request wrote the age record that was null before it.
  return {
    userId,
    created: finished.completed,
    session: finished.session,
    promoted: finished.promoted,
  };
}
