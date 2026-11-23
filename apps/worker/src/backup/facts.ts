import pg from 'pg';

/** What the manifest records about the database a dump was taken from. */
export type DatabaseFacts = {
  readonly serverVersion: string;
  readonly migrationHead: { readonly hash: string; readonly createdAt: number } | null;
  readonly tableEstimates: Readonly<Record<string, number>>;
};

const UNDEFINED_TABLE = '42P01';

function isUndefinedTable(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === UNDEFINED_TABLE
  );
}

/**
 * Reads the server version, the newest applied migration (null when the migrations table does not
 * exist) and the planner's live-row estimates per table, on one connection that is always closed.
 */
export async function readDatabaseFacts(databaseUrl: string): Promise<DatabaseFacts> {
  const client = new pg.Client({ connectionString: databaseUrl, application_name: 'backup' });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const version = await client.query<{ version: string }>('select version() as version');
    const serverVersion = version.rows[0]?.version ?? '';

    let migrationHead: DatabaseFacts['migrationHead'] = null;
    try {
      const head = await client.query<{ hash: string; created_at: string }>(
        'select hash, created_at from drizzle.__drizzle_migrations order by created_at desc, id desc limit 1',
      );
      const row = head.rows[0];
      if (row !== undefined) {
        migrationHead = { hash: row.hash, createdAt: Number(row.created_at) };
      }
    } catch (error) {
      if (!isUndefinedTable(error)) {
        throw error;
      }
    }

    const stats = await client.query<{ schemaname: string; relname: string; n_live_tup: string }>(
      'select schemaname, relname, n_live_tup from pg_stat_user_tables order by schemaname, relname',
    );
    const tableEstimates: Record<string, number> = {};
    for (const row of stats.rows) {
      const key = row.schemaname === 'public' ? row.relname : `${row.schemaname}.${row.relname}`;
      tableEstimates[key] = Number(row.n_live_tup);
    }
    return { serverVersion, migrationHead, tableEstimates };
  } finally {
    // A connection that never opened has nothing to close.
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }
}
