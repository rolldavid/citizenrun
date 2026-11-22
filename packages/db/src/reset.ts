import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvError, createLogger } from '@citizenrun/shared';
import pg from 'pg';
import { loadDbEnv } from './env.ts';

/** The reset was refused: the URL is not a local database this command may drop. */
export class ResetRefusedError extends Error {
  override readonly name = 'ResetRefusedError';

  constructor(reason: string) {
    super(`Reset refused: ${reason}`);
  }
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);
const DATABASE_NAME = /^[a-z_][a-z0-9_]*$/;
const SERVER_DATABASES: ReadonlySet<string> = new Set(['postgres', 'template0', 'template1']);

function targetOf(databaseUrl: string): { adminUrl: string; name: string } {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new ResetRefusedError('the URL does not parse');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new ResetRefusedError('the URL is not a Postgres URL');
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new ResetRefusedError('the host is not localhost or 127.0.0.1');
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!DATABASE_NAME.test(name) || SERVER_DATABASES.has(name)) {
    throw new ResetRefusedError('the database name is not an application database name');
  }
  const admin = new URL(url.href);
  admin.pathname = '/postgres';
  return { adminUrl: admin.href, name };
}

/**
 * Drops and recreates the database named in `databaseUrl`, only when its host is `localhost` or
 * `127.0.0.1` and its name matches `^[a-z_][a-z0-9_]*$`; otherwise rejects with ResetRefusedError
 * before connecting. Ends the target's other sessions first. Works from the server's `postgres`
 * database.
 */
export async function resetDatabase(databaseUrl: string): Promise<void> {
  const { adminUrl, name } = targetOf(databaseUrl);
  const client = new pg.Client({ connectionString: adminUrl, application_name: 'os-reset' });
  client.on('error', () => undefined);
  await client.connect();
  try {
    await client.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );
    const identifier = client.escapeIdentifier(name);
    await client.query(`drop database if exists ${identifier}`);
    await client.query(`create database ${identifier}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

// The `reset` script. Exit codes: 0 done, 1 refused or failed, 2 bad environment.
async function main(): Promise<number> {
  let env;
  try {
    env = loadDbEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      createLogger({ service: 'api', level: 'info' }).error('reset.env_invalid', {
        variables: error.variables,
      });
      return 2;
    }
    throw error;
  }
  const logger = createLogger({ service: 'api', level: env.logLevel });
  try {
    await resetDatabase(env.databaseUrl);
    logger.info('reset.done');
    return 0;
  } catch (error) {
    logger.error('reset.failed', { error });
    return 1;
  }
}

function isEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  process.exitCode = await main();
}
