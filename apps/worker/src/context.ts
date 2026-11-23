import type { Db, Enqueue } from '@citizenrun/db';
import type { JobName, Logger, Mailer } from '@citizenrun/shared';
import type { DeadLetterSource } from './boss.ts';
import type { WorkerEnv } from './env.ts';
import type { Bucket } from './lib/storage.ts';

/** What a handler receives beside its payload. */
export type JobContext = {
  job: {
    id: string;
    name: JobName;
    retryCount: number;
    retryLimit: number;
    createdOn: Date;
    isFinalAttempt: boolean;
    /** Set from deadLetterSource(job) for jobs on ops.dead; null elsewhere. */
    deadLetter: DeadLetterSource | null;
  };
  /** The clock; tests inject a fixed one. */
  now(): Date;
  /** Aborted at shutdown, when the drain's time is up. */
  signal: AbortSignal;
  /** The worker's logger with `job` and `jobId` on every line. */
  log: Logger;
  /** The app pool (D-138). */
  db: Db;
  enqueue: Enqueue;
  storage: { backups: Bucket };
  mailer: Mailer;
  env: WorkerEnv;
  /** Keeps a long job alive; handlers call it once per batch of work. */
  touch(): Promise<void>;
};

/** The process-wide dependencies every job context is built from. */
export type WorkerRuntime = {
  env: WorkerEnv;
  logger: Logger;
  db: Db;
  enqueue: Enqueue;
  storage: { backups: Bucket };
  mailer: Mailer;
  clock: { now(): Date };
  abort: AbortController;
};

/** The context of one job run; `isFinalAttempt` is `retryCount >= retryLimit`. */
export function createJobContext(
  runtime: WorkerRuntime,
  job: {
    id: string;
    name: JobName;
    retryCount: number;
    retryLimit: number;
    createdOn: Date;
    deadLetter: DeadLetterSource | null;
  },
  touch: () => Promise<void>,
): JobContext {
  return {
    job: { ...job, isFinalAttempt: job.retryCount >= job.retryLimit },
    now: () => runtime.clock.now(),
    signal: runtime.abort.signal,
    log: runtime.logger.child({ job: job.name, jobId: job.id }),
    db: runtime.db,
    enqueue: runtime.enqueue,
    storage: runtime.storage,
    mailer: runtime.mailer,
    env: runtime.env,
    touch,
  };
}
