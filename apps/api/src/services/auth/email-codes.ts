import { addUsage, authIdentities, dayPeriod, emailCodes, users } from '@citizenrun/db';
import type { Tx } from '@citizenrun/db';
import {
  ApiError,
  EMAIL_CODES_PER_EMAIL_PER_HOUR,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_RESEND_MIN_MS,
  EMAIL_CODE_TTL_MS,
  SIGNIN_EMAIL_ALERT_AT,
  SIGNIN_EMAIL_DAILY_CEILING,
  brandVariant,
  newId,
  variantForAppEnv,
} from '@citizenrun/shared';
import type { EmailStartResult, ErrorCode, SignInIntent, SignupDetails } from '@citizenrun/shared';
import {
  emailCodeHash,
  keyedHash,
  newEmailCode,
  randomToken,
  safeEqualHex,
  sha256Hex,
} from '@citizenrun/shared/crypto';
import { and, eq, gt, isNull, lte, ne, sql } from 'drizzle-orm';
import { enqueueOf, flagsOf } from '../../deps.ts';
import type { Deps } from '../../deps.ts';
import type { ApiEnv } from '../../env.ts';
import { parseAdminEmails } from '../../middleware/gates.ts';
import type { AdminEmails } from '../../middleware/gates.ts';
import { countWindow, emailCodeKey, retryAfterSeconds } from '../../middleware/rate-limit-store.ts';
import type { Platform, Viewer } from '../../middleware/session.ts';
import { applyAdminElevation } from './admin-elevation.ts';
import { sendCodeEmail } from './code-email.ts';
import { finishSignIn } from './complete-sign-in.ts';
import { applyExistingIdentity, isUniqueViolation, resolveIdentity } from './resolve-identity.ts';
import type { IdentityInput } from './resolve-identity.ts';
import { isReviewAddress, parseReviewEmails } from './review-signin.ts';
import type { NewSession } from './sessions.ts';
import {
  checkCreationPreconditions,
  createUserWithIdentity,
  readStateRulesAhead,
} from './sign-up.ts';

/** Seconds between two `signin_ceiling` alerts: one email a day (J-ops.alert's throttle table). */
const SIGNIN_ALERT_THROTTLE_SECONDS = 86400; // J-ops.alert

const MS_PER_SECOND = 1000;
// The language of an email to an address no user holds (L-email-code).
const DEFAULT_LOCALE = 'en';
// How many times a sign-in resolves again after a concurrent sign-up won a race.
const MAX_RESOLUTIONS = 3;

function addMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

/**
 * E-AUTH-01 (L-email-code): starts a challenge for `email`, or resends the code of the live
 * challenge `pendingToken` names, and sends the code email after the write commits. The answer
 * has the same shape for every address (D-243). Never logs the email, the code or the token.
 */
