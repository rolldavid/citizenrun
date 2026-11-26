import type { Db, Enqueue } from '@citizenrun/db';
import type { JobName, Logger, Mailer } from '@citizenrun/shared';
import { loadKeyRing } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import type { DeadLetterSource } from './boss.ts';
import type { WorkerEnv } from './env.ts';
import { createOutboundFetch } from './lib/outbound-fetch.ts';
import type { OutboundFetch } from './lib/outbound-fetch.ts';
import { createWorkerBuckets } from './lib/storage.ts';
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
  /** `media` is the MEDIA_* bucket; `data` the DATA_* bucket the pipeline publishes bundles to. */
  storage: { backups: Bucket; media: Bucket; data: Bucket };
  mailer: Mailer;
  /** The key ring of APP_SECRET and APP_SECRET_PREVIOUS, built once at boot (CTL-07). */
  keys: KeyRing;
  /** The worker's outbound fetch (INV-39), built once at boot; tests pass a fake. */
  outbound: OutboundFetch;
  env: WorkerEnv;
  /** Keeps a long job alive; handlers call it once per batch of work. */
  touch(): Promise<void>;
};

/**
 * The process-wide dependencies every job context is built from. `main.ts` and the test harness
 * give `storage.media`, `storage.data`, `keys` and `outbound`; a runtime without one of them gets
 * it built once from its `env`, as `main.ts` builds it.
 */
export type WorkerRuntime = {
  env: WorkerEnv;
  logger: Logger;
  db: Db;
  enqueue: Enqueue;
  storage: { backups: Bucket; media?: Bucket; data?: Bucket };
  mailer: Mailer;
  keys?: KeyRing;
  outbound?: OutboundFetch;
  clock: { now(): Date };
  abort: AbortController;
};

type RuntimeExtras = { media: Bucket; data: Bucket; keys: KeyRing; outbound: OutboundFetch };

// Built at most once per runtime object, so a job never rebuilds a client or the key ring.
const builtExtras = new WeakMap<WorkerRuntime, RuntimeExtras>();

function extrasOf(runtime: WorkerRuntime): RuntimeExtras {
  const { media, data } = runtime.storage;
  const { keys, outbound } = runtime;
  if (media !== undefined && data !== undefined && keys !== undefined && outbound !== undefined) {
    return { media, data, keys, outbound };
  }
  let built = builtExtras.get(runtime);
  if (built === undefined) {
    // The env's buckets are built at most once, and only when one is missing.
    let fromEnv: ReturnType<typeof createWorkerBuckets> | null = null;
    const envBuckets = (): ReturnType<typeof createWorkerBuckets> =>
      (fromEnv ??= createWorkerBuckets(runtime.env));
    built = {
      media: media ?? envBuckets().media,
      data: data ?? envBuckets().data,
      keys: keys ?? loadKeyRing(runtime.env.APP_SECRET, runtime.env.APP_SECRET_PREVIOUS),
      outbound: outbound ?? createOutboundFetch(runtime.env),
    };
    builtExtras.set(runtime, built);
  }
  return built;
}

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
  const extras = extrasOf(runtime);
  return {
    job: { ...job, isFinalAttempt: job.retryCount >= job.retryLimit },
    now: () => runtime.clock.now(),
    signal: runtime.abort.signal,
    log: runtime.logger.child({ job: job.name, jobId: job.id }),
    db: runtime.db,
    enqueue: runtime.enqueue,
    storage: { backups: runtime.storage.backups, media: extras.media, data: extras.data },
    mailer: runtime.mailer,
    keys: extras.keys,
    outbound: extras.outbound,
    env: runtime.env,
    touch,
  };
}
