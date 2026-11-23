import { JOB_NAMES } from '@citizenrun/shared';
import type { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { inject } from 'vitest';
import { createDb, createPool } from '../client.ts';
import type { Db } from '../client.ts';
import type { HarnessContext } from './global-setup.ts';
import { workerDatabaseName } from './names.ts';
import {
  HARNESS_SESSION_OPTIONS,
  HARNESS_STATEMENT_TIMEOUT_MS,
  connectHarnessClient,
  databaseUrlFor,
  harnessSettings,
} from './settings.ts';

// Module state is per test file: Vitest gives every file its own module graph.
let context: HarnessContext | null = null;
let pool: Pool | null = null;
let db: Db | null = null;
let databaseReady = false;
const bosses = new Set<PgBoss>();

const ALREADY_EXISTS = '42P04';

function isHarnessContext(value: unknown): value is HarnessContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'templateName' in value &&
    typeof value.templateName === 'string' &&
    'runId' in value &&
    typeof value.runId === 'string' &&
    'stamp' in value &&
    typeof value.stamp === 'string'
  );
}

/** What the global setup provided: the template, the run id and the run's stamp. */
export function harnessContext(): HarnessContext {
  if (context === null) {
    // Undefined at run time in a project whose global setup is not this harness's.
    const provided: unknown = inject('harness');
    if (!isHarnessContext(provided)) {
      throw new Error('The database harness is not set up for this test project.');
    }
    context = provided;
  }
  return context;
}

/** This worker's slot, `VITEST_POOL_ID`, which names its database and buckets. */
export function workerSlot(): string {
  const slot = process.env.VITEST_POOL_ID;
  if (slot === undefined || !/^[0-9]+$/.test(slot)) {
    throw new Error('VITEST_POOL_ID is not set to a slot number.');
  }
  return slot;
}

/** The URL of this worker's database, the clone of the run's template. */
export function getTestDatabaseUrl(): string {
  const { stamp, runId } = harnessContext();
  return databaseUrlFor(
    harnessSettings().databaseUrl,
    workerDatabaseName(stamp, runId, workerSlot()),
  );
}

/** A Drizzle database on this worker's clone (a pool of at most 4), made on first use. */
export function getTestDb(): Db {
  if (db === null) {
    pool = createPool(getTestDatabaseUrl(), {
      max: 4,
      statementTimeoutMs: HARNESS_STATEMENT_TIMEOUT_MS,
      applicationName: 'os-test',
    });
    db = createDb(pool);
  }
  return db;
}

/** Creates this worker's clone of the template the first time; an existing clone is reused. */
export async function ensureWorkerDatabase(): Promise<void> {
  if (databaseReady) {
    return;
  }
  const { stamp, runId, templateName } = harnessContext();
  const settings = harnessSettings();
  const admin = await connectHarnessClient(settings.databaseUrl, 'os-test-clone');
  try {
    const name = admin.escapeIdentifier(workerDatabaseName(stamp, runId, workerSlot()));
    await admin.query(`create database ${name} template ${admin.escapeIdentifier(templateName)}`);
  } catch (error) {
    // An earlier file in this slot made the clone.
    if (!(error instanceof Error && 'code' in error && error.code === ALREADY_EXISTS)) {
      throw error;
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
  databaseReady = true;
}

/**
 * A started, send-only PgBoss on this worker's clone (no supervision, no schedules, no migration),
 * with every queue of JOB_NAMES that does not exist created with pg-boss's default options, so a
 * queue a test deleted is back on the next call. The caller stops it; any left running is stopped
 * after the file.
 */
export async function createTestBoss(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: getTestDatabaseUrl(),
    options: HARNESS_SESSION_OPTIONS,
    application_name: 'os-test-boss',
    max: 2,
    supervise: false,
    schedule: false,
    migrate: false,
  });
  // An unhandled `error` event would crash the worker; a failed call still rejects on its own.
  boss.on('error', () => undefined);
  await boss.start();
  bosses.add(boss);
  for (const name of JOB_NAMES) {
    if ((await boss.getQueue(name)) === null) {
      await boss.createQueue(name);
    }
  }
  return boss;
}

/** Stops every boss of this file and closes its pool. */
export async function closeWorker(): Promise<void> {
  for (const boss of bosses) {
    await boss.stop({ graceful: false }).catch(() => undefined);
  }
  bosses.clear();
  if (pool !== null) {
    const closing = pool;
    pool = null;
    db = null;
    await closing.end().catch(() => undefined);
  }
}