export async function startEmailSignIn(
  deps: Deps,
  env: ApiEnv,
  input: { email: string; pendingToken: string | null; now: Date },
): Promise<EmailStartResult> {
  const { db, keyRing } = deps;
  const { email, now } = input;

  // index: users_email_key
  const [user] = await db
    .select({ emailStatus: users.emailStatus, locale: users.locale })
    .from(users)
    .where(eq(users.email, email));
  if (user !== undefined && user.emailStatus !== 'ok') {
    throw new ApiError('email_undeliverable');
  }

  let resend: { id: string; pendingToken: string } | null = null;
  if (input.pendingToken !== null) {
    // index: email_codes_pending_token_hash_key
    const [live] = await db
      .select({ id: emailCodes.id, lastSentAt: emailCodes.lastSentAt })
      .from(emailCodes)
      .where(
        and(
          eq(emailCodes.pendingTokenHash, sha256Hex(input.pendingToken)),
          eq(emailCodes.email, email),
          gt(emailCodes.expiresAt, now),
        ),
      );
    if (live !== undefined) {
      const waitMs = live.lastSentAt.getTime() + EMAIL_CODE_RESEND_MIN_MS - now.getTime();
      if (waitMs > 0) {
        throw new ApiError('rate_limited', {
          retryAfterSeconds: Math.max(1, Math.ceil(waitMs / MS_PER_SECOND)),
        });
      }
      resend = { id: live.id, pendingToken: input.pendingToken };
    }
  }

  // The per-email limit lives in rate_limits, so a deleted challenge never resets it (D-400).
  const sends = await countWindow(
    db,
    emailCodeKey(keyedHash(keyRing, { kind: 'email', email })),
    '1h',
    now,
  );
  if (sends > EMAIL_CODES_PER_EMAIL_PER_HOUR) {
    throw new ApiError('rate_limited', { retryAfterSeconds: retryAfterSeconds('1h', now) });
  }

  // A review address signs in with the configured code and gets no email (L-review-signin).
  const reviewCode = isReviewAddress(email, parseReviewEmails(env.REVIEW_SIGNIN_EMAILS))
    ? env.REVIEW_SIGNIN_CODE
    : null;
  const isReview = reviewCode !== null;
  if (!isReview) {
    const today = await addUsage(db, 'email.signin.day', dayPeriod(now), 1);
    if (today > SIGNIN_EMAIL_DAILY_CEILING) {
      throw new ApiError('email_signin_paused');
    }
    if (today === SIGNIN_EMAIL_ALERT_AT) {
      await enqueueOf(deps)(
        'ops.alert',
        {
          kind: 'cost_projection',
          values: {
            line: 'signin_ceiling',
            value: SIGNIN_EMAIL_ALERT_AT,
            projected: SIGNIN_EMAIL_ALERT_AT,
            threshold: SIGNIN_EMAIL_ALERT_AT,
          },
        },
        { throttle: { seconds: SIGNIN_ALERT_THROTTLE_SECONDS, key: 'cost:signin_ceiling' } },
      );
    }
  }

  const code = reviewCode ?? newEmailCode();
  const codeHash = emailCodeHash(keyRing, email, code);
  const expiresAt = addMs(now, EMAIL_CODE_TTL_MS);

  let challengeId: string;
  let sendCount: number;
  let pendingToken: string;
  // A resend keeps `attempts`, so one challenge never takes more than five wrong codes (D-243). The
  // update holds the 30-second rule and the expiry itself, so of two resends sent at once only one
  // passes, and a challenge spent or deleted since the read updates nothing.
  const [updated] =
    resend === null
      ? []
      : await db
          .update(emailCodes)
          .set({
            codeHash,
            expiresAt,
            sendCount: sql`${emailCodes.sendCount} + 1`,
            lastSentAt: now,
          })
          .where(
            and(
              eq(emailCodes.id, resend.id),
              gt(emailCodes.expiresAt, now),
              lte(emailCodes.lastSentAt, addMs(now, -EMAIL_CODE_RESEND_MIN_MS)),
            ),
          )
          .returning({ sendCount: emailCodes.sendCount });
  if (resend !== null && updated === undefined) {
    // index: email_codes_pkey
    const [still] = await db
      .select({ lastSentAt: emailCodes.lastSentAt })
      .from(emailCodes)
      .where(and(eq(emailCodes.id, resend.id), gt(emailCodes.expiresAt, now)));
    if (still !== undefined) {
      const waitMs = still.lastSentAt.getTime() + EMAIL_CODE_RESEND_MIN_MS - now.getTime();
      throw new ApiError('rate_limited', {
        retryAfterSeconds: Math.max(1, Math.ceil(waitMs / MS_PER_SECOND)),
      });
    }
    // The challenge is gone: this is a new challenge (E-AUTH-01 step 4).
    resend = null;
  }
  if (resend === null || updated === undefined) {
    pendingToken = randomToken();
    challengeId = newId();
    sendCount = 1;
    await db.insert(emailCodes).values({
      id: challengeId,
      email,
      pendingTokenHash: sha256Hex(pendingToken),
      codeHash,
      expiresAt,
      attempts: 0,
      sendCount,
      lastSentAt: now,
    });
  } else {
    pendingToken = resend.pendingToken;
    challengeId = resend.id;
    sendCount = updated.sendCount;
  }

  if (!isReview) {
    try {
      await sendCodeEmail(deps.mailer, {
        to: email,
        code,
        locale: user?.locale ?? DEFAULT_LOCALE,
        appName: brandVariant(variantForAppEnv(env.APP_ENV)).displayName,
        challengeId,
        sendCount,
      });
    } catch {
      if (resend === null) {
        await db.delete(emailCodes).where(eq(emailCodes.id, challengeId));
      }
      deps.logger.warn('auth.code_send_failed');
      throw new ApiError('unavailable');
    }
  }

  return {
    pendingToken,
    expiresAt: expiresAt.toISOString(),
    resendAvailableAt: addMs(now, EMAIL_CODE_RESEND_MIN_MS).toISOString(),
  };
}

