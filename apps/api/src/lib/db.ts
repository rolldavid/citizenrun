import { createDb, createPool } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import type { ApiEnv } from '../env.ts';

/** The `pg` pool type, as `@citizenrun/db` makes it. */
export type Pool = ReturnType<typeof createPool>;

// D-138: each API replica holds at most 10 database connections for its own queries.
const API_POOL_MAX = 10;
const API_APPLICATION_NAME = 'api';

/** The API's `pg` pool on `DATABASE_URL`. Opens no connection itself. */
export function createApiPool(env: ApiEnv): Pool {
  return createPool(env.DATABASE_URL, {
    max: API_POOL_MAX,
    applicationName: API_APPLICATION_NAME,
  });
}

/** The API's Drizzle database over `pool`. */
export function createApiDb(pool: Pool): Db {
  return createDb(pool);
}
