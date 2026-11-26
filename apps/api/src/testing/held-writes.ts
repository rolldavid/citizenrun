import { getTestDb } from '@citizenrun/db/testing';
import { sql } from 'drizzle-orm';

// Waits at most 200 rounds of 10 ms for the requests to reach the held lock.
const ROUNDS = 200;
const ROUND_MS = 10;

/** The statements of this worker's database that wait on a lock. */
async function lockWaiters(): Promise<number> {
  const rows = await getTestDb().execute<{ count: number }>(
    sql`select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    'objects',
  );
  return rows[0]?.count ?? 0;
}

/**
 * Sends the requests of `send` while a transaction of its own holds back every write to `table`
 * (reads go on), and lets the writes go once `waiters` statements wait on a lock, so requests sent
 * at once meet at their first write whatever the timing. Answers the requests' results in order.
 * Uses the harness pool, not the test app's, so the held transaction never takes a request's
 * connection.
 */
export async function withWritesHeld<T>(
  table: 'data_exports' | 'uploads' | 'email_codes' | 'auth_challenges',
  waiters: number,
  send: () => Promise<T>[],
): Promise<T[]> {
  let sent: Promise<T>[] = [];
  await getTestDb().transaction(async (tx) => {
    await tx.execute(sql`lock table ${sql.identifier(table)} in share row exclusive mode`);
    sent = send();
    for (let round = 0; round < ROUNDS && (await lockWaiters()) < waiters; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, ROUND_MS));
    }
  });
  return Promise.all(sent);
}
