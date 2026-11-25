import { waitForDatabase, withEmailCounters } from '@citizenrun/db';
import type { Db, Enqueue } from '@citizenrun/db';
import type { Clock, Logger, Mailer } from '@citizenrun/shared';
import type { BucketHandle } from '@citizenrun/shared/storage';
import type { ApiEnv } from './env.ts';
import { createApiDb, createApiPool } from './lib/db.ts';
import { createLifecycle } from './lib/lifecycle.ts';
import type { Lifecycle } from './lib/lifecycle.ts';
import { createMailer } from './lib/mailer.ts';
import { createApiQueue } from './lib/queue.ts';
import { createMediaBucket } from './lib/storage.ts';

export type { Clock } from '@citizenrun/shared';

/** The service's clock: the only `new Date()` without an argument in the API. */
export const systemClock: Clock = { now: () => new Date() };

/** What the API's routes, middleware and services take from outside (D-452). */
export type Deps = {
  env: ApiEnv;
  db: Db;
  queue: { enqueue: Enqueue };
  storage: { media: BucketHandle };
  mailer: Mailer;
  clock: Clock;
  logger: Logger;
  lifecycle: Lifecycle;
};

/** The dependencies of a running service, with the one call that releases them. */
export type ApiRuntime = Deps & { close(): Promise<void> };

/**
 * Builds the running service's dependencies from its environment: the pool and database, the
 * send-only queue, the media bucket, the mailer, the clock, the given logger and the drain state.
 * Waits for the database before the queue starts (D-140), for `databaseWaitMs` or the helper's own
 * window; when it gives up, the pool is ended and DatabaseUnavailableError is rethrown.
 * `close()` stops the queue, then ends the pool.
 */
export async function createDeps(
  env: ApiEnv,
  logger: Logger,
  options: { databaseWaitMs?: number } = {},
): Promise<ApiRuntime> {
  const pool = createApiPool(env);
  const db = createApiDb(pool);
  let queue: Awaited<ReturnType<typeof createApiQueue>>;
  try {
    await waitForDatabase(
      pool,
      options.databaseWaitMs === undefined ? {} : { timeoutMs: options.databaseWaitMs },
    );
    queue = await createApiQueue(env, logger);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return {
    env,
    db,
    queue: { enqueue: queue.enqueue },
    storage: { media: createMediaBucket(env) },
    mailer: withEmailCounters(createMailer(env, logger), db, systemClock, logger),
    clock: systemClock,
    logger,
    lifecycle: createLifecycle(),
    close: async () => {
      await queue.stop();
      await pool.end();
    },
  };
}
