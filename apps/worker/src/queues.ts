import { JOB_PAYLOADS } from '@citizenrun/shared';
import type { JobName, JobPayload, Logger } from '@citizenrun/shared';
import type { JobWithMetadata, PgBoss, Queue, UpdateQueueOptions } from 'pg-boss';
import type { z } from 'zod';
import { deadLetterSource } from './boss.ts';
import { createJobContext } from './context.ts';
import type { JobContext, WorkerRuntime } from './context.ts';
import { accountDelete } from './jobs/account/delete.ts';
import { accountExport } from './jobs/account/export.ts';
import { bundleLoad } from './jobs/bundle/load.ts';
import { bundlePoll } from './jobs/bundle/poll.ts';
import { bundleRevert } from './jobs/bundle/revert.ts';
import { cleanupRetention } from './jobs/cleanup/retention.ts';
import { uploadsCleanup } from './jobs/cleanup/uploads-cleanup.ts';
import { mediaProcessImage } from './jobs/media/process-image.ts';
import { notifyEmail } from './jobs/notify/email.ts';
import { opsAlertJob } from './jobs/ops/alert.ts';
import { backupCheckJob } from './jobs/ops/backup-check.ts';
import { connectionsCheckJob } from './jobs/ops/connections-check.ts';
import { costCheckJob } from './jobs/ops/cost-check.ts';
import { opsDeadJob } from './jobs/ops/dead.ts';
import { opsHeartbeatJob } from './jobs/ops/heartbeat.ts';
import { scoreIssues } from './jobs/score/issues.ts';
import { JobFailedError, PermanentJobError, errorClassOf } from './jobs/types.ts';
import type { AnyJobDefinition, JobDefinition, QueueOptions } from './jobs/types.ts';
import { QUEUE_OPTIONS } from './queue-options.ts';

/** One cron schedule: registered at boot in UTC, removed at boot once it leaves the registry. */
export type ScheduleEntry = {
  id: string;
  queue: JobName;
  cron: string;
  data: Readonly<Record<string, string>>;
  key: string;
  missed: 'skip' | 'once';
};

/** Every queue the worker works, one job definition each. */
export const QUEUE_REGISTRY: readonly AnyJobDefinition[] = [
  opsDeadJob,
  opsAlertJob,
  opsHeartbeatJob,
  backupCheckJob,
  connectionsCheckJob,
  costCheckJob,
  accountDelete,
  accountExport,
  cleanupRetention,
  uploadsCleanup,
  mediaProcessImage,
  notifyEmail,
  bundlePoll,
  bundleLoad,
  bundleRevert,
  scoreIssues,
];

/** Every schedule, crons in UTC; nothing else calls pg-boss `schedule`. */
export const SCHEDULE_REGISTRY: readonly ScheduleEntry[] = [
  // Every 60 seconds (D-145).
  {
    id: 'S-ops.heartbeat',
    queue: 'ops.heartbeat',
    cron: '* * * * *',
    data: {},
    key: '',
    missed: 'skip',
  },
  // After the 08:00 dump and its 30-minute limit (D-144, D-028).
  {
    id: 'S-backup.check',
    queue: 'backup.check',
    cron: '30 9 * * *',
    data: {},
    key: '',
    missed: 'once',
  },
  // Daily (D-138).
  {
    id: 'S-db.connections-check',
    queue: 'db.connections-check',
    cron: '40 9 * * *',
    data: {},
    key: '',
    missed: 'once',
  },
  // Daily (D-405).
  {
    id: 'S-cost.check',
    queue: 'cost.check',
    cron: '50 9 * * *',
    data: {},
    key: '',
    missed: 'once',
  },
  // Hourly rules (D-240). The key is also the singleton key, so a queued hourly run never
  // refuses the nightly one.
  {
    id: 'S-cleanup.retention.hourly',
    queue: 'cleanup.retention',
    cron: '5 * * * *',
    data: { scope: 'hourly' },
    key: 'hourly',
    missed: 'skip',
  },
  // Nightly, with one catch-up run after downtime (D-238).
  {
    id: 'S-cleanup.retention.nightly',
    queue: 'cleanup.retention',
    cron: '15 7 * * *',
    data: { scope: 'nightly' },
    key: 'nightly',
    missed: 'once',
  },
  // Every 15 minutes; the next tick comes soon, so a missed one is skipped.
  {
    id: 'S-bundle.poll',
    queue: 'bundle.poll',
    cron: '*/15 * * * *',
    data: {},
    key: '',
    missed: 'skip',
  },
  // Weekly full rebuild, after a migration changes issue_powers.
  {
    id: 'S-score.issues.weekly',
    queue: 'score.issues',
    cron: '30 12 * * 0',
    data: { scope: 'all' },
    key: '',
    missed: 'once',
  },
];

