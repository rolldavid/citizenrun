import { createEnqueue } from '@citizenrun/db';
import type { Db, Enqueue } from '@citizenrun/db';
import {
  captureLogs,
  createTestBoss,
  getTestBucket,
  getTestDatabaseUrl,
  getTestDb,
} from '@citizenrun/db/testing';
import type { CapturedLine } from '@citizenrun/db/testing';
import { createLogger, newId } from '@citizenrun/shared';
import type { JobName, JobPayload } from '@citizenrun/shared';
import { loadKeyRing } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import { FakeClock } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll } from 'vitest';
import { deadLetterSource } from '../boss.ts';
import type { DeadLetterSource } from '../boss.ts';
import { createJobContext } from '../context.ts';
import type { JobContext, WorkerRuntime } from '../context.ts';
import type { WorkerEnv } from '../env.ts';
import { JobFailedError, errorClassOf } from '../jobs/types.ts';
import type { AnyJobDefinition, JobDefinition } from '../jobs/types.ts';
import type { OutboundFetch } from '../lib/outbound-fetch.ts';
import type { Bucket } from '../lib/storage.ts';
import { QUEUE_OPTIONS } from '../queue-options.ts';
import { QUEUE_REGISTRY, executeJob } from '../queues.ts';
import { testWorkerEnv } from './env.ts';
import { CaptureMailer } from './fakes/mailer.ts';
import { createFakeOutbound } from './fakes/outbound.ts';

/**
 * Changes to the test environment, in which every owner value is null (rule 2.8). A string, or
 * `undefined` to remove one, is a raw variable read through loadEnv as the worker reads it, so
 * the values derived from it follow (`APP_ENV: 'local'`, `ADMIN_EMAILS: 'a@example.test'`). Any
 * other value (a number, a boolean, null, a list), and any value of a derived member, replaces
 * the parsed value as given (`EMAIL_DAILY_QUOTA: 0`).
 */
export type RunJobEnv = Partial<WorkerEnv> | Readonly<Record<string, string | undefined>>;

export type RunJobOverrides = {
  clock?: FakeClock;
  mailer?: CaptureMailer;
  env?: RunJobEnv;
  db?: Db;
  enqueue?: Enqueue;
  storage?: Partial<JobContext['storage']>;
  /** Default: the test `media` bucket (the same as `storage.media`). */
  media?: Bucket;
  /** Default: the key ring of the test environment's APP_SECRET, `'0123456789abcdef'.repeat(4)`. */
  keys?: KeyRing;
  /** Default: a fake with no routes, so any outside call throws UnexpectedOutboundCall. */
  outbound?: OutboundFetch;
  /** The job's metadata: drives `isFinalAttempt` and the replay key. */
  job?: Partial<{ id: string; retryCount: number; createdOn: Date }>;
  retryCount?: number;
  jobId?: string;
  signal?: AbortSignal;
  deadLetter?: DeadLetterSource | null;
};

export type RunJobResult = {
  outcome: 'completed' | 'permanent' | 'failed';
  error: unknown;
  ctx: JobContext;
  mailer: CaptureMailer;
  logs: CapturedLine[];
};

const DEFAULT_RUN_QUEUED_MAX = 50;

// One send-only boss for this test file's process, started on first use and stopped after the file.
let bossStarting: Promise<PgBoss> | null = null;

function testBoss(): Promise<PgBoss> {
  bossStarting ??= createTestBoss();
  return bossStarting;
}

afterAll(async () => {
  const starting = bossStarting;
  bossStarting = null;
  if (starting !== null) {
    const boss = await starting.catch(() => null);
    await boss?.stop({ graceful: false }).catch(() => undefined);
  }
});

// No-op: a job run here holds no pg-boss claim whose heartbeat could be refreshed.
const touch = (): Promise<void> => Promise.resolve();

// Members of WorkerEnv that loadEnv derives and no variable sets.
const DERIVED_ENV_MEMBERS: ReadonlySet<string> = new Set([
  'ownerInputReport',
  'captureMail',
  'envLabel',
]);

