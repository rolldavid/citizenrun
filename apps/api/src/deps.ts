import type { Db } from '@citizenrun/db';
import type { Clock, Logger, Mailer } from '@citizenrun/shared';
import type { BucketHandle } from '@citizenrun/shared/storage';
import type { PgBoss } from 'pg-boss';

/** What the API's routes, middleware and services take from outside (D-452). */
export type Deps = {
  db: Db;
  queue: PgBoss;
  storage: BucketHandle;
  mailer: Mailer;
  clock: Clock;
  logger: Logger;
};
