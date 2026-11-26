import { createEnqueue } from '@citizenrun/db';
import {
  captureLogs,
  createTestBoss,
  getTestBucket,
  getTestDatabaseUrl,
  getTestDb,
} from '@citizenrun/db/testing';
import { JOB_NAMES, createLogger } from '@citizenrun/shared';
import type { JobName } from '@citizenrun/shared';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoss, deadLetterSource } from './boss.ts';
import type { DeadLetterSource } from './boss.ts';
import type { JobContext, WorkerRuntime } from './context.ts';
import { opsAlertJob } from './jobs/ops/alert.ts';
import { opsDeadJob } from './jobs/ops/dead.ts';
import { PermanentJobError, RetryableJobError } from './jobs/types.ts';
import type { JobDefinition } from './jobs/types.ts';
import { createWorkerPool } from './lib/db.ts';
import { createShutdown } from './lib/shutdown.ts';
import { QUEUE_OPTIONS } from './queue-options.ts';
import {
  QUEUE_REGISTRY,
  QueuePolicyMismatchError,
  SCHEDULE_REGISTRY,
  createQueues,
  registerQueues,
  registerSchedules,
} from './queues.ts';
import type { RegisterOverrides } from './queues.ts';
import { testWorkerEnv } from './testing/env.ts';
import { CaptureMailer } from './testing/fakes/mailer.ts';
import { peekQueue, runJob, runQueued } from './testing/job.ts';

// Retries at once and short polls, so three attempts finish in seconds.
const FAST: RegisterOverrides = { retryBackoff: false, retryDelay: 0, pollingIntervalSeconds: 0.5 };
const WAIT = { timeout: 15_000, interval: 100 };

class FixtureFailure extends Error {
  override readonly name = 'FixtureFailure';
}

const bosses: PgBoss[] = [];

afterEach(async () => {
  for (const boss of bosses.splice(0)) {
    await boss.stop({ graceful: false }).catch(() => undefined);
  }
});

function testLogger(): ReturnType<typeof createLogger> {
  return createLogger({ service: 'worker', level: 'debug', sink: captureLogs().sink });
}

// A worker-shaped boss on this worker's database, stopped after the test. Supervision and the cron
// pass stay off: every behaviour under test runs inside fetch, fail and complete.
async function startBoss(options: { max?: number } = {}): Promise<PgBoss> {
  const boss = createBoss({
    connectionString: getTestDatabaseUrl(),
    logger: testLogger(),
    supervise: false,
    schedule: false,
    max: options.max ?? 3,
  });
  bosses.push(boss);
  await boss.start();
  return boss;
}

async function runtimeFor(boss: PgBoss): Promise<WorkerRuntime> {
  const backups = await getTestBucket('backups');
  return {
    env: testWorkerEnv({ DATABASE_URL: getTestDatabaseUrl(), BACKUPS_BUCKET: backups.bucket }),
    logger: testLogger(),
    db: getTestDb(),
    enqueue: createEnqueue(boss),
    storage: { backups },
    mailer: new CaptureMailer(),
    clock: new FakeClock('2027-03-05T09:50:00.000Z'),
    abort: new AbortController(),
  };
}

function definitionOf<N extends JobName>(
  name: N,
  handle: JobDefinition<N>['handle'],
): JobDefinition<N> {
  return { name, queue: QUEUE_OPTIONS[name].queue, work: QUEUE_OPTIONS[name].work, handle };
}

async function jobRow(
  name: string,
  id: string,
): Promise<{
  state: string;
  retry_count: number;
  output: unknown;
  heartbeat_us: number | null;
} | null> {
  const rows = await getTestDb().execute<{
    state: string;
    retry_count: number;
    output: unknown;
    heartbeat_us: number | null;
  }>(
    sql`select state::text as state, retry_count, output,
          (extract(epoch from heartbeat_on) * 1000000)::float8 as heartbeat_us
        from pgboss.job where name = ${name} and id = ${id}::uuid`,
    'objects',
  );
  return rows[0] ?? null;
}

async function jobCount(name: string): Promise<number> {
  const rows = await getTestDb().execute<{ count: number }>(
    sql`select count(*)::int as count from pgboss.job where name = ${name}`,
    'objects',
  );
  return rows[0]?.count ?? 0;
}

function lines(event: string): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === event)
    .map((line) => line.parsed);
}

function anyLineHolds(text: string): boolean {
  return captureLogs().lines.some((line) => line.raw.includes(text));
}

// The one-hour throttle slots pg-boss aligns to the epoch (J-ops.dead's window).
const HOUR_MS = 3_600_000;

function hourSlot(ms: number): number {
  return Math.floor(ms / HOUR_MS);
}

// Each ops.dead job's start and end, in epoch milliseconds: its handler sent the alert in between.
async function deadLetterTimes(): Promise<{ startedMs: number; completedMs: number }[]> {
  const rows = await getTestDb().execute<{ started_ms: number; completed_ms: number }>(
    sql`select (extract(epoch from started_on) * 1000)::float8 as started_ms,
          (extract(epoch from completed_on) * 1000)::float8 as completed_ms
        from pgboss.job where name = 'ops.dead' and state = 'completed'
        order by created_on`,
    'objects',
  );
  return rows.map((row) => ({ startedMs: row.started_ms, completedMs: row.completed_ms }));
}

async function pendingCount(name: string): Promise<number> {
  const rows = await getTestDb().execute<{ count: number }>(
    sql`select count(*)::int as count from pgboss.job
        where name = ${name} and state in ('created', 'retry', 'active')`,
    'objects',
  );
  return rows[0]?.count ?? 0;
}

async function send(boss: PgBoss, name: string, data: object): Promise<string> {
  const id = await boss.send(name, data);
  if (id === null) {
    throw new Error('pg-boss refused the send');
  }
  return id;
}