/** What a finished email sign-in hands its route. */
export type EmailSignInResult = {
  userId: string;
  created: boolean;
  session: NewSession | null;
  keptSession: { id: string; expiresAt: Date } | null;
  promoted: boolean;
};

// A refusal that keeps the transaction's writes: returned from the callback, thrown after commit.
type Outcome = { refuse: ErrorCode } | { done: EmailSignInResult };

async function deleteChallenge(tx: Tx, id: string): Promise<void> {
  await tx.delete(emailCodes).where(eq(emailCodes.id, id));
}

// E-AUTH-02 `add_email` (L-account-link "Intents"): the viewer, who has no email, gets this one.
async function addEmail(
  deps: Deps,
  tx: Tx,
  input: {
    challengeId: string;
    email: string;
    viewer: Viewer;
    session: { id: string; expiresAt: Date } | null;
    adminEmails: AdminEmails;
  },
): Promise<EmailSignInResult> {
  const { email, viewer } = input;
  const [own] = await tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, viewer.userId))
    .for('update');
  if (own === undefined) {
    throw new ApiError('unauthenticated');
  }
  if (own.email !== null) {
    throw new ApiError('email_already_set');
  }
  // index: users_email_key
  const [holder] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, viewer.userId)));
  // index: auth_identities_pkey
  const [identity] = await tx
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.provider, 'email'),
        eq(authIdentities.subject, email),
        ne(authIdentities.userId, viewer.userId),
      ),
    );
  if (holder !== undefined || identity !== undefined) {
    throw new ApiError('email_in_use');
  }
  await deleteChallenge(tx, input.challengeId);
  await tx
    .insert(authIdentities)
    .values({
      userId: viewer.userId,
      provider: 'email',
      subject: email,
      email,
      emailVerified: true,
    })
    .onConflictDoNothing({ target: [authIdentities.provider, authIdentities.subject] });
  try {
    await tx
      .update(users)
      .set({ email })
      .where(and(eq(users.id, viewer.userId), isNull(users.email)));
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_key')) {
      throw new ApiError('email_in_use');
    }
    throw error;
  }
  const promoted = await applyAdminElevation(tx, {
    userId: viewer.userId,
    adminEmails: input.adminEmails,
  });
  await enqueueOf(deps)(
    'notify.email',
    { template: 'signin_method_added', userId: viewer.userId, provider: 'email' },
    { tx },
  );
  return {
    userId: viewer.userId,
    created: false,
    session: null,
    keptSession: input.session,
    promoted,
  };
}

/**
 * E-AUTH-02: checks the code of the challenge `pendingToken` names and signs the address in,
 * creating, linking, re-authenticating or adding the email as the intent says. A wrong code and an
 * expired challenge commit their change before the refusal; a creation-check refusal changes
 * nothing. Logs `auth.admin_bootstrap` after the commit when the user became an admin. Never logs
 * the email, the code, the pending token or the session token.
 */
