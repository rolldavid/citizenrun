import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@citizenrun/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { PgBoss } from 'pg-boss';

/** The runner could not connect within its window. Holds no connection detail. */
export class MigrationConnectError extends Error {
  override readonly name = 'MigrationConnectError';

  constructor() {
    super('The migration runner could not connect to the database within its window.');
  }
}

// Right both from src/ and from the bundled dist/migrate.js: each sits one level below the package.
const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000; // D-141
const CONNECT_RETRY_MS = 1_000;

// No statement limit for the runner; a lock wait gives up after 5 seconds (R-153).
const SESSION_OPTIONS = '-c statement_timeout=0 -c lock_timeout=5s';
const APPLICATION_NAME = 'os-migrate';

// Runners of every version contend for this one key: the string never changes.
const LOCK_SQL = "select pg_advisory_lock(hashtext('os_migrate'))";
const UNLOCK_SQL = "select pg_advisory_unlock(hashtext('os_migrate'))";

const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

const NO_LOGGER: Pick<Logger, 'info'> = { info: () => undefined };

async function connectWithRetry(databaseUrl: string, connectTimeoutMs: number): Promise<pg.Client> {
  const deadline = Date.now() + connectTimeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    const client = new pg.Client({
      connectionString: databaseUrl,
      application_name: APPLICATION_NAME,
      options: SESSION_OPTIONS,
      connectionTimeoutMillis: Math.max(CONNECT_RETRY_MS, remaining),
    });
    // A connection lost while idle emits `error`; without a listener it would crash the process.
    // The query that follows fails on its own and ends the run.
    client.on('error', () => undefined);
    try {
      await client.connect();
      return client;
    } catch {
      // The error text can name the host or the user; it is dropped.
      await client.end().catch(() => undefined);
    }
    if (Date.now() + CONNECT_RETRY_MS > deadline) {
      throw new MigrationConnectError();
    }
    await sleep(CONNECT_RETRY_MS);
  }
}

async function countApplied(client: pg.Client): Promise<number> {
  const exists = await client.query<{ present: boolean }>(
    'select to_regclass($1) is not null as present',
    [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
  );
  if (exists.rows[0]?.present !== true) {
    return 0;
  }
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return result.rows[0]?.n ?? 0;
}

async function applyPgBossSchema(client: pg.Client): Promise<void> {
  const emitted: { error: Error | null } = { error: null };
  const boss = new PgBoss({
    db: { executeSql: (text, values) => client.query(text, values) },
    supervise: false,
    schedule: false,
    migrate: true,
  });
  // An unhandled `error` event would crash the process; it is kept and rethrown after the stop.
  boss.on('error', (error) => {
    emitted.error ??= error;
  });
  try {
    await boss.start();
  } finally {
    // Nothing left running and the shared client left open: the runner ends it.
    await boss.stop({ graceful: false, close: false });
  }
  if (emitted.error !== null) {
    throw emitted.error;
  }
}

/**
 * Applies every pending migration in `migrationsFolder` to `databaseUrl`, then pg-boss's schema,
 * under the advisory lock `hashtext('os_migrate')` (D-141, R-153). Retries the first connection
 * for `connectTimeoutMs` (default 30,000) before throwing MigrationConnectError. Resolves with the
 * number of migrations this run applied, 0 when there was nothing to do. Never logs the URL or SQL.
 */
export async function runMigrations(
  databaseUrl: string,
  options: { migrationsFolder?: string; connectTimeoutMs?: number; logger?: Logger } = {},
): Promise<{ applied: number }> {
  const startedAt = Date.now();
  const migrationsFolder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const logger = options.logger ?? NO_LOGGER;
  const client = await connectWithRetry(
    databaseUrl,
    options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  );
  try {
    const statement = await client.query<{ statement_timeout: string }>('show statement_timeout');
    const lock = await client.query<{ lock_timeout: string }>('show lock_timeout');
    logger.info('migrate.start', {
      statementTimeout: statement.rows[0]?.statement_timeout ?? null,
      lockTimeout: lock.rows[0]?.lock_timeout ?? null,
    });

    // lock_timeout also bounds an advisory lock wait, so a second runner would fail after 5 seconds
    // (SQLSTATE 55P03) instead of waiting for the first. The wait is exempt; RESET restores the
    // session's 5 seconds for the migrations themselves.
    await client.query('set lock_timeout = 0');
    await client.query(LOCK_SQL);
    await client.query('reset lock_timeout');
    logger.info('migrate.locked');

    const before = await countApplied(client);
    await migrate(drizzle({ client }), {
      migrationsFolder,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });
    const applied = (await countApplied(client)) - before;

    await applyPgBossSchema(client);

    await client.query(UNLOCK_SQL);
    logger.info('migrate.done', { applied, durationMs: Date.now() - startedAt });
    return { applied };
  } finally {
    // Ending the session also releases the lock when a step above failed.
    await client.end().catch(() => undefined);
  }
}