describe('the queue registry', () => {
  it('every job name has queue options', () => {
    expect(Object.keys(QUEUE_OPTIONS).sort()).toEqual([...JOB_NAMES].sort());
  });

  it('every queue dead-letters to ops.dead', async () => {
    const boss = await startBoss();
    await createQueues(boss, JOB_NAMES, testLogger());
    for (const name of JOB_NAMES) {
      const queue = await boss.getQueue(name);
      expect(queue).not.toBeNull();
      expect(queue?.retryLimit).toBe(2);
      expect(queue?.retryBackoff).toBe(true);
      expect(queue?.deleteAfterSeconds).toBe(86400);
      if (name === 'ops.dead') {
        expect(queue?.deadLetter ?? null).toBeNull();
      } else {
        expect(queue?.deadLetter).toBe('ops.dead');
      }
    }
  });

  it('every created queue holds the options of 04 section 1.5', async () => {
    // Written out, not read from QUEUE_OPTIONS, so a changed value fails here.
    const expected: Record<
      JobName,
      [policy: string, delay: number, delayMax: number, expire: number, heartbeat: number | null]
    > = {
      'ops.dead': ['standard', 60, 600, 300, null],
      'ops.alert': ['standard', 60, 900, 120, null],
      'ops.heartbeat': ['stately', 5, 30, 30, null],
      'backup.check': ['stately', 300, 3600, 300, null],
      'db.connections-check': ['stately', 300, 3600, 120, null],
      'cost.check': ['stately', 300, 3600, 1800, 60],
      'account.delete': ['standard', 60, 3600, 3600, 60],
      'account.export': ['standard', 60, 1800, 1800, 60],
      'cleanup.retention': ['stately', 300, 3600, 7200, 60],
      'uploads.cleanup': ['standard', 30, 900, 300, null],
      'media.process.image': ['standard', 2, 60, 120, null],
      'notify.email': ['standard', 60, 1800, 120, null],
      'bundle.poll': ['singleton', 60, 900, 300, null],
      'bundle.load': ['singleton', 300, 3600, 14400, 60],
      'bundle.revert': ['singleton', 300, 3600, 7200, 60],
      'score.issues': ['standard', 60, 900, 3600, 60],
      'db.size-check': ['stately', 300, 3600, 120, null],
      'field-reports.export': ['stately', 300, 3600, 600, null],
    };
    const boss = await startBoss();
    // ops.dead last: the other queues name it as their dead letter.
    for (const name of [...JOB_NAMES].reverse()) {
      await boss.deleteQueue(name);
    }
    await createQueues(boss, JOB_NAMES, testLogger());
    for (const name of JOB_NAMES) {
      const queue = await boss.getQueue(name);
      const [policy, retryDelay, retryDelayMax, expireInSeconds, heartbeatSeconds] = expected[name];
      expect({
        name,
        policy: queue?.policy,
        retryDelay: queue?.retryDelay,
        retryDelayMax: queue?.retryDelayMax,
        expireInSeconds: queue?.expireInSeconds,
        heartbeatSeconds: queue?.heartbeatSeconds ?? null,
      }).toEqual({ name, policy, retryDelay, retryDelayMax, expireInSeconds, heartbeatSeconds });
      expect(queue?.policy).toBe(QUEUE_OPTIONS[name].queue.policy);
    }
  });

  it('a stately queue refuses a second send while one job is queued', async () => {
    const boss = await startBoss();
    await createQueues(boss, ['cost.check'], testLogger());
    expect(await boss.send('cost.check', {})).not.toBeNull();
    expect(await boss.send('cost.check', {})).toBeNull();
    expect(await pendingCount('cost.check')).toBe(1);
  });

  it('a queue that exists with another policy stops the boot', async () => {
    const boss = await startBoss();
    await boss.deleteQueue('cost.check');
    await boss.createQueue('cost.check'); // pg-boss's default policy, standard
    try {
      await expect(createQueues(boss, ['cost.check'], testLogger())).rejects.toBeInstanceOf(
        QueuePolicyMismatchError,
      );
      const mismatch = lines('queue.policy_mismatch');
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]).toMatchObject({
        level: 'error',
        queue: 'cost.check',
        expected: 'stately',
        found: 'standard',
      });
      expect((await boss.getQueue('cost.check'))?.policy).toBe('standard');
    } finally {
      await boss.deleteQueue('cost.check');
      await boss.createQueue('cost.check', { policy: 'stately' });
    }
  });

  it('a changed option takes effect on a queue that exists', async () => {
    const boss = await startBoss();
    await createQueues(boss, ['cost.check'], testLogger(), FAST);
    expect((await boss.getQueue('cost.check'))?.retryBackoff).toBe(false);
    expect((await boss.getQueue('cost.check'))?.retryDelay).toBe(0);
    await createQueues(boss, ['cost.check'], testLogger());
    expect((await boss.getQueue('cost.check'))?.retryBackoff).toBe(true);
    expect((await boss.getQueue('cost.check'))?.retryDelay).toBe(300);
  });

  it('a job failing three times reaches ops.dead', async () => {
    const boss = await startBoss();
    let runs = 0;
    const failing = definitionOf('cost.check', () => {
      runs += 1;
      return Promise.reject(new FixtureFailure('fixture failure'));
    });
    await registerQueues(boss, await runtimeFor(boss), [failing], FAST);
    const id = await send(boss, 'cost.check', {});

    await vi.waitFor(async () => {
      expect((await jobRow('cost.check', id))?.state).toBe('failed');
    }, WAIT);
    expect(runs).toBe(3);
    expect(await jobCount('ops.dead')).toBe(1);

    const [dead] = await boss.fetch<unknown>('ops.dead', { includeMetadata: true });
    expect(dead).toBeDefined();
    if (dead === undefined) {
      return;
    }
    // pg-boss 12 keeps the source in the dead letter's metadata; its data is the failed payload.
    expect(dead.data).toEqual({});
    expect(dead.sourceName).toBe('cost.check');
    expect(dead.sourceId).toBe(id);
    expect(deadLetterSource(dead)).toEqual({
      queue: 'cost.check',
      jobId: id,
      errorClass: 'FixtureFailure',
    });
    // Two retries logged at warn, the last attempt at error, each with its class.
    const failed = lines('job.failed');
    expect(failed.map((line) => line.level)).toEqual(['warn', 'warn', 'error']);
    expect(failed.map((line) => line.attempt)).toEqual([1, 2, 3]);
    expect(failed.every((line) => line.errorClass === 'FixtureFailure')).toBe(true);
    expect(failed.every((line) => line.job === 'cost.check' && line.jobId === id)).toBe(true);
  });

  it('a dead letter reaches the ops.dead handler with its source', async () => {
    const boss = await startBoss();
    const seen: (DeadLetterSource | null)[] = [];
    const failing = definitionOf('cost.check', () => Promise.reject(new FixtureFailure()));
    const dead = definitionOf('ops.dead', (_payload, ctx) => {
      seen.push(ctx.job.deadLetter);
      return Promise.resolve();
    });
    await registerQueues(boss, await runtimeFor(boss), [failing, dead], FAST);
    const id = await send(boss, 'cost.check', {});

    await vi.waitFor(() => {
      expect(seen).toHaveLength(1);
    }, WAIT);
    expect(seen[0]).toEqual({ queue: 'cost.check', jobId: id, errorClass: 'FixtureFailure' });
  });

  it('a provider error is stored and logged without its text', async () => {
    const boss = await startBoss();
    const failing = definitionOf('cost.check', () =>
      Promise.reject(new Error(`provider said ${marker()}`)),
    );
    await registerQueues(boss, await runtimeFor(boss), [failing], FAST);
    const id = await send(boss, 'cost.check', {});

    await vi.waitFor(async () => {
      expect((await jobRow('cost.check', id))?.state).toBe('failed');
    }, WAIT);
    const [stored] = await boss.findJobs('cost.check', { id });
    expect(stored?.state).toBe('failed');
    expect(JSON.stringify(stored?.output)).not.toContain(marker());
    expect(stored?.output).toMatchObject({ name: 'Error', message: 'Error' });
    expect(anyLineHolds(marker())).toBe(false);

    const [dead] = await boss.fetch<unknown>('ops.dead', { includeMetadata: true });
    expect(JSON.stringify(dead?.sourceOutput)).not.toContain(marker());
    expect(dead === undefined ? null : deadLetterSource(dead)?.errorClass).toBe('Error');
  });

  it('a permanent failure completes without a retry or a dead letter', async () => {
    const boss = await startBoss();
    let runs = 0;
    const permanent = definitionOf('cost.check', () => {
      runs += 1;
      return Promise.reject(new PermanentJobError());
    });
    await registerQueues(boss, await runtimeFor(boss), [permanent], FAST);
    const id = await send(boss, 'cost.check', {});

    await vi.waitFor(async () => {
      expect((await jobRow('cost.check', id))?.state).toBe('completed');
    }, WAIT);
    expect(runs).toBe(1);
    expect(await jobCount('ops.dead')).toBe(0);
    const failed = lines('job.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      level: 'warn',
      job: 'cost.check',
      jobId: id,
      attempt: 1,
      errorClass: 'PermanentJobError',
      permanent: true,
    });
    expect(typeof failed[0]?.durationMs).toBe('number');
  });

  it('an invalid payload is a permanent failure', async () => {
    const boss = await startBoss();
    let runs = 0;
    const heartbeat = definitionOf('ops.heartbeat', () => {
      runs += 1;
      return Promise.resolve();
    });
    await registerQueues(boss, await runtimeFor(boss), [heartbeat], FAST);
    const id = await send(boss, 'ops.heartbeat', { extra: 'payload-value-fixture' });

    await vi.waitFor(async () => {
      expect((await jobRow('ops.heartbeat', id))?.state).toBe('completed');
    }, WAIT);
    expect(runs).toBe(0);
    const invalid = lines('job.payload_invalid');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({ level: 'warn', job: 'ops.heartbeat', jobId: id });
    expect(Array.isArray(invalid[0]?.issuePaths)).toBe(true);
    expect(anyLineHolds('payload-value-fixture')).toBe(false);
    expect(await jobCount('ops.dead')).toBe(0);
  });

  it('schedules are registered and a stale one is removed', async () => {
    const boss = await startBoss();
    await boss.schedule('backup.check', '0 0 * * *', {}, { tz: 'UTC', key: 'stale' });
    try {
      await registerSchedules(boss, testLogger(), [
        {
          id: 'S-cost.check',
          queue: 'cost.check',
          cron: '50 9 * * *',
          data: {},
          key: '',
          missed: 'once',
        },
      ]);
      const schedules = await boss.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0]).toMatchObject({
        name: 'cost.check',
        cron: '50 9 * * *',
        key: '',
        timezone: 'UTC',
      });
      expect(schedules[0]?.options?.missed).toBe('once');
      expect(schedules[0]?.options?.singletonKey).toBeUndefined();
      expect(
        lines('schedule.removed').some(
          (line) => line.queue === 'backup.check' && line.key === 'stale',
        ),
      ).toBe(true);
    } finally {
      await boss.unschedule('cost.check', '');
      await boss.unschedule('backup.check', 'stale');
    }
  });

  it('a schedule with a key sends with it as the singleton key', async () => {
    const boss = await startBoss();
    try {
      await registerSchedules(boss, testLogger(), [
        {
          id: 'S-fixture',
          queue: 'cost.check',
          cron: '5 * * * *',
          data: {},
          key: 'hourly',
          missed: 'skip',
        },
      ]);
      const [schedule] = await boss.getSchedules();
      expect(schedule).toMatchObject({ name: 'cost.check', key: 'hourly', timezone: 'UTC' });
      expect(schedule?.options?.singletonKey).toBe('hourly');
      expect(schedule?.options?.missed).toBe('skip');
    } finally {
      await boss.unschedule('cost.check', 'hourly');
    }
  });

  it('send to a queue never created throws', async () => {
    const boss = await startBoss();
    const sender = createBoss({
      connectionString: getTestDatabaseUrl(),
      logger: testLogger(),
      supervise: false,
      schedule: false,
      max: 3,
    });
    bosses.push(sender);
    await sender.start();
    expect(await boss.getQueue('ops.never-created')).toBeNull();
    await expect(sender.send('ops.never-created', {})).rejects.toBeInstanceOf(Error);
    expect(await jobCount('ops.never-created')).toBe(0);
  });

  it('a running job finishes inside the drain', async () => {
    const boss = await startBoss();
    let release: () => void = () => undefined;
    const latch = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    const slow = definitionOf('ops.heartbeat', async () => {
      started = true;
      await latch;
    });
    const runtime = await runtimeFor(boss);
    await registerQueues(boss, runtime, [slow], FAST);
    const id = await send(boss, 'ops.heartbeat', {});
    await vi.waitFor(() => {
      expect(started).toBe(true);
    }, WAIT);

    const exit = vi.fn<(code: number) => void>();
    const shutdown = createShutdown({
      // The handler is released only once the drain has begun.
      boss: {
        stop: async (options) => {
          const stopping = boss.stop(options);
          release();
          await stopping;
        },
      },
      pool: createWorkerPool(runtime.env),
      abort: runtime.abort,
      logger: runtime.logger,
      exit,
      stopTimeoutMs: 5000,
    });
    await shutdown.run('SIGTERM');

    expect((await jobRow('ops.heartbeat', id))?.state).toBe('completed');
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(lines('worker.stopping')).toHaveLength(1);
    expect(lines('worker.stopped')).toHaveLength(1);
    expect(lines('job.done')).toEqual([
      expect.objectContaining({ job: 'ops.heartbeat', jobId: id, attempt: 1 }),
    ]);
  });

  it('a job cut off by the drain is retried', async () => {
    const boss = await startBoss();
    let started = false;
    const stuck = definitionOf(
      'ops.heartbeat',
      (_payload, ctx: JobContext) =>
        new Promise<void>((_resolve, reject) => {
          started = true;
          ctx.signal.addEventListener(
            'abort',
            () => {
              reject(new RetryableJobError('shutdown'));
            },
            { once: true },
          );
        }),
    );
    const runtime = await runtimeFor(boss);
    await registerQueues(boss, runtime, [stuck], FAST);
    const id = await send(boss, 'ops.heartbeat', {});
    await vi.waitFor(() => {
      expect(started).toBe(true);
    }, WAIT);

    const exit = vi.fn<(code: number) => void>();
    await createShutdown({
      boss,
      pool: createWorkerPool(runtime.env),
      abort: runtime.abort,
      logger: runtime.logger,
      exit,
      stopTimeoutMs: 500,
    }).run('SIGTERM');

    const row = await jobRow('ops.heartbeat', id);
    expect(row?.state).toBe('retry');
    expect(exit).toHaveBeenCalledWith(0);
    expect(lines('job.failed')).toEqual([
      expect.objectContaining({ level: 'warn', errorClass: 'RetryableJobError', attempt: 1 }),
    ]);
  });

  it('boss errors are logged by class', async () => {
    const boss = await startBoss();
    expect(() => boss.emit('error', new Error(marker()))).not.toThrow();
    const errors = lines('boss.error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ level: 'error', errorClass: 'Error' });
    expect(anyLineHolds(marker())).toBe(false);
  });

  it('touch keeps a long job alive', async () => {
    const boss = await startBoss();
    const beats: (number | null)[] = [];
    const long = definitionOf('cost.check', async (_payload, ctx) => {
      beats.push((await jobRow('cost.check', ctx.job.id))?.heartbeat_us ?? null);
      await ctx.touch();
      beats.push((await jobRow('cost.check', ctx.job.id))?.heartbeat_us ?? null);
    });
    await registerQueues(boss, await runtimeFor(boss), [long], FAST);
    const id = await send(boss, 'cost.check', {});

    await vi.waitFor(async () => {
      expect((await jobRow('cost.check', id))?.state).toBe('completed');
    }, WAIT);
    // Microseconds since the epoch: the claim stamps the heartbeat, and touch moves it on.
    const [before, after] = beats;
    expect(typeof before).toBe('number');
    expect(typeof after).toBe('number');
    expect(after ?? 0).toBeGreaterThan(before ?? Number.POSITIVE_INFINITY);
  });

  it('every job name has a registry entry and every entry is a job name', () => {
    expect(QUEUE_REGISTRY.map((definition) => definition.name).sort()).toEqual(
      [...JOB_NAMES].sort(),
    );
  });

  it('every schedule exists after boot with its cron, key and missed value', async () => {
    const boss = await startBoss();
    try {
      await registerSchedules(boss, testLogger());
      const schedules = await boss.getSchedules();
      // By queue, then key: the two retention schedules share a queue.
      const byQueue = (
        left: { name: string; key: string },
        right: { name: string; key: string },
      ): number => left.name.localeCompare(right.name) || left.key.localeCompare(right.key);
      expect(
        [...schedules].sort(byQueue).map((schedule) => ({
          name: schedule.name,
          cron: schedule.cron,
          key: schedule.key,
          timezone: schedule.timezone,
          missed: schedule.options?.missed,
          data: schedule.data,
        })),
      ).toEqual(
        SCHEDULE_REGISTRY.map((entry) => ({
          name: entry.queue,
          cron: entry.cron,
          key: entry.key,
          timezone: 'UTC',
          missed: entry.missed,
          data: entry.data,
        })).sort(byQueue),
      );
      expect(SCHEDULE_REGISTRY.map((entry) => [entry.id, entry.cron, entry.missed])).toEqual([
        ['S-ops.heartbeat', '* * * * *', 'skip'],
        ['S-backup.check', '30 9 * * *', 'once'],
        ['S-db.connections-check', '40 9 * * *', 'once'],
        ['S-cost.check', '50 9 * * *', 'once'],
        ['S-cleanup.retention.hourly', '5 * * * *', 'skip'],
        ['S-cleanup.retention.nightly', '15 7 * * *', 'once'],
        ['S-bundle.poll', '*/15 * * * *', 'skip'],
        ['S-db.size-check', '25 * * * *', 'skip'],
        ['S-field-reports.export', '30 5 * * *', 'once'],
        ['S-score.issues.weekly', '30 12 * * 0', 'once'],
      ]);
    } finally {
      for (const entry of SCHEDULE_REGISTRY) {
        await boss.unschedule(entry.queue, entry.key);
      }
    }
  });

  it('a job failing three times reaches ops.dead and mails the admin once', async () => {
    const boss = await startBoss();
    const mailer = new CaptureMailer();
    const runtime: WorkerRuntime = { ...(await runtimeFor(boss)), mailer };
    let runs = 0;
    const failing = definitionOf('backup.check', () => {
      runs += 1;
      return Promise.reject(new FixtureFailure(`provider said ${marker()}`));
    });
    await registerQueues(boss, runtime, [failing, opsDeadJob, opsAlertJob], FAST);
    const id = await send(boss, 'backup.check', {});

    await vi.waitFor(() => {
      expect(mailer.sent).toHaveLength(1);
    }, WAIT);
    expect(runs).toBe(3);
    const [email] = mailer.sent;
    expect(email?.to).toEqual(['admin@example.test']);
    expect(email?.subject.endsWith('backup.check')).toBe(true);
    expect(email?.text).toContain(id);
    expect(email?.text).toContain('FixtureFailure');
    expect(JSON.stringify(email)).not.toContain(marker());
    expect(anyLineHolds(marker())).toBe(false);
    await vi.waitFor(async () => {
      expect(await pendingCount('ops.alert')).toBe(0);
    }, WAIT);
    expect(await jobCount('ops.alert')).toBe(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it('a second failure from the same queue within the hour sends no second email', async () => {
    const boss = await startBoss();
    const mailer = new CaptureMailer();
    const runtime: WorkerRuntime = { ...(await runtimeFor(boss)), mailer };
    const failing = definitionOf('backup.check', () => Promise.reject(new FixtureFailure()));
    await registerQueues(boss, runtime, [failing, opsDeadJob, opsAlertJob], FAST);

    // The queue may be stately: each job is sent once the one before it has failed for good.
    for (let index = 0; index < 5; index += 1) {
      const id = await send(boss, 'backup.check', {});
      await vi.waitFor(async () => {
        expect((await jobRow('backup.check', id))?.state).toBe('failed');
      }, WAIT);
    }
    await vi.waitFor(async () => {
      expect(await deadLetterTimes()).toHaveLength(5);
      expect(await pendingCount('ops.dead')).toBe(0);
      expect(await pendingCount('ops.alert')).toBe(0);
    }, WAIT);

    const times = await deadLetterTimes();
    const slots = new Set(times.map((time) => hourSlot(time.startedMs)));
    const straddled = times.some((time) => hourSlot(time.startedMs) !== hourSlot(time.completedMs));
    if (straddled) {
      // A handler that ran across the top of an hour sent in one of the two slots.
      const reachable = new Set(
        times.flatMap((time) => [hourSlot(time.startedMs), hourSlot(time.completedMs)]),
      );
      expect(mailer.sent.length).toBeGreaterThanOrEqual(slots.size);
      expect(mailer.sent.length).toBeLessThanOrEqual(reachable.size);
    } else {
      expect(mailer.sent).toHaveLength(slots.size);
    }
    expect(mailer.sent.every((email) => email.subject.endsWith('backup.check'))).toBe(true);
  }, 90_000);

  it('deadLetterSource needs the source queue and job id', () => {
    expect(deadLetterSource({ sourceName: null, sourceId: null, sourceOutput: null })).toBeNull();
    expect(deadLetterSource({})).toBeNull();
    expect(
      deadLetterSource({
        sourceName: 'backup.check',
        sourceId: 'fixture-id',
        sourceOutput: { name: 'not a class', message: 'TypeError' },
      }),
    ).toEqual({ queue: 'backup.check', jobId: 'fixture-id', errorClass: 'TypeError' });
    expect(
      deadLetterSource({
        sourceName: 'backup.check',
        sourceId: 'fixture-id',
        sourceOutput: { value: 'pg-boss shut down while active' },
      }),
    ).toEqual({ queue: 'backup.check', jobId: 'fixture-id', errorClass: 'Error' });
  });
});

describe('the account job queues and schedules', () => {
  it('the account job queues have their options', async () => {
    // Written out, not read from QUEUE_OPTIONS, so a changed value fails here.
    const expected: Partial<
      Record<
        JobName,
        {
          policy: string;
          localConcurrency: number;
          retryDelay: number;
          retryDelayMax: number;
          expireInSeconds: number;
          heartbeatSeconds: number | null;
          pollingIntervalSeconds: number;
        }
      >
    > = {
      'account.delete': {
        policy: 'standard',
        localConcurrency: 2,
        retryDelay: 60,
        retryDelayMax: 3600,
        expireInSeconds: 3600,
        heartbeatSeconds: 60,
        pollingIntervalSeconds: 5,
      },
      'account.export': {
        policy: 'standard',
        localConcurrency: 2,
        retryDelay: 60,
        retryDelayMax: 1800,
        expireInSeconds: 1800,
        heartbeatSeconds: 60,
        pollingIntervalSeconds: 5,
      },
      'cleanup.retention': {
        policy: 'stately',
        localConcurrency: 1,
        retryDelay: 300,
        retryDelayMax: 3600,
        expireInSeconds: 7200,
        heartbeatSeconds: 60,
        pollingIntervalSeconds: 10,
      },
      'uploads.cleanup': {
        policy: 'standard',
        localConcurrency: 4,
        retryDelay: 30,
        retryDelayMax: 900,
        expireInSeconds: 300,
        heartbeatSeconds: null,
        pollingIntervalSeconds: 5,
      },
      'media.process.image': {
        policy: 'standard',
        localConcurrency: 2,
        retryDelay: 2,
        retryDelayMax: 60,
        expireInSeconds: 120,
        heartbeatSeconds: null,
        pollingIntervalSeconds: 1,
      },
      'notify.email': {
        policy: 'standard',
        localConcurrency: 4,
        retryDelay: 60,
        retryDelayMax: 1800,
        expireInSeconds: 120,
        heartbeatSeconds: null,
        pollingIntervalSeconds: 2,
      },
    };
    const names = Object.keys(expected) as JobName[];
    const registry = QUEUE_REGISTRY.filter((definition) => names.includes(definition.name));
    expect(registry.map((definition) => definition.name).sort()).toEqual([...names].sort());

    const boss = await startBoss();
    for (const name of names) {
      await boss.deleteQueue(name);
    }
    // The options registerQueues gives `work`, recorded instead of starting a worker, so no job
    // of an earlier case runs here.
    const workOptions = new Map<string, unknown>();
    const record = (name: string, options: unknown): Promise<string> => {
      workOptions.set(name, options);
      return Promise.resolve(`fixture-worker-${name}`);
    };
    vi.spyOn(boss, 'work').mockImplementation(record);
    await registerQueues(boss, await runtimeFor(boss), registry);

    for (const name of names) {
      const row = expected[name];
      const queue = await boss.getQueue(name);
      expect({
        name,
        policy: queue?.policy,
        retryLimit: queue?.retryLimit,
        retryBackoff: queue?.retryBackoff,
        retryDelay: queue?.retryDelay,
        retryDelayMax: queue?.retryDelayMax,
        expireInSeconds: queue?.expireInSeconds,
        heartbeatSeconds: queue?.heartbeatSeconds ?? null,
        deleteAfterSeconds: queue?.deleteAfterSeconds,
        deadLetter: queue?.deadLetter,
      }).toEqual({
        name,
        policy: row?.policy,
        retryLimit: 2,
        retryBackoff: true,
        retryDelay: row?.retryDelay,
        retryDelayMax: row?.retryDelayMax,
        expireInSeconds: row?.expireInSeconds,
        heartbeatSeconds: row?.heartbeatSeconds,
        deleteAfterSeconds: 86400,
        deadLetter: 'ops.dead',
      });
      const definition = registry.find((entry) => entry.name === name);
      expect({ name, ...definition?.work }).toEqual({
        name,
        localConcurrency: row?.localConcurrency,
        pollingIntervalSeconds: row?.pollingIntervalSeconds,
      });
      expect(workOptions.get(name)).toEqual({
        batchSize: 1,
        includeMetadata: true,
        localConcurrency: row?.localConcurrency,
        pollingIntervalSeconds: row?.pollingIntervalSeconds,
      });
    }
  });

  it('the retention schedules exist', async () => {
    const boss = await startBoss();
    try {
      await registerSchedules(boss, testLogger());
      const schedules = await boss.getSchedules();
      const retention = schedules
        .filter((schedule) => schedule.name === 'cleanup.retention')
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((schedule) => ({
          cron: schedule.cron,
          data: schedule.data,
          key: schedule.key,
          timezone: schedule.timezone,
          missed: schedule.options?.missed,
          singletonKey: schedule.options?.singletonKey,
        }));
      expect(retention).toEqual([
        {
          cron: '5 * * * *',
          data: { scope: 'hourly' },
          key: 'hourly',
          timezone: 'UTC',
          missed: 'skip',
          singletonKey: 'hourly',
        },
        {
          cron: '15 7 * * *',
          data: { scope: 'nightly' },
          key: 'nightly',
          timezone: 'UTC',
          missed: 'once',
          singletonKey: 'nightly',
        },
      ]);
      const others = schedules.filter((schedule) => schedule.name !== 'cleanup.retention');
      expect(others.map((schedule) => schedule.name).sort()).toEqual([
        'backup.check',
        'bundle.poll',
        'cost.check',
        'db.connections-check',
        'db.size-check',
        'field-reports.export',
        'ops.heartbeat',
        'score.issues',
      ]);
      for (const schedule of others) {
        expect(schedule.key).toBe('');
        expect(schedule.options?.singletonKey).toBeUndefined();
      }
    } finally {
      for (const entry of SCHEDULE_REGISTRY) {
        await boss.unschedule(entry.queue, entry.key);
      }
    }
  });

  it('a nightly retention run is not refused behind an hourly one', async () => {
    const boss = await startBoss();
    await boss.deleteQueue('cleanup.retention');
    await createQueues(boss, ['cleanup.retention'], testLogger());
    const hourly = await boss.send(
      'cleanup.retention',
      { scope: 'hourly' },
      { singletonKey: 'hourly' },
    );
    const nightly = await boss.send(
      'cleanup.retention',
      { scope: 'nightly' },
      { singletonKey: 'nightly' },
    );
    expect(hourly).not.toBeNull();
    expect(nightly).not.toBeNull();
    expect(
      await boss.send('cleanup.retention', { scope: 'hourly' }, { singletonKey: 'hourly' }),
    ).toBeNull();
    expect(await pendingCount('cleanup.retention')).toBe(2);
  });
});

describe('the bundle job queues and schedules', () => {
  it('the bundle and scoring queues have their options and dead-letter to ops.dead', async () => {
    // Written out, not read from QUEUE_OPTIONS, so a changed value fails here.
    const expected: Partial<
      Record<
        JobName,
        {
          policy: string;
          localConcurrency: number;
          retryDelay: number;
          retryDelayMax: number;
          expireInSeconds: number;
          heartbeatSeconds: number | null;
          pollingIntervalSeconds: number;
        }
      >
    > = {
      'bundle.poll': {
        policy: 'singleton',
        localConcurrency: 1,
        retryDelay: 60,
        retryDelayMax: 900,
        expireInSeconds: 300,
        heartbeatSeconds: null,
        pollingIntervalSeconds: 10,
      },
      'bundle.load': {
        policy: 'singleton',
        localConcurrency: 1,
        retryDelay: 300,
        retryDelayMax: 3600,
        expireInSeconds: 14400,
        heartbeatSeconds: 60,
        pollingIntervalSeconds: 5,
      },
      'bundle.revert': {
        policy: 'singleton',
        localConcurrency: 1,
        retryDelay: 300,
        retryDelayMax: 3600,
        expireInSeconds: 7200,
        heartbeatSeconds: 60,
        pollingIntervalSeconds: 5,
      },
      'score.issues': {
        policy: 'standard',
        localConcurrency: 1,
        retryDelay: 60,
        retryDelayMax: 900,
        expireInSeconds: 3600,
        heartbeatSeconds: 60,
        pollingIntervalSeconds: 5,
      },
    };
    const names = Object.keys(expected) as JobName[];
    const registry = QUEUE_REGISTRY.filter((definition) => names.includes(definition.name));
    expect(registry.map((definition) => definition.name).sort()).toEqual([...names].sort());

    const boss = await startBoss();
    for (const name of names) {
      await boss.deleteQueue(name);
    }
    const workOptions = new Map<string, unknown>();
    const record = (name: string, options: unknown): Promise<string> => {
      workOptions.set(name, options);
      return Promise.resolve(`fixture-worker-${name}`);
    };
    vi.spyOn(boss, 'work').mockImplementation(record);
    await registerQueues(boss, await runtimeFor(boss), registry);

    for (const name of names) {
      const row = expected[name];
      const queue = await boss.getQueue(name);
      expect({
        name,
        policy: queue?.policy,
        retryLimit: queue?.retryLimit,
        retryBackoff: queue?.retryBackoff,
        retryDelay: queue?.retryDelay,
        retryDelayMax: queue?.retryDelayMax,
        expireInSeconds: queue?.expireInSeconds,
        heartbeatSeconds: queue?.heartbeatSeconds ?? null,
        deleteAfterSeconds: queue?.deleteAfterSeconds,
        deadLetter: queue?.deadLetter,
      }).toEqual({
        name,
        policy: row?.policy,
        retryLimit: 2,
        retryBackoff: true,
        retryDelay: row?.retryDelay,
        retryDelayMax: row?.retryDelayMax,
        expireInSeconds: row?.expireInSeconds,
        heartbeatSeconds: row?.heartbeatSeconds,
        deleteAfterSeconds: 86400,
        deadLetter: 'ops.dead',
      });
      expect(workOptions.get(name)).toEqual({
        batchSize: 1,
        includeMetadata: true,
        localConcurrency: row?.localConcurrency,
        pollingIntervalSeconds: row?.pollingIntervalSeconds,
      });
    }
  });

  it('the bundle poll and weekly issue schedules exist after boot', async () => {
    const boss = await startBoss();
    try {
      await registerSchedules(boss, testLogger());
      const found = (await boss.getSchedules())
        .filter((schedule) => schedule.name === 'bundle.poll' || schedule.name === 'score.issues')
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((schedule) => ({
          name: schedule.name,
          cron: schedule.cron,
          data: schedule.data,
          key: schedule.key,
          timezone: schedule.timezone,
          missed: schedule.options?.missed,
          singletonKey: schedule.options?.singletonKey,
        }));
      expect(found).toEqual([
        {
          name: 'bundle.poll',
          cron: '*/15 * * * *',
          data: {},
          key: '',
          timezone: 'UTC',
          missed: 'skip',
          singletonKey: undefined,
        },
        {
          name: 'score.issues',
          cron: '30 12 * * 0',
          data: { scope: 'all' },
          key: '',
          timezone: 'UTC',
          missed: 'once',
          singletonKey: undefined,
        },
      ]);
    } finally {
      for (const entry of SCHEDULE_REGISTRY) {
        await boss.unschedule(entry.queue, entry.key);
      }
    }
  });
});

describe('the job test helpers', () => {
  it('runJob runs a handler with the test dependencies and reports each outcome', async () => {
    const clock = new FakeClock('2027-03-05T09:50:00.000Z');
    let seen: JobContext | null = null;
    const ok = definitionOf('cost.check', (_payload, ctx) => {
      seen = ctx;
      return Promise.resolve();
    });
    const done = await runJob(ok, {}, { clock, jobId: '0195d2c4-0000-7000-8000-000000000001' });
    expect(done.outcome).toBe('completed');
    expect(done.ctx).toBe(seen);
    expect(done.ctx.now().toISOString()).toBe('2027-03-05T09:50:00.000Z');
    expect(done.ctx.job).toMatchObject({
      id: '0195d2c4-0000-7000-8000-000000000001',
      name: 'cost.check',
      retryCount: 0,
      retryLimit: 2,
      isFinalAttempt: false,
      deadLetter: null,
    });
    expect(done.ctx.env.APP_ENV).toBe('ci');
    expect(done.ctx.env.captureMail).toBe(true);
    expect(done.ctx.mailer).toBe(done.mailer);
    expect(done.mailer).toBeInstanceOf(CaptureMailer);
    expect(done.logs.some((line) => line.parsed.event === 'job.done')).toBe(true);

    const final = await runJob(
      definitionOf('cost.check', () => Promise.reject(new FixtureFailure())),
      {},
      { retryCount: 2 },
    );
    expect(final.outcome).toBe('failed');
    expect(final.error).toBeInstanceOf(FixtureFailure);
    expect(final.ctx.job.isFinalAttempt).toBe(true);
    expect(lines('job.failed').at(-1)).toMatchObject({ level: 'error', attempt: 3 });

    const permanent = await runJob(
      definitionOf('cost.check', () => Promise.reject(new PermanentJobError())),
      {},
    );
    expect(permanent.outcome).toBe('permanent');
  });

  it('runJob never hands an invalid payload to the handler', async () => {
    let runs = 0;
    const alert = definitionOf('ops.alert', () => {
      runs += 1;
      return Promise.resolve();
    });
    const result = await runJob(alert, {
      kind: 'job_failed',
      values: { 'Bad-Key': 1 },
    });
    expect(result.outcome).toBe('permanent');
    expect(result.error).toBeInstanceOf(PermanentJobError);
    expect(runs).toBe(0);
    expect(lines('job.payload_invalid')).toHaveLength(1);
  });

  it('runQueued runs waiting jobs oldest first and peekQueue shows them unrun', async () => {
    const enqueue = createEnqueue(await createTestBoss());
    const first = await enqueue('ops.alert', {
      kind: 'job_failed',
      values: { queue: 'cost.check' },
    });
    const second = await enqueue(
      'ops.alert',
      { kind: 'dump_stale', values: { hoursSinceNewest: null } },
      { singletonKey: 'fixture-key' },
    );
    const waiting = await peekQueue('ops.alert');
    expect(waiting.map((job) => job.id)).toEqual([first, second]);
    expect(waiting[0]?.data).toEqual({ kind: 'job_failed', values: { queue: 'cost.check' } });
    expect(waiting[0]?.startAfter).toBeInstanceOf(Date);
    expect(waiting[1]?.singletonKey).toBe('fixture-key');

    const kinds: string[] = [];
    const alert = definitionOf('ops.alert', (payload) => {
      kinds.push(payload.kind);
      return payload.kind === 'dump_stale'
        ? Promise.reject(new FixtureFailure())
        : Promise.resolve();
    });
    const ran = await runQueued({ registry: [alert], max: 2 });
    expect(ran).toEqual([
      { name: 'ops.alert', id: first, outcome: 'completed' },
      { name: 'ops.alert', id: second, outcome: 'failed' },
    ]);
    expect(kinds).toEqual(['job_failed', 'dump_stale']);
    expect(await peekQueue('ops.alert')).toEqual([]);
  });

  it('runQueued refuses a queue with no handler', async () => {
    const enqueue = createEnqueue(await createTestBoss());
    await enqueue('cost.check', {});
    await expect(runQueued({ queues: ['cost.check'], registry: [] })).rejects.toThrow(
      'No handler is registered for the queue cost.check.',
    );
  });
});

describe('the database size and field-report export queues and schedules', () => {
  it('both queues have their options and dead-letter to ops.dead', async () => {
    // Written out, not read from QUEUE_OPTIONS, so a changed value fails here.
    const expected = {
      'db.size-check': { expireInSeconds: 120 },
      'field-reports.export': { expireInSeconds: 600 },
    } as const;
    const names = Object.keys(expected) as (keyof typeof expected)[];
    const registry = QUEUE_REGISTRY.filter((definition) =>
      (names as readonly string[]).includes(definition.name),
    );
    expect(registry.map((definition) => definition.name).sort()).toEqual([...names].sort());

    const boss = await startBoss();
    for (const name of names) {
      await boss.deleteQueue(name);
    }
    const workOptions = new Map<string, unknown>();
    const record = (name: string, options: unknown): Promise<string> => {
      workOptions.set(name, options);
      return Promise.resolve(`fixture-worker-${name}`);
    };
    vi.spyOn(boss, 'work').mockImplementation(record);
    await registerQueues(boss, await runtimeFor(boss), registry);

    for (const name of names) {
      const queue = await boss.getQueue(name);
      expect({
        name,
        policy: queue?.policy,
        retryLimit: queue?.retryLimit,
        retryBackoff: queue?.retryBackoff,
        retryDelay: queue?.retryDelay,
        retryDelayMax: queue?.retryDelayMax,
        expireInSeconds: queue?.expireInSeconds,
        heartbeatSeconds: queue?.heartbeatSeconds ?? null,
        deleteAfterSeconds: queue?.deleteAfterSeconds,
        deadLetter: queue?.deadLetter,
      }).toEqual({
        name,
        policy: 'stately',
        retryLimit: 2,
        retryBackoff: true,
        retryDelay: 300,
        retryDelayMax: 3600,
        expireInSeconds: expected[name].expireInSeconds,
        heartbeatSeconds: null,
        deleteAfterSeconds: 86400,
        deadLetter: 'ops.dead',
      });
      expect(workOptions.get(name)).toEqual({
        batchSize: 1,
        includeMetadata: true,
        localConcurrency: 1,
        pollingIntervalSeconds: 10,
      });
    }
  });

  it('the size check and export schedules exist after boot', async () => {
    const boss = await startBoss();
    try {
      await registerSchedules(boss, testLogger());
      const found = (await boss.getSchedules())
        .filter(
          (schedule) =>
            schedule.name === 'db.size-check' || schedule.name === 'field-reports.export',
        )
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((schedule) => ({
          name: schedule.name,
          cron: schedule.cron,
          data: schedule.data,
          key: schedule.key,
          timezone: schedule.timezone,
          missed: schedule.options?.missed,
          singletonKey: schedule.options?.singletonKey,
        }));
      expect(found).toEqual([
        {
          name: 'db.size-check',
          cron: '25 * * * *',
          data: {},
          key: '',
          timezone: 'UTC',
          missed: 'skip',
          singletonKey: undefined,
        },
        {
          name: 'field-reports.export',
          cron: '30 5 * * *',
          data: {},
          key: '',
          timezone: 'UTC',
          missed: 'once',
          singletonKey: undefined,
        },
      ]);
    } finally {
      for (const entry of SCHEDULE_REGISTRY) {
        await boss.unschedule(entry.queue, entry.key);
      }
    }
  });
});
