import { uploads, users } from '@citizenrun/db';
import { avatarUploadPrefix } from '@citizenrun/shared/storage';
import { and, eq, isNull } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import { deleteKeys, deletePrefix } from '../../lib/bucket-ops.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';

// R-028: one of the few jobs allowed to delete media. Deleting a missing object succeeds and rows
// are only marked, so a repeated job is harmless.

async function cleanAvatar(
  payload: { scope: 'avatar'; userId: string; uploadId: string },
  ctx: JobContext,
): Promise<void> {
  const { userId, uploadId } = payload;
  const prefix = avatarUploadPrefix(userId, uploadId);

  // A stale job for an avatar that is current, or pending, again deletes nothing.
  const [user] = await ctx.db
    .select({ avatarKey: users.avatarKey, avatarPendingKey: users.avatarPendingKey })
    .from(users)
    .where(eq(users.id, userId));
  if (
    user !== undefined &&
    (user.avatarKey?.startsWith(prefix) === true ||
      user.avatarPendingKey?.startsWith(prefix) === true)
  ) {
    ctx.log.info('uploads.cleanup.in_use', { scope: 'avatar' });
    return;
  }

  let objects = await deletePrefix(ctx.storage.media, prefix, { signal: ctx.signal });
  const [upload] = await ctx.db
    .select({ key: uploads.key, objectDeletedAt: uploads.objectDeletedAt })
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.userId, userId)));
  if (upload !== undefined && upload.objectDeletedAt === null) {
    objects += await deleteKeys(ctx.storage.media, [upload.key], { signal: ctx.signal });
    await ctx.db
      .update(uploads)
      .set({ objectDeletedAt: ctx.now() })
      .where(and(eq(uploads.id, uploadId), isNull(uploads.objectDeletedAt)));
  }
  ctx.log.info('uploads.cleanup.done', { scope: 'avatar', objects });
}

/**
 * J-uploads.cleanup: deletes the objects of an upload that is no longer in use, with its original,
 * and marks the original deleted. Milestone 1 has the `avatar` scope only.
 */
export const uploadsCleanup: JobDefinition<'uploads.cleanup'> = {
  name: 'uploads.cleanup',
  queue: QUEUE_OPTIONS['uploads.cleanup'].queue,
  work: QUEUE_OPTIONS['uploads.cleanup'].work,
  async handle(payload, ctx) {
    // One scope so far, so there is nothing to switch on: a second member of the payload union
    // makes this call fail to compile until the handler switches on `payload.scope`.
    return cleanAvatar(payload, ctx);
  },
};
