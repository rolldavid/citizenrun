import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { S3BucketConfig } from '@citizenrun/shared/storage';
import pg from 'pg';

/** The harness refused to start: its database is not on a local or CI host. */
export class HarnessRefusedError extends Error {
  override readonly name = 'HarnessRefusedError';
}

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

const DEFAULT_DATABASE_URL = 'postgres://citizenrun:citizenrun@localhost:5432/postgres';
const DEFAULT_S3_ENDPOINT = 'http://localhost:8333';
// The local store's fixed, public development key (docker-compose.yml).
const DEFAULT_S3_ACCESS_KEY_ID = 'osdev';
const DEFAULT_S3_SECRET_ACCESS_KEY = 'osdev-secret-key';
const S3_REGION = 'us-east-1';

const ALLOWED_DATABASE_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  'postgres',
  'host.docker.internal',
]);

// Query parameters with which `pg` replaces the URL's host or port (pg-connection-string), so a
// URL carrying one is refused: the authority the guard reads would not be where it connects.
const HOST_OVERRIDE_PARAMS: readonly string[] = ['host', 'hostaddr', 'port'];
const DATABASE_PROTOCOLS: ReadonlySet<string> = new Set(['postgres:', 'postgresql:']);

const setting = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

/**
 * The harness's connection settings, from the `TEST_*` variables or their local defaults; never
 * from `DATABASE_URL`. `migrationsDir` is absolute (a relative `TEST_MIGRATIONS_DIR` is read from
 * the repository root). Throws HarnessRefusedError unless the database host is local or CI's and
 * no query parameter replaces that host or its port.
 */
export function harnessSettings(): {
  databaseUrl: string;
  s3: S3BucketConfig;
  migrationsDir: string;
} {
  const databaseUrl = setting('TEST_DATABASE_URL') ?? DEFAULT_DATABASE_URL;
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new HarnessRefusedError('TEST_DATABASE_URL does not parse.');
  }
  if (!DATABASE_PROTOCOLS.has(url.protocol)) {
    throw new HarnessRefusedError('TEST_DATABASE_URL must be a postgres:// or postgresql:// URL.');
  }
  if (HOST_OVERRIDE_PARAMS.some((name) => url.searchParams.has(name))) {
    throw new HarnessRefusedError(
      'TEST_DATABASE_URL must not carry a host, hostaddr or port query parameter.',
    );
  }
  if (!ALLOWED_DATABASE_HOSTS.has(url.hostname)) {
    throw new HarnessRefusedError(
      'The test database host must be localhost, 127.0.0.1, postgres or host.docker.internal.',
    );
  }
  const migrations = setting('TEST_MIGRATIONS_DIR');
  return {
    databaseUrl,
    s3: {
      endpoint: setting('TEST_S3_ENDPOINT') ?? DEFAULT_S3_ENDPOINT,
      region: S3_REGION,
      accessKeyId: setting('TEST_S3_ACCESS_KEY_ID') ?? DEFAULT_S3_ACCESS_KEY_ID,
      secretAccessKey: setting('TEST_S3_SECRET_ACCESS_KEY') ?? DEFAULT_S3_SECRET_ACCESS_KEY,
      forcePathStyle: true,
    },
    migrationsDir:
      migrations === undefined
        ? DEFAULT_MIGRATIONS_DIR
        : isAbsolute(migrations)
          ? migrations
          : resolve(REPO_ROOT, migrations),
  };
}

/** `databaseUrl` with its database name replaced by `name`. */
export function databaseUrlFor(databaseUrl: string, name: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.href;
}

/** Every connection the harness opens carries this limit (TC-34). */
export const HARNESS_STATEMENT_TIMEOUT_MS = 20_000;

/** The `-c` options string that sets HARNESS_STATEMENT_TIMEOUT_MS on a connection. */
export const HARNESS_SESSION_OPTIONS = `-c statement_timeout=${String(HARNESS_STATEMENT_TIMEOUT_MS)}`;

/** A connected client on `databaseUrl` with the harness's statement limit. The caller ends it. */
export async function connectHarnessClient(
  databaseUrl: string,
  applicationName: string,
): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: applicationName,
    options: HARNESS_SESSION_OPTIONS,
  });
  // A connection lost while idle emits `error`; the next query fails on its own.
  client.on('error', () => undefined);
  await client.connect();
  return client;
}

/** Drops database `name` if it exists, ending its sessions first; a template is unmarked first. */
export async function dropDatabase(admin: pg.Client, name: string): Promise<void> {
  const identifier = admin.escapeIdentifier(name);
  const found = await admin.query<{ datistemplate: boolean }>(
    'select datistemplate from pg_database where datname = $1',
    [name],
  );
  if (found.rows[0]?.datistemplate === true) {
    await admin.query(`alter database ${identifier} is_template false`);
  }
  await admin.query(`drop database if exists ${identifier} with (force)`);
}

/** Deletes every object of `bucket`, a page of keys at a time. */
export async function emptyBucket(client: S3Client, bucket: string): Promise<void> {
  for (;;) {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    const keys = (page.Contents ?? []).flatMap((item) =>
      item.Key === undefined ? [] : [{ Key: item.Key }],
    );
    if (keys.length === 0) {
      return;
    }
    const result = await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
    );
    if ((result.Errors ?? []).length > 0) {
      throw new Error('The store refused to delete some objects of a test bucket.');
    }
  }
}
