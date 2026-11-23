import { createDb, createPool } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import type { WorkerEnv } from '../env.ts';

/** The `pg` pool type, as `@citizenrun/db` makes it. */
export type Pool = ReturnType<typeof createPool>;

// D-138: the worker's handlers share at most 10 database connections, beside pg-boss's own 10.
const WORKER_POOL_MAX = 10;
const WORKER_APPLICATION_NAME = 'worker';

/** The worker's app pool on `DATABASE_URL`. Opens no connection itself. */
export function createWorkerPool(env: WorkerEnv): Pool {
  return createPool(env.DATABASE_URL, {
    max: WORKER_POOL_MAX,
    applicationName: WORKER_APPLICATION_NAME,
  });
}

/** The worker's Drizzle database over `pool`. */
export function createWorkerDb(pool: Pool): Db {
  return createDb(pool);
}
