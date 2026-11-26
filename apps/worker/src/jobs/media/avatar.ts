import { uploads, users } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import { avatarKeys, uploadIdOfAvatarKey } from '@citizenrun/shared/storage';
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import {
  ObjectTooLargeError,
  deleteKeys,
  getObjectBytes,
  headObject,
  putObject,
} from '../../lib/bucket-ops.ts';
import { PhotoRejected, processPhoto, sha256Of } from '../../lib/media/photo.ts';
import type { PhotoOutput } from '../../lib/media/photo.ts';
import { familyOfContentType, sniffImage } from '../../lib/media/sniff.ts';

// J-media.process for an avatar (CTL-60, CTL-63): re-encode the upload into two squares, make it
// the user's avatar, delete its original and queue the cleanup of the avatar it replaced. No log
// line, error or payload carries a key, a URL or a hash of the bytes.

export type AvatarTarget = { target: 'avatar'; userId: string; uploadId: string };

/** Why an avatar upload was refused for good, or why its last attempt gave up. */
export type AvatarFailReason =
  | 'missing'
  | 'too_large'
  | 'bad_type'
  | 'unsupported_format'
  | 'undecodable'
  | 'too_many_pixels'
  | 'retries_exhausted';

// D-249: derivatives never change under their key.
const DERIVATIVE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DERIVATIVE_CONTENT_TYPE = 'image/jpeg';
// D-248: the photo types an upload may declare.
const PHOTO_CONTENT_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
// The magic numbers of CTL-06 lie in the first 12 bytes.
const SNIFF_BYTES = 12;

type Upload = {
  id: string;
  userId: string;
  key: string;
  purpose: string;
  contentType: string;
  maxBytes: number;
  consumedAt: Date | null;
  objectDeletedAt: Date | null;
};

type Avatar = {
  userId: string;
  upload: Upload;
  keys: { small: string; large: string };
};

/** A failure no retry can fix; the job records it and returns. */
class AvatarRefused extends Error {
  override readonly name = 'AvatarRefused';
  readonly reason: AvatarFailReason;

  constructor(reason: AvatarFailReason) {
    super(reason);
    this.reason = reason;
  }
}