export async function verifyEmailSignIn(
  deps: Deps,
  env: ApiEnv,
  input: {
    pendingToken: string;
    code: string;
    intent: SignInIntent | 'add_email';
    signup: SignupDetails | null;
    viewer: Viewer | null;
    session: { id: string; expiresAt: Date } | null;
    platform: Platform;
    addrHash: string;
    now: Date;
  },
): Promise<EmailSignInResult> {
  const { viewer, intent, now } = input;
  if (intent !== 'sign_in' && viewer === null) {
    throw new ApiError('unauthenticated');
  }
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);
  // Read before the transaction: the creation checks inside it never wait on a second client.
  const flags = await readStateRulesAhead(flagsOf(deps), input.signup);

  const outcome = await deps.db.transaction(async (tx): Promise<Outcome> => {
    // index: email_codes_pending_token_hash_key
    const [row] = await tx
      .select({
        id: emailCodes.id,
        email: emailCodes.email,
        codeHash: emailCodes.codeHash,
        expiresAt: emailCodes.expiresAt,
      })
      .from(emailCodes)
      .where(eq(emailCodes.pendingTokenHash, sha256Hex(input.pendingToken)))
      .for('update');
    if (row === undefined) {
      throw new ApiError('code_expired');
    }
    if (row.expiresAt.getTime() <= now.getTime()) {
      await deleteChallenge(tx, row.id);
      return { refuse: 'code_expired' };
    }
    const email = row.email.toLowerCase();
    if (!safeEqualHex(emailCodeHash(deps.keyRing, email, input.code), row.codeHash)) {
      const [counted] = await tx
        .update(emailCodes)
        .set({ attempts: sql`${emailCodes.attempts} + 1` })
        .where(eq(emailCodes.id, row.id))
        .returning({ attempts: emailCodes.attempts });
      if (counted !== undefined && counted.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        await deleteChallenge(tx, row.id);
        return { refuse: 'code_attempts_exhausted' };
      }
      return { refuse: 'code_invalid' };
    }

    if (intent === 'add_email' && viewer !== null) {
      return {
        done: await addEmail(deps, tx, {
          challengeId: row.id,
          email,
          viewer,
          session: input.session,
          adminEmails,
        }),
      };
    }

    const identity: IdentityInput = {
      provider: 'email',
      subject: email,
      email,
      emailVerified: true,
      emailVerifiedAuthoritative: true,
      isPrivateEmail: null,
    };
    for (let attempt = 1; attempt <= MAX_RESOLUTIONS; attempt += 1) {
      const resolution = await resolveIdentity(tx, identity);
      if (resolution.kind === 'refused') {
        await deleteChallenge(tx, row.id);
        return { refuse: resolution.code };
      }
      if (
        intent === 'reauth' &&
        !(resolution.kind === 'existing' && resolution.userId === viewer?.userId)
      ) {
        // The challenge proved the address, so it is spent; nothing else changes.
        await deleteChallenge(tx, row.id);
        return { refuse: 'reauth_mismatch' };
      }
      if (resolution.kind === 'new') {
        // A refusal here rolls back, leaving the challenge and its attempts for a retry.
        await checkCreationPreconditions(tx, {
          mode: 'full',
          intent,
          signup: input.signup,
          platform: input.platform,
          addrHash: input.addrHash,
          flags,
          now,
        });
      }
      await deleteChallenge(tx, row.id);
      let userId: string;
      let created = false;
      if (resolution.kind === 'existing') {
        await applyExistingIdentity(tx, identity, resolution, {
          clientId: null,
          refreshTokenEnc: null,
          enqueue: enqueueOf(deps),
        });
        userId = resolution.userId;
      } else {
        const made = await createUserWithIdentity(tx, {
          identity,
          signup: input.signup,
          platform: input.platform,
          addrHash: input.addrHash,
          now,
          name: null,
          clientId: null,
          refreshTokenEnc: null,
          method: 'email',
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
        done: {
          userId,
          created,
          session: finished.session,
          keptSession: null,
          promoted: finished.promoted,
        },
      };
    }
    throw new Error('The sign-in lost its race three times.');
  });

  if ('refuse' in outcome) {
    throw new ApiError(outcome.refuse);
  }
  if (outcome.done.promoted) {
    deps.logger.info('auth.admin_bootstrap', { userId: outcome.done.userId });
  }
  return outcome.done;
}