function buildEnv(base: Record<string, string>, overrides: RunJobEnv | undefined): WorkerEnv {
  const raw: Record<string, string | undefined> = {};
  const replaced: Record<string, unknown> = {};
  for (const entry of Object.entries(overrides ?? {})) {
    const name = entry[0];
    const value: unknown = entry[1];
    if (!DERIVED_ENV_MEMBERS.has(name) && (typeof value === 'string' || value === undefined)) {
      raw[name] = value;
    } else {
      replaced[name] = value;
    }
  }
  const parsed = testWorkerEnv({ ...base, ...raw });
  if (Object.keys(replaced).length === 0) {
    return parsed;
  }
  // Each replaced value is a member of the Partial<WorkerEnv> the test passed.
  return Object.freeze({ ...parsed, ...replaced });
}

async function testRuntime(input: {
  clock: FakeClock;
  mailer: CaptureMailer;
  env?: RunJobEnv;
  db?: Db;
  enqueue?: Enqueue;
  storage?: Partial<JobContext['storage']>;
  media?: Bucket;
  keys?: KeyRing;
  outbound?: OutboundFetch;
}): Promise<WorkerRuntime> {
  const backups = input.storage?.backups ?? (await getTestBucket('backups'));
  const media = input.media ?? input.storage?.media ?? (await getTestBucket('media'));
  const env = buildEnv(
    {
      DATABASE_URL: getTestDatabaseUrl(),
      BACKUPS_BUCKET: backups.bucket,
      MEDIA_BUCKET: media.bucket,
    },
    input.env,
  );
  return {
    env,
    logger: createLogger({ service: 'worker', level: 'debug', sink: captureLogs().sink }),
    db: input.db ?? getTestDb(),
    enqueue: input.enqueue ?? createEnqueue(await testBoss()),
    storage: { backups, media },
    mailer: input.mailer,
    keys: input.keys ?? loadKeyRing(env.APP_SECRET, env.APP_SECRET_PREVIOUS),
    outbound: input.outbound ?? createFakeOutbound().fetch,
    clock: input.clock,
    abort: new AbortController(),
  };
}

/**
 * Runs one handler in process with the test dependencies (TEST-harness-job): this worker's
 * database, a send-only boss, the test `backups` and `media` buckets, a new CaptureMailer, the
 * test key ring, an outbound fake with no routes, the log capture, the test environment, a
 * FakeClock, a no-op `touch` and `retryLimit` 2. The payload is parsed as the worker parses it; a
 * payload that fails its schema never reaches `handle` and is `permanent`. Reports `completed`,
 * `permanent` or `failed` without throwing.
 */
export async function runJob<N extends JobName>(
  definition: JobDefinition<N>,
  payload: JobPayload<N>,
  overrides: RunJobOverrides = {},
): Promise<RunJobResult> {
  const clock = overrides.clock ?? new FakeClock();
  const mailer = overrides.mailer ?? new CaptureMailer();
  const runtime = await testRuntime({
    clock,
    mailer,
    ...(overrides.env === undefined ? {} : { env: overrides.env }),
    ...(overrides.db === undefined ? {} : { db: overrides.db }),
    ...(overrides.enqueue === undefined ? {} : { enqueue: overrides.enqueue }),
    ...(overrides.storage === undefined ? {} : { storage: overrides.storage }),
    ...(overrides.media === undefined ? {} : { media: overrides.media }),
    ...(overrides.keys === undefined ? {} : { keys: overrides.keys }),
    ...(overrides.outbound === undefined ? {} : { outbound: overrides.outbound }),
  });
  const built = createJobContext(
    runtime,
    {
      id: overrides.job?.id ?? overrides.jobId ?? newId(),
      name: definition.name,
      retryCount: overrides.job?.retryCount ?? overrides.retryCount ?? 0,
      retryLimit: QUEUE_OPTIONS[definition.name].queue.retryLimit,
      createdOn: overrides.job?.createdOn ?? clock.now(),
      deadLetter: overrides.deadLetter ?? null,
    },
    touch,
  );
  const ctx = overrides.signal === undefined ? built : { ...built, signal: overrides.signal };
  const result = await executeJob(definition, payload, ctx);
  return {
    outcome: result.outcome,
    error: result.error,
    ctx,
    mailer,
    logs: captureLogs().lines,
  };
}

