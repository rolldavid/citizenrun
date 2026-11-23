import type { Logger } from '@citizenrun/shared';
import { PgBoss } from 'pg-boss';
import { classNameOrNull, errorClassOf } from './jobs/types.ts';

// D-138: pg-boss's own pool of 10, beside the app pool.
const BOSS_POOL_MAX = 10;
const BOSS_APPLICATION_NAME = 'worker';

/** Where a job fetched from ops.dead came from: its queue, its job id and its error class. */
export type DeadLetterSource = { queue: string; jobId: string; errorClass: string };

/**
 * The fields of a dead-lettered job that name its source. pg-boss 12 keeps them in the job's
 * metadata (`fetch` or `work` with `includeMetadata: true`), not in its data.
 */
export type DeadLetterJob = {
  sourceName?: string | null;
  sourceId?: string | null;
  sourceOutput?: unknown;
};

/**
 * The worker's one PgBoss (D-238): supervision and schedules on unless turned off, no migration
 * (the migration runner owns the schema, D-141), and an `error` listener that logs the error class
 * only, since an unhandled `error` event would crash the process. Opens no connection until started.
 */
export function createBoss(input: {
  connectionString: string;
  logger: Logger;
  supervise?: boolean;
  schedule?: boolean;
  max?: number;
}): PgBoss {
  const boss = new PgBoss({
    connectionString: input.connectionString,
    max: input.max ?? BOSS_POOL_MAX,
    supervise: input.supervise ?? true,
    schedule: input.schedule ?? true,
    migrate: false,
    application_name: BOSS_APPLICATION_NAME,
  });
  boss.on('error', (error: unknown) => {
    input.logger.error('boss.error', { errorClass: errorClassOf(error) });
  });
  return boss;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const found: unknown = Reflect.get(value, key);
  return found;
}

/**
 * The source of a job fetched from ops.dead with `includeMetadata: true`, or null when pg-boss gave
 * no source queue or job id. The error class is the stored error's `name`, falling back to its
 * `message` (the handler wrapper stores the class in both), else `Error`; never the message text.
 */
export function deadLetterSource(job: DeadLetterJob): DeadLetterSource | null {
  const queue = job.sourceName;
  const jobId = job.sourceId;
  if (typeof queue !== 'string' || queue === '' || typeof jobId !== 'string' || jobId === '') {
    return null;
  }
  const stored = job.sourceOutput;
  const errorClass =
    classNameOrNull(field(stored, 'name')) ?? classNameOrNull(field(stored, 'message')) ?? 'Error';
  return { queue, jobId, errorClass };
}