/** Options only tests pass, so retries and polls finish in seconds. */
export type RegisterOverrides = {
  retryBackoff?: false;
  retryDelay?: number;
  pollingIntervalSeconds?: number;
};

/** What `work` calls with each batch of one job, fetched with its metadata. */
export type WorkHandler = (jobs: JobWithMetadata<unknown>[]) => Promise<void>;

/** How one run of a handler ended. */
export type JobOutcome = { outcome: 'completed' | 'permanent' | 'failed'; error: unknown };

const DEAD_LETTER_QUEUE = 'ops.dead' satisfies JobName;

/** A queue that exists with a policy other than its registry row's; the worker does not start (D-827). */
export class QueuePolicyMismatchError extends Error {
  override readonly name = 'QueuePolicyMismatchError';

  constructor() {
    super('A queue exists with a policy other than its registry row.');
  }
}

// pg-boss accepts a cap on the delay only with backoff, which only a test override turns off.
function createOptions(options: QueueOptions, overrides: RegisterOverrides): Omit<Queue, 'name'> {
  const retryBackoff = overrides.retryBackoff ?? options.retryBackoff;
  return {
    policy: options.policy,
    retryLimit: options.retryLimit,
    retryDelay: overrides.retryDelay ?? options.retryDelay,
    retryBackoff,
    ...(retryBackoff ? { retryDelayMax: options.retryDelayMax } : {}),
    expireInSeconds: options.expireInSeconds,
    deleteAfterSeconds: options.deleteAfterSeconds,
    ...(options.heartbeatSeconds === null ? {} : { heartbeatSeconds: options.heartbeatSeconds }),
    ...(options.deadLetter === null ? {} : { deadLetter: options.deadLetter }),
  };
}

// pg-boss 12 cannot change a queue's policy after creation; every other option is applied, and a
// null heartbeat or dead letter clears the queue's.
function updateOptions(options: QueueOptions, overrides: RegisterOverrides): UpdateQueueOptions {
  const retryBackoff = overrides.retryBackoff ?? options.retryBackoff;
  return {
    retryLimit: options.retryLimit,
    retryDelay: overrides.retryDelay ?? options.retryDelay,
    retryBackoff,
    retryDelayMax: retryBackoff ? options.retryDelayMax : null,
    expireInSeconds: options.expireInSeconds,
    deleteAfterSeconds: options.deleteAfterSeconds,
    heartbeatSeconds: options.heartbeatSeconds,
    deadLetter: options.deadLetter,
  };
}

/**
 * Creates each queue with its QUEUE_OPTIONS, ops.dead first because a queue's dead letter must
 * exist before the queue names it; a queue that exists is updated, so a changed option takes effect.
 * pg-boss fixes a policy when the queue is created, so a queue that exists with another policy is
 * logged as `queue.policy_mismatch` and refused with QueuePolicyMismatchError (D-827).
 */
export async function createQueues(
  boss: PgBoss,
  names: readonly JobName[],
  logger: Logger,
  overrides: RegisterOverrides = {},
): Promise<void> {
  const ordered: JobName[] = [
    DEAD_LETTER_QUEUE,
    ...new Set(names.filter((name) => name !== DEAD_LETTER_QUEUE)),
  ];
  for (const name of ordered) {
    const options = QUEUE_OPTIONS[name].queue;
    const existing = await boss.getQueue(name);
    if (existing === null) {
      await boss.createQueue(name, createOptions(options, overrides));
      continue;
    }
    const found = existing.policy ?? 'standard';
    if (found !== options.policy) {
      logger.error('queue.policy_mismatch', { queue: name, expected: options.policy, found });
      throw new QueuePolicyMismatchError();
    }
    await boss.updateQueue(name, updateOptions(options, overrides));
  }
}

// The zod issue paths of a payload that failed its schema, as dotted strings; never the values.
function issuePathsOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.map(String).join('.'));
}

/**
 * Runs one job's handler as the worker does: parses the payload with its schema (a failure is
 * permanent and logged with the issue paths only), calls `handle`, and logs `job.done` or
 * `job.failed` through `ctx.log`, which carries `job` and `jobId`. Never logs the payload or an
 * error message. Never throws.
 */