// The queue among `names` whose oldest ready job (created or retry, start time reached) is oldest.
async function oldestReadyQueue(names: readonly JobName[]): Promise<JobName | null> {
  const rows = await getTestDb().execute<{ name: string }>(
    sql`select name from pgboss.job
        where name in ${[...names]}
          and state in ('created', 'retry')
          and start_after <= now()
        order by created_on, id
        limit 1`,
    'objects',
  );
  const found = rows[0]?.name;
  return names.find((name) => name === found) ?? null;
}

/**
 * Fetches queued jobs from the test boss and runs the handler `registry` (default QUEUE_REGISTRY)
 * gives each queue, oldest first, completing or failing each job, until no ready job is left in
 * `queues` (default every registry queue) or `max` (default 50) ran. A permanent failure completes
 * its job. Throws when a ready job's queue has no handler in the registry. The contexts get
 * runJob's defaults: the test buckets and key ring and an outbound fake with no routes.
 */
export async function runQueued(
  options: {
    queues?: readonly JobName[];
    max?: number;
    registry?: readonly AnyJobDefinition[];
    clock?: FakeClock;
    mailer?: CaptureMailer;
  } = {},
): Promise<{ name: string; id: string; outcome: 'completed' | 'failed' }[]> {
  const registry = options.registry ?? QUEUE_REGISTRY;
  const names = options.queues ?? registry.map((definition) => definition.name);
  const max = options.max ?? DEFAULT_RUN_QUEUED_MAX;
  const ran: { name: string; id: string; outcome: 'completed' | 'failed' }[] = [];
  if (names.length === 0) {
    return ran;
  }
  const boss = await testBoss();
  const runtime = await testRuntime({
    clock: options.clock ?? new FakeClock(),
    mailer: options.mailer ?? new CaptureMailer(),
  });
  while (ran.length < max) {
    const name = await oldestReadyQueue(names);
    if (name === null) {
      break;
    }
    const definition = registry.find((entry) => entry.name === name);
    if (definition === undefined) {
      throw new Error(`No handler is registered for the queue ${name}.`);
    }
    const [job] = await boss.fetch<unknown>(name, { batchSize: 1, includeMetadata: true });
    if (job === undefined) {
      break;
    }
    const ctx = createJobContext(
      runtime,
      {
        id: job.id,
        name,
        retryCount: job.retryCount,
        retryLimit: job.retryLimit,
        createdOn: job.createdOn,
        deadLetter: name === 'ops.dead' ? deadLetterSource(job) : null,
      },
      touch,
    );
    const result = await executeJob(definition, job.data, ctx);
    if (result.outcome === 'failed') {
      await boss.fail(name, job.id, new JobFailedError(errorClassOf(result.error)));
      ran.push({ name, id: job.id, outcome: 'failed' });
    } else {
      await boss.complete(name, job.id);
      ran.push({ name, id: job.id, outcome: 'completed' });
    }
  }
  return ran;
}

/** The jobs waiting in one queue (state `created`), oldest first, without running them. */
export async function peekQueue(
  name: JobName,
): Promise<{ id: string; data: unknown; startAfter: Date; singletonKey: string | null }[]> {
  // The start time is read as epoch milliseconds: the driver hands timestamps back as text here.
  const rows = await getTestDb().execute<{
    id: string;
    data: unknown;
    start_after_ms: number;
    singleton_key: string | null;
  }>(
    sql`select id::text as id, data,
          (extract(epoch from start_after) * 1000)::float8 as start_after_ms, singleton_key
        from pgboss.job
        where name = ${name} and state = 'created'
        order by created_on, id`,
    'objects',
  );
  return rows.map((row) => ({
    id: row.id,
    data: row.data,
    startAfter: new Date(Math.round(row.start_after_ms)),
    singletonKey: row.singleton_key,
  }));
}
