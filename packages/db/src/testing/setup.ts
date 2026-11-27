import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { KEEP_TABLES } from './keep-tables.ts';
import { captureLogs } from './logs.ts';
import { clearScanRegistrations, scanForLeaks } from './scan.ts';
import { resetDistrictOrdinal, resetSequence } from './sequence.ts';
import { closeStorage } from './storage.ts';
import {
  KEPT_ROWS_SCHEMA,
  closeWorker,
  createTestBoss,
  ensureWorkerDatabase,
  getTestDb,
} from './worker.ts';
import type { Db } from '../client.ts';

// The per-file setup of the database harness (TEST-harness-db).

let resetBoss: PgBoss | null = null;

/** The migration's `state_rules` rows, read once per file: every column as JSON, and the codes. */
type KeptStateRules = { rows: string; states: readonly string[] };

let keptStateRules: KeptStateRules | null = null;

async function readKeptStateRules(db: Db): Promise<KeptStateRules> {
  const kept = sql.identifier(KEPT_ROWS_SCHEMA);
  const [found] = await db.execute<{ rows: string; states: string[] }>(
    sql`select coalesce(jsonb_agg(k order by k.state), '[]'::jsonb)::text as rows,
               coalesce(array_agg(k.state::text order by k.state), '{}') as states
        from ${kept}.state_rules k`,
    'objects',
  );
  if (found === undefined || found.states.length === 0) {
    throw new Error('The clone holds no kept state_rules rows.');
  }
  return { rows: found.rows, states: found.states };
}

// Puts `state_rules` back to the migration's rows, every column, deletes every other row (a
// truncate of `users` cascades into it through `updated_by`), then adds the fixture state `ZZ`
// with the column defaults (TEST-harness-db). No rule value is written here.
async function restoreStateRules(db: Db): Promise<void> {
  keptStateRules ??= await readKeptStateRules(db);
  const { rows, states } = keptStateRules;
  await db.execute(
    sql`insert into state_rules
          (state, signup, age_method, candidate_tools, updated_by, updated_at, created_at)
        select state, signup, age_method, candidate_tools, updated_by, updated_at, created_at
        from jsonb_populate_recordset(null::state_rules, ${rows}::jsonb)
        on conflict (state) do update set
          signup = excluded.signup,
          age_method = excluded.age_method,
          candidate_tools = excluded.candidate_tools,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at,
          created_at = excluded.created_at`,
  );
  await db.execute(
    sql`delete from state_rules where state::text <> all(${sql.param(states)}::text[])`,
  );
  await db.execute(sql`insert into state_rules (state) values ('ZZ')`);
}

/**
 * Empties this worker's database before a test: truncates, restarting its identity, every
 * application table of schema `public` not in KEEP_TABLES that holds a row or whose identity has
 * advanced (extension tables such as PostGIS's `spatial_ref_sys` are not application tables),
 * deletes every pg-boss job, restarts the factory sequence and the district ordinal of the
 * fixture geometry, clears the log capture, forgets the registered scan values and sources, and
 * restores `state_rules` to the migration's rows plus the fixture state `ZZ`.
 */
export async function resetDb(): Promise<void> {
  const db = getTestDb();
  const tables = await db.execute<{ name: string; sequenceUsed: boolean }>(
    sql`select c.relname as name,
               exists (
                 select 1 from pg_depend d
                 join pg_class s on s.oid = d.objid
                 where d.classid = 'pg_class'::regclass and d.refobjid = c.oid
                   and d.deptype in ('a', 'i')
                   and case when s.relkind = 'S' then pg_sequence_last_value(s.oid) end is not null
               ) as "sequenceUsed"
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
  const candidates = tables.filter((table) => !keep.has(table.name));
  // A truncate gives every table, index and sequence it names a new file, which the next
  // checkpoint must sync, and every DROP DATABASE waits for an immediate checkpoint. Only a table
  // that holds a row or whose identity has advanced is truncated; the rest are already as a
  // truncate would leave them.
  const unknown = candidates.filter((table) => !table.sequenceUsed);
  const holding =
    unknown.length === 0
      ? []
      : await db.execute<{ name: string }>(
          sql.join(
            unknown.map(
              (table) =>
                sql`select ${table.name}::text as name where exists (select 1 from ${sql.identifier('public')}.${sql.identifier(table.name)})`,
            ),
            sql` union all `,
          ),
          'objects',
        );
  const holdingNames = new Set(holding.map((row) => row.name));
  const truncated = candidates
    .filter((table) => table.sequenceUsed || holdingNames.has(table.name))
    .map((table) => table.name);
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
  resetDistrictOrdinal();
  captureLogs().clear();
  clearScanRegistrations();
  await restoreStateRules(db);
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
