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
import { FakeClock } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll } from 'vitest';
import { deadLetterSource } from '../boss.ts';
import type { DeadLetterSource } from '../boss.ts';
import { createJobContext } from '../context.ts';
import type { JobContext, WorkerRuntime } from '../context.ts';
import { JobFailedError, errorClassOf } from '../jobs/types.ts';
import type { AnyJobDefinition, JobDefinition } from '../jobs/types.ts';
import { QUEUE_OPTIONS } from '../queue-options.ts';
import { QUEUE_REGISTRY, executeJob } from '../queues.ts';
import { testWorkerEnv } from './env.ts';
import { CaptureMailer } from './fakes/mailer.ts';

export type RunJobOverrides = {
  clock?: FakeClock;
  mailer?: CaptureMailer;
  env?: Record<string, string | undefined>;
  db?: Db;
  enqueue?: Enqueue;
  storage?: Partial<JobContext['storage']>;
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

async function testRuntime(input: {
  clock: FakeClock;
  mailer: CaptureMailer;
  env?: Record<string, string | undefined>;
  db?: Db;
  enqueue?: Enqueue;
  storage?: Partial<JobContext['storage']>;
}): Promise<WorkerRuntime> {
  const backups = input.storage?.backups ?? (await getTestBucket('backups'));
  const media = await getTestBucket('media');
  const env = testWorkerEnv({
    DATABASE_URL: getTestDatabaseUrl(),
    BACKUPS_BUCKET: backups.bucket,
    MEDIA_BUCKET: media.bucket,
    ...input.env,
  });
  return {
    env,
    logger: createLogger({ service: 'worker', level: 'debug', sink: captureLogs().sink }),
    db: input.db ?? getTestDb(),
    enqueue: input.enqueue ?? createEnqueue(await testBoss()),
    storage: { backups },
    mailer: input.mailer,
    clock: input.clock,
    abort: new AbortController(),
  };
}

/**
 * Runs one handler in process with the test dependencies (TEST-harness-job): this worker's
 * database, a send-only boss, the test `backups` bucket, a new CaptureMailer, the log capture, the
 * test environment, a FakeClock, a no-op `touch` and `retryLimit` 2. The payload is parsed as the
 * worker parses it; a payload that fails its schema never reaches `handle` and is `permanent`.
 * Reports `completed`, `permanent` or `failed` without throwing.
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
  });
  const built = createJobContext(
    runtime,
    {
      id: overrides.jobId ?? newId(),
      name: definition.name,
      retryCount: overrides.retryCount ?? 0,
      retryLimit: QUEUE_OPTIONS[definition.name].queue.retryLimit,
      createdOn: clock.now(),
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
 * its job. Throws when a ready job's queue has no handler in the registry.
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