// A newer consumed avatar upload of the user replaces this one (index uploads_user).
async function hasNewerAvatar(db: Db | Tx, userId: string, uploadId: string): Promise<boolean> {
  const rows = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(
      and(
        eq(uploads.userId, userId),
        eq(uploads.purpose, 'avatar'),
        isNotNull(uploads.consumedAt),
        gt(uploads.id, uploadId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function markOriginalDeleted(ctx: JobContext, uploadId: string): Promise<void> {
  await ctx.db
    .update(uploads)
    .set({ objectDeletedAt: ctx.now() })
    .where(and(eq(uploads.id, uploadId), isNull(uploads.objectDeletedAt)));
}

// CTL-63 "Upload original": the original goes once its derivatives are the avatar.
async function deleteOriginal(ctx: JobContext, upload: Upload): Promise<void> {
  await deleteKeys(ctx.storage.media, [upload.key], { signal: ctx.signal });
  await markOriginalDeleted(ctx, upload.id);
}

async function clearPending(ctx: JobContext, avatar: Avatar): Promise<void> {
  await ctx.db
    .update(users)
    .set({ avatarPendingKey: null })
    .where(and(eq(users.id, avatar.userId), eq(users.avatarPendingKey, avatar.keys.small)));
}

// Step 1: the user and the upload, or null when the job has nothing to do.
async function load(ctx: JobContext, payload: AvatarTarget): Promise<Avatar | null> {
  const { userId, uploadId } = payload;
  const [user] = await ctx.db
    .select({
      id: users.id,
      status: users.status,
      avatarKey: users.avatarKey,
      avatarPendingKey: users.avatarPendingKey,
    })
    .from(users)
    .where(eq(users.id, userId));
  const [upload] = await ctx.db
    .select({
      id: uploads.id,
      userId: uploads.userId,
      key: uploads.key,
      purpose: uploads.purpose,
      contentType: uploads.contentType,
      maxBytes: uploads.maxBytes,
      consumedAt: uploads.consumedAt,
      objectDeletedAt: uploads.objectDeletedAt,
    })
    .from(uploads)
    .where(eq(uploads.id, uploadId));
  if (
    user === undefined ||
    upload === undefined ||
    upload.userId !== userId ||
    upload.purpose !== 'avatar'
  ) {
    ctx.log.info('media.skipped', { target: 'avatar', reason: 'not_found' });
    return null;
  }
  // J-account.delete removes everything of an account being deleted.
  if (user.status === 'deleting') {
    return null;
  }
  const avatar: Avatar = { userId, upload, keys: avatarKeys(userId, uploadId) };
  // Already done: only the original's deletion may be left.
  if (user.avatarKey === avatar.keys.small) {
    if (upload.objectDeletedAt === null) {
      await deleteOriginal(ctx, upload);
    }
    return null;
  }
  // Already settled: refused, discarded or deleted. A refusal whose pending-key write failed after
  // the original went is finished here, on its retry.
  if (upload.objectDeletedAt !== null) {
    await clearPending(ctx, avatar);
    return null;
  }
  if (await hasNewerAvatar(ctx.db, userId, uploadId)) {
    await ctx.enqueue('uploads.cleanup', { scope: 'avatar', userId, uploadId });
    ctx.log.info('media.superseded', { target: 'avatar' });
    return null;
  }
  return avatar;
}

// Steps 2 and 3 (D-248, CTL-06): the object's size and type, then its bytes and magic number.
async function readOriginal(ctx: JobContext, upload: Upload): Promise<Uint8Array> {
  const head = await headObject(ctx.storage.media, upload.key, ctx.signal);
  if (head === null) {
    throw new AvatarRefused('missing');
  }
  if (head.size > upload.maxBytes) {
    throw new AvatarRefused('too_large');
  }
  if (head.contentType !== upload.contentType || !PHOTO_CONTENT_TYPES.has(upload.contentType)) {
    throw new AvatarRefused('bad_type');
  }
  let bytes: Uint8Array;
  try {
    bytes = await getObjectBytes(ctx.storage.media, upload.key, upload.maxBytes, ctx.signal);
  } catch (error) {
    if (error instanceof ObjectTooLargeError) {
      throw new AvatarRefused('too_large');
    }
    throw error;
  }
  const declared = familyOfContentType(upload.contentType);
  if (declared === null || sniffImage(bytes.subarray(0, SNIFF_BYTES)) !== declared) {
    throw new AvatarRefused('bad_type');
  }
  return bytes;
}

function outputNamed(outputs: readonly PhotoOutput[], name: PhotoOutput['name']): PhotoOutput {
  const found = outputs.find((output) => output.name === name);
  if (found === undefined) {
    throw new AvatarRefused('undecodable');
  }
  return found;
}

// Step 6: promote the avatar in one transaction, unless the account is now being deleted or a
// newer avatar came in meanwhile; then this upload's objects go to the cleanup job instead.
async function promote(
  ctx: JobContext,
  avatar: Avatar,
  size: number,
  sha256: string,
): Promise<'passed' | 'discarded'> {
  const { userId, upload, keys } = avatar;
  return ctx.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ avatarKey: users.avatarKey, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (
      locked === undefined ||
      locked.status === 'deleting' ||
      (await hasNewerAvatar(tx, userId, upload.id))
    ) {
      await ctx.enqueue(
        'uploads.cleanup',
        { scope: 'avatar', userId, uploadId: upload.id },
        { tx },
      );
      return 'discarded';
    }
    await tx
      .update(users)
      .set({ avatarKey: keys.small, avatarPendingKey: null })
      .where(eq(users.id, userId));
    await tx.update(uploads).set({ bytes: size, sha256 }).where(eq(uploads.id, upload.id));
    const previous = locked.avatarKey;
    const previousUploadId = previous === null ? null : uploadIdOfAvatarKey(previous);
    if (previous !== keys.small && previousUploadId !== null) {
      await ctx.enqueue(
        'uploads.cleanup',
        { scope: 'avatar', userId, uploadId: previousUploadId },
        { tx },
      );
    }
    return 'passed';
  });
}

// Steps 2 to 7.
async function processLoaded(ctx: JobContext, avatar: Avatar): Promise<void> {
  const { upload, keys } = avatar;
  const bytes = await readOriginal(ctx, upload);
  const sha256 = sha256Of(bytes);
  let outputs: readonly PhotoOutput[];
  try {
    outputs = (await processPhoto(bytes, 'avatar')).outputs;
  } catch (error) {
    if (error instanceof PhotoRejected) {
      throw new AvatarRefused(error.reason);
    }
    throw error;
  }
  // A retry overwrites the same keys.
  const written: [string, PhotoOutput][] = [
    [keys.large, outputNamed(outputs, '1080.jpg')],
    [keys.small, outputNamed(outputs, '320.jpg')],
  ];
  for (const [key, output] of written) {
    await putObject(
      ctx.storage.media,
      key,
      output.bytes,
      { contentType: DERIVATIVE_CONTENT_TYPE, cacheControl: DERIVATIVE_CACHE_CONTROL },
      ctx.signal,
    );
  }
  if ((await promote(ctx, avatar, bytes.byteLength, sha256)) === 'discarded') {
    ctx.log.info('media.superseded', { target: 'avatar' });
    return;
  }
  // Only after the commit: a rollback after the delete would fail a good avatar on its retry.
  await deleteOriginal(ctx, upload);
  const latencyMs =
    upload.consumedAt === null ? null : ctx.now().getTime() - upload.consumedAt.getTime();
  ctx.log.info('media.done', { target: 'avatar', latencyMs });
}

// Step 8: the original goes, the pending key is cleared, and the user keeps the previous avatar or
// the default. A bucket error here is retryable and leaves every row as it was.
async function refuse(ctx: JobContext, avatar: Avatar, reason: AvatarFailReason): Promise<void> {
  await deleteOriginal(ctx, avatar.upload);
  await clearPending(ctx, avatar);
  ctx.log.warn('media.failed', { target: 'avatar', reason });
}

// Step 9: the last attempt gives up. Each write is tried on its own, so a bucket that is down does
// not stop the database write; the original is marked deleted only once its delete went through.
async function giveUp(ctx: JobContext, avatar: Avatar): Promise<void> {
  try {
    await deleteOriginal(ctx, avatar.upload);
  } catch {
    // The job goes to ops.dead, which alerts.
  }
  try {
    await clearPending(ctx, avatar);
  } catch {
    // As above.
  }
  ctx.log.warn('media.failed', { target: 'avatar', reason: 'retries_exhausted' });
}

/** J-media.process for one avatar upload. */
export async function processAvatar(payload: AvatarTarget, ctx: JobContext): Promise<void> {
  const avatar = await load(ctx, payload);
  if (avatar === null) {
    return;
  }
  try {
    try {
      await processLoaded(ctx, avatar);
    } catch (error) {
      if (error instanceof AvatarRefused) {
        await refuse(ctx, avatar, error.reason);
        return;
      }
      throw error;
    }
  } catch (error) {
    if (ctx.job.isFinalAttempt) {
      await giveUp(ctx, avatar);
    }
    throw error;
  }
}
