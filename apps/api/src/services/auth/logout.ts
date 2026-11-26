import type { Db } from '@citizenrun/db';
import { deleteSession } from './sessions.ts';

/**
 * E-AUTH-09, L-session End one: with a session id, deletes that one session in one transaction;
 * with null, does nothing. The session's other rows go with it by cascade.
 */
export async function logout(db: Db, sessionId: string | null): Promise<void> {
  if (sessionId === null) {
    return;
  }
  await db.transaction(async (tx) => {
    await deleteSession(tx, sessionId);
  });
}
