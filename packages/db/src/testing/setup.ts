import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { KEEP_TABLES } from './keep-tables.ts';
import { captureLogs } from './logs.ts';
import { clearScanRegistrations, scanForLeaks } from './scan.ts';
import { resetSequence } from './sequence.ts';
import { closeStorage } from './storage.ts';
import { closeWorker, createTestBoss, ensureWorkerDatabase, getTestDb } from './worker.ts';

// The per-file setup of the database harness (TEST-harness-db).

let resetBoss: PgBoss | null = null;

/**
 * Empties this worker's database before a test: truncates every application table of schema
 * `public` not in KEEP_TABLES (extension tables such as PostGIS's `spatial_ref_sys` are not
 * application tables), deletes every pg-boss job, restarts the factory sequence, clears the log
 * capture and forgets the registered scan values and sources.
 */
export async function resetDb(): Promise<void> {
  const db = getTestDb();
  const tables = await db.execute<{ name: string }>(
    sql`select c.relname as name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and not c.relispartition
          and not exists (
            select 1 from pg_depend d
            where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
          )
        order by c.relname`,
    'objects',
  );
  const keep = new Set(KEEP_TABLES);
  const truncated = tables.map((table) => table.name).filter((name) => !keep.has(name));
  if (truncated.length > 0) {
    const list = sql.join(
      truncated.map((name) => sql`${sql.identifier('public')}.${sql.identifier(name)}`),
      sql`, `,
    );
    await db.execute(sql`truncate ${list} restart identity cascade`);
  }
  resetBoss ??= await createTestBoss();
  // The privacy scan of the previous test has already read these rows (TEST-harness-db).
  await resetBoss.deleteAllJobs();
  resetSequence();
  captureLogs().clear();
  clearScanRegistrations();
}

beforeAll(async () => {
  await ensureWorkerDatabase();
});

beforeEach(async () => {
  await resetDb();
});

afterEach(async () => {
  await scanForLeaks(getTestDb());
});

afterAll(async () => {
  resetBoss = null;
  closeStorage();
  await closeWorker();
});
