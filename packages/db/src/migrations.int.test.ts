import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { CLIENT_ERRORS_RETENTION_DAYS } from './index.ts';
import { runMigrations } from './migrator.ts';
import { getTestDb, insertClientError } from './testing/index.ts';
import {
  connectHarnessClient,
  databaseUrlFor,
  dropDatabase,
  harnessSettings,
} from './testing/settings.ts';

// TEST-migrations: the schema the migrations build, by name (02 A9). Later milestones extend the
// table below with their own objects.
const EXPECTED_OBJECTS = {
  extensions: ['citext', 'pg_trgm', 'postgis', 'unaccent'],
  tables: ['client_errors', 'worker_heartbeats'],
  indexes: ['client_errors_created', 'client_errors_pkey', 'worker_heartbeats_pkey'],
  constraints: ['client_errors_platform_check'],
} as const;

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CHECK_VIOLATION = '23514';

const scratchDatabases: string[] = [];
const scratchFolders: string[] = [];

// An empty database of this file's own on the harness server, made from template0, never the clone.
async function createScratchDatabase(): Promise<string> {
  const name = `os_t_mig_${randomBytes(3).toString('hex')}`;
  const { databaseUrl } = harnessSettings();
  const admin = await connectHarnessClient(databaseUrl, 'os-test-migrations');
  try {
    await admin.query(`create database ${admin.escapeIdentifier(name)} template template0`);
  } finally {
    await admin.end();
  }
  scratchDatabases.push(name);
  return databaseUrlFor(databaseUrl, name);
}

async function rows<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
  return getTestDb().execute<T>(query, 'objects');
}

async function namesOf(query: SQL): Promise<string[]> {
  return (await rows<{ name: string }>(query)).map((row) => row.name).sort();
}

// The Postgres error under a Drizzle query error: the first error in the cause chain with a code.
function databaseError(error: unknown): { code?: unknown; constraint?: unknown } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if ('code' in current && typeof current.code === 'string') {
      return current;
    }
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

function runCheck(): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'pnpm',
      ['--filter', '@citizenrun/db', 'run', 'check'],
      { cwd: REPO_ROOT, timeout: 110_000 },
      (error) => {
        resolve(error === null ? 0 : typeof error.code === 'number' ? error.code : 1);
      },
    );
  });
}

afterAll(async () => {
  const { databaseUrl } = harnessSettings();
  const admin = await connectHarnessClient(databaseUrl, 'os-test-migrations');
  try {
    for (const name of scratchDatabases) {
      await dropDatabase(admin, name);
    }
  } finally {
    await admin.end();
  }
  for (const folder of scratchFolders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('the migrations', () => {
  it('applies from empty', async () => {
    const url = await createScratchDatabase();
    await expect(
      runMigrations(url, { migrationsFolder: harnessSettings().migrationsDir }),
    ).resolves.toMatchObject({ applied: expect.any(Number) as number });
    const client = await connectHarnessClient(url, 'os-test-migrations');
    try {
      const found = await client.query<{ name: string }>(
        `select table_name as name from information_schema.tables
         where table_schema = 'public' and table_name in ('client_errors', 'worker_heartbeats')
         order by table_name`,
      );
      expect(found.rows.map((row) => row.name)).toEqual(['client_errors', 'worker_heartbeats']);
    } finally {
      await client.end();
    }
  });

  it('schema and migrations agree', { timeout: 120_000 }, async () => {
    expect(await runCheck()).toBe(0);
  });

  it('every named object exists', async () => {
    expect(
      await namesOf(sql`select extname as name from pg_extension
        where extname in ${EXPECTED_OBJECTS.extensions}`),
    ).toEqual([...EXPECTED_OBJECTS.extensions].sort());
    expect(
      await namesOf(sql`select c.relname as name from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname in ${EXPECTED_OBJECTS.tables}`),
    ).toEqual([...EXPECTED_OBJECTS.tables].sort());
    expect(
      await namesOf(sql`select c.relname as name from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'i' and c.relname in ${EXPECTED_OBJECTS.indexes}`),
    ).toEqual([...EXPECTED_OBJECTS.indexes].sort());
    expect(
      await namesOf(sql`select conname as name from pg_constraint
        where contype = 'c' and conname in ${EXPECTED_OBJECTS.constraints}`),
    ).toEqual([...EXPECTED_OBJECTS.constraints].sort());
  });

  it('client_errors refuses an unknown platform', async () => {
    const failure: unknown = await insertClientError(getTestDb(), { platform: 'desktop' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(databaseError(failure)).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'client_errors_platform_check',
    });
  });

  it('client_errors holds no user column', async () => {
    const columns = await namesOf(sql`select column_name as name from information_schema.columns
      where table_schema = 'public' and table_name = 'client_errors'`);
    expect(columns).toEqual(
      [
        'id',
        'name',
        'code',
        'route',
        'component',
        'app_version',
        'platform',
        'frames',
        'request_id',
        'created_at',
      ].sort(),
    );
  });

  it('client_errors has its retention period and the index the cleanup reads', async () => {
    expect(CLIENT_ERRORS_RETENTION_DAYS).toBe(14);
    const found = await rows<{ indexdef: string }>(
      sql`select indexdef from pg_indexes
          where schemaname = 'public' and indexname = 'client_errors_created'`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.indexdef.endsWith('USING btree (created_at)')).toBe(true);
  });

  it('lock timeout is set', async () => {
    const source = harnessSettings().migrationsDir;
    const folder = mkdtempSync(join(tmpdir(), 'os-mig-'));
    scratchFolders.push(folder);
    cpSync(source, folder, { recursive: true });
    // A valid prefix later than any real migration's, so the probe runs last.
    const probe = join(folder, '29991231235959_lock_probe');
    expect(readdirSync(folder).every((name) => name < '29991231235959')).toBe(true);
    mkdirSync(probe);
    writeFileSync(
      join(probe, 'migration.sql'),
      "create table lock_probe as select current_setting('lock_timeout') as v;",
    );
    const url = await createScratchDatabase();
    await runMigrations(url, { migrationsFolder: folder });
    const client = await connectHarnessClient(url, 'os-test-migrations');
    try {
      const result = await client.query<{ v: string }>('select v from lock_probe');
      expect(result.rows.map((row) => row.v)).toEqual(['5s']);
    } finally {
      await client.end();
    }
  });
});
