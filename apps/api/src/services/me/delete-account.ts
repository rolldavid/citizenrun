import { markAccountDeleting, users } from '@citizenrun/db';
import type { Enqueue, Tx } from '@citizenrun/db';
import { ApiError, DELETION_COMPLETES_MS } from '@citizenrun/shared';
import type { AccountDeletionView } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import { enqueueOf } from '../../deps.ts';

/**
 * The request's part of L-account-deletion inside the caller's transaction: marks the user
 * deleting, ends every session and enqueues account.delete in the same transaction, then reads
 * the request time. `skipDeferral` is true only for an under-13 account (D-492).
 */
export async function startAccountDeletion(
  tx: Tx,
  enqueue: Enqueue,
  input: { userId: string; skipDeferral: boolean },
): Promise<AccountDeletionView> {
  const { userId, skipDeferral } = input;
  await markAccountDeleting(tx, userId);
  await enqueue('account.delete', { userId, skipDeferral }, { tx });
  const [row] = await tx
    .select({ deletionRequestedAt: users.deletionRequestedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (row?.deletionRequestedAt === null || row?.deletionRequestedAt === undefined) {
    // The user row is gone: the session that made this request no longer stands for anyone.
    throw new ApiError('unauthenticated');
  }
  const deletionRequestedAt = row.deletionRequestedAt;
  return {
    deletionRequestedAt: deletionRequestedAt.toISOString(),
    completesBy: new Date(deletionRequestedAt.getTime() + DELETION_COMPLETES_MS).toISOString(),
  };
}

/**
 * E-ME-03: marks the account deleting, ends every session and enqueues account.delete, in one
 * transaction. Answers when the deletion was asked for and when it completes (24 hours later).
 */
export async function requestAccountDeletion(
  deps: Deps,
  input: { userId: string; now: Date },
): Promise<AccountDeletionView> {
  const enqueue = enqueueOf(deps);
  return deps.db.transaction((tx) =>
    startAccountDeletion(tx, enqueue, { userId: input.userId, skipDeferral: false }),
  );
}
