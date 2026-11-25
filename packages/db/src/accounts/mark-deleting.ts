import { and, eq, ne, sql } from 'drizzle-orm';
import type { Tx } from '../client.ts';
import { sessions, users } from '../schema/accounts.ts';

/** Whether this call marked the user, and how many sessions it ended. */
export type MarkDeletingResult = { marked: boolean; sessionsEnded: number };

/**
 * Marks the user deleting and ends every session, inside the caller's transaction; the caller
 * enqueues account.delete in the same transaction (L-account-deletion). A user already deleting
 * keeps the first request time and `marked` is false.
 */
export async function markAccountDeleting(tx: Tx, userId: string): Promise<MarkDeletingResult> {
  const marked = await tx
    .update(users)
    .set({ status: 'deleting', deletionRequestedAt: sql`now()` })
    .where(and(eq(users.id, userId), ne(users.status, 'deleting')))
    .returning({ id: users.id });
  // Index sessions_user. ws_ticket challenges go with their sessions by the cascade.
  const ended = await tx.delete(sessions).where(eq(sessions.userId, userId));
  return { marked: marked.length > 0, sessionsEnded: ended.rowCount ?? 0 };
}
