import { createEnqueue } from '@citizenrun/db';
import type { Enqueue } from '@citizenrun/db';
import type { Logger } from '@citizenrun/shared';
import { PgBoss } from 'pg-boss';
import type { ApiEnv } from '../env.ts';

// D-238: the API only sends, through a pool of at most 3 connections.
const API_QUEUE_POOL_MAX = 3;
// D-024: the queue's share of the drain, inside the API's hard stop.
const API_QUEUE_STOP_TIMEOUT_MS = 5000;

const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

function errorClassOf(error: unknown): string {
  if (error instanceof Error && ERROR_CLASS_PATTERN.test(error.name)) {
    return error.name;
  }
  return 'Error';
}

/**
 * The API's send-only pg-boss (D-238): no supervision, no schedules and no migration (the
 * migration runner owns the schema, D-141). It never creates a queue, works a job or schedules one.
 */
export async function createApiQueue(
  env: ApiEnv,
  logger: Logger,
): Promise<{ boss: PgBoss; enqueue: Enqueue; stop(): Promise<void> }> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    supervise: false,
    schedule: false,
    migrate: false,
    max: API_QUEUE_POOL_MAX,
    application_name: 'api',
  });
  // An unhandled `error` event would crash the process; only the class is logged.
  boss.on('error', (error: unknown) => {
    logger.error('boss.error', { errorClass: errorClassOf(error) });
  });
  await boss.start();
  return {
    boss,
    enqueue: createEnqueue(boss),
    // pg-boss 12's stop() resolves once the instance has stopped; it has no `wait` option.
    stop: async () => {
      await boss.stop({ graceful: true, timeout: API_QUEUE_STOP_TIMEOUT_MS });
    },
  };
}
