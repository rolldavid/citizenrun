import { setTimeout as sleep } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Pool, PoolConfig } from 'pg';

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The database did not answer within the wait window (D-140). Holds no connection detail. */
export class DatabaseUnavailableError extends Error {
  override readonly name = 'DatabaseUnavailableError';

  constructor() {
    super('The database did not answer within the wait window.');
  }
}

const DEFAULT_POOL_MAX = 10;
const DEFAULT_APPLICATION_NAME = 'os';
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_WAIT_INTERVAL_MS = 1_000;

/**
 * A `pg` pool on `databaseUrl`: at most `max` clients (default 10), `application_name` (default
 * `os`), a `statement_timeout` when `statementTimeoutMs` is given. An idle client's error goes to
 * `onError` (default: ignored), so it never crashes the process. Opens no connection itself.
 */
export function createPool(
  databaseUrl: string,
  options: {
    max?: number;
    statementTimeoutMs?: number;
    applicationName?: string;
    onError?: (error: Error) => void;
  } = {},
): Pool {
  const config: PoolConfig = {
    connectionString: databaseUrl,
    max: options.max ?? DEFAULT_POOL_MAX,
    application_name: options.applicationName ?? DEFAULT_APPLICATION_NAME,
  };
  if (options.statementTimeoutMs !== undefined) {
    config.options = `-c statement_timeout=${String(options.statementTimeoutMs)}`;
  }
  const pool = new pg.Pool(config);
  const onError = options.onError ?? ((): void => undefined);
  pool.on('error', (error) => {
    onError(error);
  });
  return pool;
}

/**
 * Runs `select 1` every `intervalMs` (default 1,000) until it succeeds; throws
 * DatabaseUnavailableError once `timeoutMs` (default 30,000) has passed without an answer.
 */
export async function waitForDatabase(
  pool: Pool,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      // The error text can name the host or the user; it is dropped, and the wait goes on.
    }
    if (Date.now() + intervalMs > deadline) {
      throw new DatabaseUnavailableError();
    }
    await sleep(intervalMs);
  }
}

/** A Drizzle database over `pool` with the `pg` driver and no relational schema (D-235). */
export function createDb(pool: Pool): Db {
  return drizzle({ client: pool });
}
