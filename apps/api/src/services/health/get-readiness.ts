import { max, sql } from 'drizzle-orm';
import { workerHeartbeats } from '@citizenrun/db';
import type { ReadyzResponse } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';

/** How long the database check may take. */
export const READYZ_DB_TIMEOUT_MS = 2_000; // E-WEB-02
/** A heartbeat older than this reports the worker as stale. */
export const WORKER_STALE_AFTER_MS = 300_000; // D-145: five minutes
// The answer is bounded even when the pool cannot connect, which can take far longer than the
// statement timeout to fail.
const READYZ_RACE_MARGIN_MS = 500;

const DOWN: ReadyzResponse = { db: 'down', worker: 'unknown' };
const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

/** The database check took longer than its bound. */
class ReadinessTimeoutError extends Error {
  override readonly name = 'ReadinessTimeoutError';

  constructor() {
    super('The readiness check timed out.');
  }
}

function errorClassOf(error: unknown): string {
  return error instanceof Error && ERROR_CLASS_PATTERN.test(error.name) ? error.name : 'Error';
}

// The one database check: the newest heartbeat, under a statement timeout local to the
// transaction. worker_heartbeats holds one row, so the query needs no index.
async function newestHeartbeat(deps: Deps): Promise<Date | null> {
  return deps.db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('statement_timeout', ${String(READYZ_DB_TIMEOUT_MS)}, true)`,
    );
    const [row] = await tx.select({ beatAt: max(workerHeartbeats.beatAt) }).from(workerHeartbeats);
    return row?.beatAt ?? null;
  });
}

function withinBound<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ReadinessTimeoutError());
    }, ms);
  });
  // A check that loses the race settles later; its result is dropped.
  work.catch(() => undefined);
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * E-WEB-02 (D-024, D-145): 503 with the down body while draining or when the database check fails
 * or times out; otherwise 200, with `worker` stale when the newest heartbeat is missing or more
 * than five minutes before `now`. A stale worker never changes the status.
 */
export async function getReadiness(
  deps: Deps,
  now: Date,
): Promise<{ status: 200 | 503; body: ReadyzResponse }> {
  if (deps.lifecycle.isDraining()) {
    return { status: 503, body: DOWN };
  }
  let beatAt: Date | null;
  try {
    beatAt = await withinBound(newestHeartbeat(deps), READYZ_DB_TIMEOUT_MS + READYZ_RACE_MARGIN_MS);
  } catch (error) {
    // The class only: a connection or database error's text can name the host or the user.
    deps.logger.warn('readyz.db_down', { errorClass: errorClassOf(error) });
    return { status: 503, body: DOWN };
  }
  const stale = beatAt === null || now.getTime() - beatAt.getTime() > WORKER_STALE_AFTER_MS;
  return { status: 200, body: { db: 'ok', worker: stale ? 'stale' : 'ok' } };
}
