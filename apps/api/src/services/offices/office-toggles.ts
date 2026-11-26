import { bookmarks, follows } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import { ApiError } from '@citizenrun/shared';
import type { OfficeBookmarkState, OfficeFollowState } from '@citizenrun/shared';
import { and, eq } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import { checkDailyLimit } from '../limits/daily-limits.ts';
import { resolveOfficeById } from './resolve-office.ts';

// E-OFF-04 to E-OFF-07: follow and bookmark, idempotent by primary key. No
// notification and no job. Rows carry the request's `now`, the clock the daily count reads.

/** The follower and the account age the follow limit reads. */
export type ToggleViewer = { userId: string; createdAt: Date };

/** A new follow, bookmark or report needs an office that exists (404) and is not retired (422). */
export async function liveOffice(tx: Db | Tx, officeId: string): Promise<void> {
  const office = await resolveOfficeById(tx, officeId);
  if (office === null) {
    throw new ApiError('not_found');
  }
  if (office.retiredAt !== null) {
    throw new ApiError('office_retired');
  }
}

/** E-OFF-04: follows the office; a follow that exists answers without counting. */
export function followOffice(
  deps: Deps,
  input: { viewer: ToggleViewer; officeId: string; now: Date },
): Promise<OfficeFollowState> {
  const { viewer, officeId, now } = input;
  return deps.db.transaction(async (tx) => {
    await liveOffice(tx, officeId);
    // index: follows_pkey
    const [existing] = await tx
      .select({ followerId: follows.followerId })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, viewer.userId),
          eq(follows.targetType, 'office'),
          eq(follows.targetId, officeId),
        ),
      );
    if (existing !== undefined) {
      return { following: true };
    }
    const allowed = await checkDailyLimit(tx, 'follows', viewer, now);
    if (!allowed.ok) {
      throw new ApiError('daily_limit_reached', { retryAfterSeconds: allowed.retryAfterSeconds });
    }
    await tx
      .insert(follows)
      .values({
        followerId: viewer.userId,
        targetType: 'office',
        targetId: officeId,
        createdAt: now,
      })
      .onConflictDoNothing();
    return { following: true };
  });
}

/** E-OFF-05: removes the follow; an unknown or retired office answers the same. */
export async function unfollowOffice(
  deps: Deps,
  input: { userId: string; officeId: string },
): Promise<OfficeFollowState> {
  // index: follows_pkey
  await deps.db
    .delete(follows)
    .where(
      and(
        eq(follows.followerId, input.userId),
        eq(follows.targetType, 'office'),
        eq(follows.targetId, input.officeId),
      ),
    );
  return { following: false };
}

/** E-OFF-06: saves the office for the viewer alone (INV-06); no daily limit applies. */
export function bookmarkOffice(
  deps: Deps,
  input: { userId: string; officeId: string; now: Date },
): Promise<OfficeBookmarkState> {
  return deps.db.transaction(async (tx) => {
    await liveOffice(tx, input.officeId);
    // index: bookmarks_pkey
    await tx
      .insert(bookmarks)
      .values({ userId: input.userId, officeId: input.officeId, createdAt: input.now })
      .onConflictDoNothing();
    return { bookmarked: true };
  });
}

/** E-OFF-07: removes the bookmark; a missing row answers the same. */
export async function unbookmarkOffice(
  deps: Deps,
  input: { userId: string; officeId: string },
): Promise<OfficeBookmarkState> {
  // index: bookmarks_pkey
  await deps.db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, input.userId), eq(bookmarks.officeId, input.officeId)));
  return { bookmarked: false };
}
