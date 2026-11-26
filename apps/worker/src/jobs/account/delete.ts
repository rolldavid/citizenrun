import {
  appEvents,
  authIdentities,
  emailCodes,
  follows,
  rateLimits,
  reservedHandles,
  users,
} from '@citizenrun/db';
import { BRAND, HANDLE_HOLD_DAYS, createI18n } from '@citizenrun/shared';
import { decryptRefreshToken, keyedHash } from '@citizenrun/shared/crypto';
import { avatarUserPrefix, exportUserPrefix, incomingUserPrefix } from '@citizenrun/shared/storage';
import { and, eq, gte, lt } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import { deletePrefix } from '../../lib/bucket-ops.ts';
import { renderEmail, toEmailMessage } from '../../lib/email/render.ts';
import type { EmailContacts, NotificationsT } from '../../lib/email/render.ts';
import { writeReplayEntry } from '../../lib/replay.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import { PermanentJobError, RetryableJobError, errorClassOf } from '../types.ts';
import type { JobDefinition } from '../types.ts';
import { appleRevokeConfig, revokeAppleToken } from './apple-revoke.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The user's three prefixes in the `media` bucket that deletion empties. */
export function userMediaPrefixes(userId: string): readonly string[] {
  // L-object-keys: incoming/<user id>/, avatars/<user id>/ and exports/<user id>/.
  return [incomingUserPrefix(userId), avatarUserPrefix(userId), exportUserPrefix(userId)];
}

// One instance per process, made on first use: importing this file starts nothing.
let i18n: ReturnType<typeof createI18n> | null = null;

// The notifications text in the recipient's locale; a locale with no catalog falls back to English.
function translatorFor(locale: string): NotificationsT {
  i18n ??= createI18n({ lng: 'en' });
  return i18n.getFixedT(locale);
}

// The brand's public contacts; each is null until the brand file holds it.
function brandContacts(): EmailContacts {
  return {
    supportEmail: BRAND.contacts.supportEmail,
    postalAddress: BRAND.contacts.postalAddress,
  };
}

// Keeps the job alive between steps and stops it at shutdown, so the next worker retries it.
async function checkpoint(ctx: JobContext): Promise<void> {
  await ctx.touch();
  if (ctx.signal.aborted) {
    throw new RetryableJobError('shutdown');
  }
}

type DeletingUser = {
  email: string | null;
  emailStatus: string;
  handle: string | null;
  locale: string;
};

// Step 0: the user's row when it is being deleted; null (after logging why) otherwise.
async function loadDeletingUser(ctx: JobContext, userId: string): Promise<DeletingUser | null> {
  const [user] = await ctx.db
    .select({
      id: users.id,
      status: users.status,
      email: users.email,
      emailStatus: users.emailStatus,
      handle: users.handle,
      locale: users.locale,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (user === undefined) {
    ctx.log.info('account.delete.skipped', { reason: 'gone' });
    return null;
  }
  if (user.status !== 'deleting') {
    ctx.log.info('account.delete.skipped', { reason: 'not_deleting' });
    return null;
  }
  return {
    email: user.email,
    emailStatus: user.emailStatus,
    handle: user.handle,
    locale: user.locale,
  };
}

// Step 1 (D-242): revokes each Apple refresh token. A throw leaves the user and identities as
// they are, so the retry revokes again.
async function revokeApple(
  ctx: JobContext,
  userId: string,
): Promise<{ appleRevoked: number; appleNotPossible: number }> {
  // index: auth_identities_user
  const rows = await ctx.db
    .select({
      subject: authIdentities.subject,
      refreshTokenEnc: authIdentities.refreshTokenEnc,
      clientId: authIdentities.clientId,
    })
    .from(authIdentities)
    .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, 'apple')));
  const config = appleRevokeConfig(ctx.env);
  let appleRevoked = 0;
  let appleNotPossible = 0;
  for (const row of rows) {
    if (config === null) {
      // OI-apple-identifiers: no Apple sign-in exists without the variables, so no call is made.
      ctx.log.info('apple.revoke_not_possible', { reason: 'not_configured' });
      appleNotPossible += 1;
      continue;
    }
    if (row.refreshTokenEnc === null || row.clientId === null) {
      ctx.log.info('apple.revoke_not_possible', { reason: 'no_token' });
      appleNotPossible += 1;
      continue;
    }
    let refreshToken: string;
    try {
      refreshToken = decryptRefreshToken(ctx.keys, row.refreshTokenEnc, row.subject);
    } catch {
      // A blob that cannot be read now never can be.
      ctx.log.warn('apple.revoke_not_possible', { reason: 'decrypt_failed' });
      appleNotPossible += 1;
      continue;
    }
    const outcome = await revokeAppleToken(ctx.outbound, {
      config,
      clientId: row.clientId,
      refreshToken,
      now: ctx.now(),
      signal: ctx.signal,
    });
    if (outcome === 'revoked') {
      ctx.log.info('apple.revoked');
      appleRevoked += 1;
    } else {
      ctx.log.info('apple.revoke_not_possible', { reason: 'rejected' });
      appleNotPossible += 1;
    }
    await ctx.touch();
  }
  return { appleRevoked, appleNotPossible };
}

