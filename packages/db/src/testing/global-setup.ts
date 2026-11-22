import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DeleteBucketCommand, ListBucketsCommand } from '@aws-sdk/client-s3';
import { createS3Client } from '@citizenrun/shared/storage';
import type pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../migrator.ts';
import { parseStamp, stampOf, templateName } from './names.ts';
import {
  connectHarnessClient,
  databaseUrlFor,
  dropDatabase,
  emptyBucket,
  harnessSettings,
} from './settings.ts';

// Two runs on one machine (two worktrees share the local server) build each template once. The
// key string never changes, so runs of every version agree.
const TRY_LOCK_SQL = "select pg_try_advisory_lock(hashtext('os_test_template')) as locked";
const UNLOCK_SQL = "select pg_advisory_unlock(hashtext('os_test_template'))";
// Each try is one short statement, so a long build by another run never meets the statement limit.
const LOCK_RETRY_MS = 250;
const LOCK_WAIT_MS = 10 * 60_000;

const WORKER_DATABASE_MAX_AGE_MS = 6 * 60 * 60_000;
const TEMPLATE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** What the global setup gives every worker through `inject('harness')`. */
export type HarnessContext = { templateName: string; runId: string; stamp: string };

let run: { stamp: string; runId: string } | null = null;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function pgBossVersion(): string {
  const manifest: unknown = createRequire(import.meta.url)('pg-boss/package.json');
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) {
    throw new Error('The installed pg-boss package has no version.');
  }
  return manifest.version;
}

/**
 * The first 12 hex characters of SHA-256 over every file under `dir` (its path relative to `dir`,
 * then its bytes, in path order) and the installed pg-boss version (TC-04).
 */
export function migrationsHash(dir: string): string {
  const hash = createHash('sha256');
  const files = filesUnder(dir)
    .map((path) => ({ path, name: relative(dir, path).split(sep).join('/') }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const file of files) {
    hash.update(file.name);
    hash.update(readFileSync(file.path));
  }
  hash.update(pgBossVersion());
  return hash.digest('hex').slice(0, 12);
}

async function takeTemplateLock(admin: pg.Client): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const result = await admin.query<{ locked: boolean }>(TRY_LOCK_SQL);
    if (result.rows[0]?.locked === true) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for another run to build the test template.');
    }
    await sleep(LOCK_RETRY_MS);
  }
}

// A finished template is marked as a template that takes no connections, so nothing connects to
// it and a build cut short (not marked) is never cloned: it is dropped and built again.
async function ensureTemplate(
  admin: pg.Client,
  databaseUrl: string,
  migrationsDir: string,
  stamp: string,
  hash: string,
): Promise<string> {
  const found = await admin.query<{ datname: string; datistemplate: boolean }>(
    'select datname, datistemplate from pg_database where datname ~ $1 order by datname',
    [`^os_tpl_[0-9]{12}_${hash}$`],
  );
  const ready = found.rows.find((row) => row.datistemplate);
  if (ready !== undefined) {
    return ready.datname;
  }
  for (const row of found.rows) {
    await dropDatabase(admin, row.datname);
  }
  const name = templateName(stamp, hash);
  const identifier = admin.escapeIdentifier(name);
  await admin.query(`create database ${identifier}`);
  try {
    await runMigrations(databaseUrlFor(databaseUrl, name), { migrationsFolder: migrationsDir });
    await admin.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [name],
    );
    await admin.query(`alter database ${identifier} with is_template true allow_connections false`);
  } catch (error) {
    await dropDatabase(admin, name);
    throw error;
  }
  return name;
}

// Databases left by runs that crashed: worker clones after 6 hours, templates after 7 days.
async function dropStale(admin: pg.Client, now: Date, keep: string): Promise<void> {
  const result = await admin.query<{ datname: string }>(
    "select datname from pg_database where datname like 'os\\_t\\_%' or datname like 'os\\_tpl\\_%'",
  );
  for (const { datname } of result.rows) {
    const stampedAt = parseStamp(datname);
    if (stampedAt === null || datname === keep) {
      continue;
    }
    const age = now.getTime() - stampedAt.getTime();
    const maxAge = datname.startsWith('os_tpl_') ? TEMPLATE_MAX_AGE_MS : WORKER_DATABASE_MAX_AGE_MS;
    if (age > maxAge) {
      await dropDatabase(admin, datname);
    }
  }
}

/**
 * Vitest global setup of the database harness: builds (once per migration hash, under an advisory
 * lock) the migrated template, drops what crashed runs left, picks this run's id and provides
 * `{ templateName, runId, stamp }` to the workers.
 */
export async function setup(project: TestProject): Promise<void> {
  const settings = harnessSettings();
  const now = new Date();
  const stamp = stampOf(now);
  const hash = migrationsHash(settings.migrationsDir);
  const admin = await connectHarnessClient(settings.databaseUrl, 'os-test-setup');
  let template: string;
  try {
    await takeTemplateLock(admin);
    try {
      template = await ensureTemplate(
        admin,
        settings.databaseUrl,
        settings.migrationsDir,
        stamp,
        hash,
      );
    } finally {
      await admin.query(UNLOCK_SQL);
    }
    await dropStale(admin, now, template);
  } finally {
    await admin.end().catch(() => undefined);
  }
  const runId = randomBytes(3).toString('hex');
  run = { stamp, runId };
  const context: HarnessContext = { templateName: template, runId, stamp };
  project.provide('harness', context);
}

/** Drops this run's worker databases and deletes its buckets. Templates are kept. */
export async function teardown(): Promise<void> {
  if (run === null) {
    return;
  }
  const { stamp, runId } = run;
  run = null;
  const settings = harnessSettings();
  const admin = await connectHarnessClient(settings.databaseUrl, 'os-test-teardown');
  try {
    const result = await admin.query<{ datname: string }>(
      'select datname from pg_database where datname ~ $1',
      [`^os_t_${stamp}_${runId}_[0-9]+$`],
    );
    for (const { datname } of result.rows) {
      await dropDatabase(admin, datname);
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
  const client = createS3Client(settings.s3);
  try {
    const listed = await client.send(new ListBucketsCommand({}));
    const prefix = `t-${runId}-`;
    for (const bucket of listed.Buckets ?? []) {
      if (bucket.Name?.startsWith(prefix) === true) {
        await emptyBucket(client, bucket.Name);
        await client.send(new DeleteBucketCommand({ Bucket: bucket.Name }));
      }
    }
  } finally {
    client.destroy();
  }
}