export async function executeJob<N extends JobName>(
  definition: JobDefinition<N>,
  data: unknown,
  ctx: JobContext,
): Promise<JobOutcome> {
  const started = performance.now();
  const attempt = ctx.job.retryCount + 1;
  const schema: z.ZodType = JOB_PAYLOADS[definition.name];
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    ctx.log.warn('job.payload_invalid', { issuePaths: issuePathsOf(parsed.error) });
    return {
      outcome: 'permanent',
      error: new PermanentJobError('The payload does not match its schema.'),
    };
  }
  try {
    await definition.handle(parsed.data as JobPayload<N>, ctx); // the schema of definition.name parsed it
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const errorClass = errorClassOf(error);
    if (error instanceof PermanentJobError) {
      ctx.log.warn('job.failed', { attempt, durationMs, errorClass, permanent: true });
      return { outcome: 'permanent', error };
    }
    if (ctx.job.isFinalAttempt) {
      ctx.log.error('job.failed', { attempt, durationMs, errorClass });
    } else {
      ctx.log.warn('job.failed', { attempt, durationMs, errorClass });
    }
    return { outcome: 'failed', error };
  }
  ctx.log.info('job.done', { attempt, durationMs: Math.round(performance.now() - started) });
  return { outcome: 'completed', error: null };
}

/**
 * The handler `work` runs for a definition: builds each job's context (with its dead-letter source
 * on ops.dead), runs it through executeJob, and on a retryable failure throws JobFailedError, whose
 * name and message are the error class, so pg-boss stores no provider or database text (CTL-26).
 * pg-boss 12's `work` also refreshes a running job's heartbeat on its own; `touch` refreshes it at
 * once through `boss.touch`, fenced to this attempt.
 */
export function wrapHandler(
  definition: AnyJobDefinition,
  runtime: WorkerRuntime,
  boss: PgBoss,
): WorkHandler {
  return async (jobs) => {
    for (const job of jobs) {
      const touch = async (): Promise<void> => {
        await boss.touch(definition.name, { id: job.id, retryCount: job.retryCount });
      };
      const ctx = createJobContext(
        runtime,
        {
          id: job.id,
          name: definition.name,
          retryCount: job.retryCount,
          retryLimit: job.retryLimit,
          createdOn: job.createdOn,
          deadLetter: definition.name === DEAD_LETTER_QUEUE ? deadLetterSource(job) : null,
        },
        touch,
      );
      const result = await executeJob(definition, job.data, ctx);
      if (result.outcome === 'failed') {
        throw new JobFailedError(errorClassOf(result.error));
      }
    }
  };
}

/**
 * Creates every queue of `registry` (default QUEUE_REGISTRY) and subscribes each handler with one
 * job per batch and the job's metadata.
 */
export async function registerQueues(
  boss: PgBoss,
  runtime: WorkerRuntime,
  registry: readonly AnyJobDefinition[] = QUEUE_REGISTRY,
  overrides: RegisterOverrides = {},
): Promise<void> {
  await createQueues(
    boss,
    registry.map((definition) => definition.name),
    runtime.logger,
    overrides,
  );
  for (const definition of registry) {
    await boss.work(
      definition.name,
      {
        batchSize: 1,
        includeMetadata: true,
        localConcurrency: definition.work.localConcurrency,
        pollingIntervalSeconds:
          overrides.pollingIntervalSeconds ?? definition.work.pollingIntervalSeconds,
      },
      wrapHandler(definition, runtime, boss),
    );
  }
}

/**
 * Registers every schedule of `registry` (default SCHEDULE_REGISTRY) in UTC, with the schedule's key
 * as the singleton key when it is not '', then removes every schedule not in the registry.
 */
export async function registerSchedules(
  boss: PgBoss,
  logger: Logger,
  registry: readonly ScheduleEntry[] = SCHEDULE_REGISTRY,
): Promise<void> {
  for (const entry of registry) {
    await boss.schedule(
      entry.queue,
      entry.cron,
      { ...entry.data },
      {
        tz: 'UTC',
        key: entry.key,
        missed: entry.missed,
        ...(entry.key === '' ? {} : { singletonKey: entry.key }),
      },
    );
  }
  const wanted = new Set(registry.map((entry) => JSON.stringify([entry.queue, entry.key])));
  for (const schedule of await boss.getSchedules()) {
    if (!wanted.has(JSON.stringify([schedule.name, schedule.key]))) {
      await boss.unschedule(schedule.name, schedule.key);
      logger.info('schedule.removed', { queue: schedule.name, key: schedule.key });
    }
  }
}