// Step 4: the rows no foreign key reaches, in one transaction.
async function deleteUnreferencedRows(
  ctx: JobContext,
  userId: string,
  email: string | null,
): Promise<{ emailCodes: number; appEvents: number; rateLimits: number; followsOfUser: number }> {
  return ctx.db.transaction(async (tx) => {
    // index: email_codes_email
    const codes =
      email === null ? null : await tx.delete(emailCodes).where(eq(emailCodes.email, email));
    // index: app_events_user, on every partition
    const events = await tx.delete(appEvents).where(eq(appEvents.userId, userId));
    // The primary key's range of `u:<id>:` under collate "C": ';' is the byte after ':'.
    const limits = await tx
      .delete(rateLimits)
      .where(and(gte(rateLimits.key, `u:${userId}:`), lt(rateLimits.key, `u:${userId};`)));
    // index: follows_target. `target_id` has no foreign key, so other users' follows of this
    // user would outlive the cascade.
    const followers = await tx
      .delete(follows)
      .where(and(eq(follows.targetType, 'user'), eq(follows.targetId, userId)));
    return {
      emailCodes: codes?.rowCount ?? 0,
      appEvents: events.rowCount ?? 0,
      rateLimits: limits.rowCount ?? 0,
      followsOfUser: followers.rowCount ?? 0,
    };
  });
}

// Step 6: every object under the user's prefixes in `media`.
async function deleteObjects(ctx: JobContext, userId: string): Promise<number> {
  let objects = 0;
  for (const prefix of userMediaPrefixes(userId)) {
    objects += await deletePrefix(ctx.storage.media, prefix, {
      signal: ctx.signal,
      afterBatch: () => ctx.touch(),
    });
  }
  return objects;
}

// Step 7: holds the handle for HANDLE_HOLD_DAYS by its keyed hash.
async function reserveHandle(ctx: JobContext, handle: string | null): Promise<number> {
  if (handle === null) {
    return 0;
  }
  const reserved = await ctx.db
    .insert(reservedHandles)
    .values({
      handleHash: keyedHash(ctx.keys, { kind: 'handle', handle: handle.toLowerCase() }),
      reason: 'deleted',
      reservedUntil: new Date(ctx.now().getTime() + HANDLE_HOLD_DAYS * DAY_MS),
    })
    .onConflictDoNothing({ target: reservedHandles.handleHash })
    .returning({ handleHash: reservedHandles.handleHash });
  return reserved.length;
}

// Step 8, after the replay entry: the confirmation to the former address (D-351). No cap counter
// is written: the user's `u:` keys are already gone and the user goes next.
async function sendConfirmation(ctx: JobContext, user: DeletingUser): Promise<void> {
  if (user.email === null || user.emailStatus !== 'ok') {
    return;
  }
  const contacts = brandContacts();
  const rendered = renderEmail(
    'account_deleted',
    { locale: user.locale, contacts },
    translatorFor(user.locale),
  );
  try {
    await ctx.mailer.sendEmail(
      toEmailMessage(rendered, { to: user.email, jobId: ctx.job.id, contacts }),
    );
  } catch (error) {
    if (error instanceof PermanentJobError) {
      // A refused confirmation never keeps an account.
      ctx.log.error('email.failed', {
        template: 'account_deleted',
        errorClass: errorClassOf(error),
      });
      return;
    }
    throw error;
  }
}

/**
 * J-account.delete: deletes a user marked `deleting` so that no row and no object of theirs is
 * left (L-account-deletion). Revokes Apple refresh tokens first, deletes the rows no foreign key
 * reaches and the user's objects, reserves the handle, writes the replay entry, sends the
 * confirmation and deletes the user last, so a failure anywhere leaves a `deleting` account the
 * retry finishes. Logs counts only, never an id, address or handle.
 */
export const accountDelete: JobDefinition<'account.delete'> = {
  name: 'account.delete',
  queue: QUEUE_OPTIONS['account.delete'].queue,
  work: QUEUE_OPTIONS['account.delete'].work,
  async handle(payload, ctx) {
    // `skipDeferral` is read by the deferral step, whose tables arrive later (D-492).
    const { userId } = payload;
    const user = await loadDeletingUser(ctx, userId);
    if (user === null) {
      return;
    }
    await checkpoint(ctx);

    const apple = await revokeApple(ctx, userId);
    await checkpoint(ctx);

    const rows = await deleteUnreferencedRows(ctx, userId, user.email);
    await checkpoint(ctx);

    const objects = await deleteObjects(ctx, userId);
    await checkpoint(ctx);

    const handleReserved = await reserveHandle(ctx, user.handle);
    await checkpoint(ctx);

    // INV-50: `at` is the job's creation time, so a retry writes the same key and bytes.
    await writeReplayEntry(ctx.storage.backups, 'replay/deletions', ctx.job.id, {
      v: 1,
      kind: 'account_deleted',
      userHash: keyedHash(ctx.keys, { kind: 'user', userId }),
      at: ctx.job.createdOn.toISOString(),
    });
    await sendConfirmation(ctx, user);
    await checkpoint(ctx);

    await ctx.db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, userId));
    });

    ctx.log.info('account.deleted', {
      appleRevoked: apple.appleRevoked,
      appleNotPossible: apple.appleNotPossible,
      emailCodes: rows.emailCodes,
      appEvents: rows.appEvents,
      rateLimits: rows.rateLimits,
      followsOfUser: rows.followsOfUser,
      objects,
      handleReserved,
    });
  },
};
