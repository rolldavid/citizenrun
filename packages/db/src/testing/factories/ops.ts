import { newId } from '@citizenrun/shared';
import type { Db } from '../../client.ts';
import { clientErrors, workerHeartbeats } from '../../schema/ops.ts';
import type {
  ClientErrorInsert,
  ClientErrorRow,
  WorkerHeartbeatInsert,
  WorkerHeartbeatRow,
} from '../../schema/ops.ts';
import { idAt } from '../ids.ts';

/** A complete `client_errors` row with fixture values; `id` follows `createdAt` when it is given. */
export function makeClientError(overrides: Partial<ClientErrorInsert> = {}): ClientErrorInsert {
  const { createdAt } = overrides;
  return {
    id: createdAt === undefined ? newId() : idAt(createdAt),
    name: 'TypeError',
    code: 'fixture_error',
    route: '/fixture',
    component: 'FixtureScreen',
    appVersion: '1.0.0',
    platform: 'web',
    frames: [{ file: 'fixture.ts', line: 1, column: 1 }],
    requestId: null,
    ...overrides,
  };
}

/** Writes makeClientError(overrides) and returns the stored row. */
export async function insertClientError(
  db: Db,
  overrides: Partial<ClientErrorInsert> = {},
): Promise<ClientErrorRow> {
  const [row] = await db.insert(clientErrors).values(makeClientError(overrides)).returning();
  if (row === undefined) {
    throw new Error('The client_errors insert returned no row.');
  }
  return row;
}

// The current time to the second, so a stored timestamp compares equal to the value written.
function nowToTheSecond(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

/** A complete `worker_heartbeats` row: worker `worker`, beat and start now (to the second). */
export function makeWorkerHeartbeat(
  overrides: Partial<WorkerHeartbeatInsert> = {},
): WorkerHeartbeatInsert {
  const now = nowToTheSecond();
  return {
    worker: 'worker',
    beatAt: now,
    startedAt: now,
    version: null,
    ...overrides,
  };
}

/** Writes makeWorkerHeartbeat(overrides) and returns the stored row. */
export async function insertWorkerHeartbeat(
  db: Db,
  overrides: Partial<WorkerHeartbeatInsert> = {},
): Promise<WorkerHeartbeatRow> {
  const [row] = await db
    .insert(workerHeartbeats)
    .values(makeWorkerHeartbeat(overrides))
    .returning();
  if (row === undefined) {
    throw new Error('The worker_heartbeats insert returned no row.');
  }
  return row;
}
