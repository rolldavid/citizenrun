import { workerHeartbeats } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { sql } from 'drizzle-orm';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';

// The one row the worker keeps in worker_heartbeats (T-worker_heartbeats).
const WORKER_ROW = 'worker';

/** When this process started, to the millisecond. */
export function processStartedAt(): Date {
  return new Date(Math.round(performance.timeOrigin));
}

/**
 * Upserts the worker's one heartbeat row with the beat time, the process start time and the
 * deployed commit (null when unknown), so `/readyz` sees a live worker (D-145).
 */
export async function writeHeartbeat(
  db: Db,
  input: { beatAt: Date; startedAt: Date; version: string | null },
): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values({
      worker: WORKER_ROW,
      beatAt: input.beatAt,
      startedAt: input.startedAt,
      version: input.version,
    })
    .onConflictDoUpdate({
      target: workerHeartbeats.worker,
      set: {
        beatAt: sql`excluded.beat_at`,
        startedAt: sql`excluded.started_at`,
        version: sql`excluded.version`,
      },
    });
}

/** J-ops.heartbeat: one beat a minute at the job clock's time (D-145). */
export const opsHeartbeatJob: JobDefinition<'ops.heartbeat'> = {
  name: 'ops.heartbeat',
  queue: QUEUE_OPTIONS['ops.heartbeat'].queue,
  work: QUEUE_OPTIONS['ops.heartbeat'].work,
  async handle(_payload, ctx) {
    await writeHeartbeat(ctx.db, {
      beatAt: ctx.now(),
      startedAt: processStartedAt(),
      version: ctx.env.RAILWAY_GIT_COMMIT_SHA,
    });
  },
};
