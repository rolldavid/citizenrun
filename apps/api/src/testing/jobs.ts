import type { Db } from '@citizenrun/db';
import type { JobName } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';

/** Every job of the queue `name` in the test database, oldest first, whatever its state. */
export async function queuedJobs(
  db: Db,
  name: JobName,
): Promise<{ id: string; data: unknown; singletonKey: string | null }[]> {
  const rows = await db.execute<{ id: string; data: unknown; singleton_key: string | null }>(
    sql`select id::text as id, data, singleton_key from pgboss.job
        where name = ${name}
        order by created_on, id`,
    'objects',
  );
  return rows.map((row) => ({ id: row.id, data: row.data, singletonKey: row.singleton_key }));
}
