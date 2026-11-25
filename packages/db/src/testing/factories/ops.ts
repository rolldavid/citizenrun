import { newId } from '@citizenrun/shared';
import type { Db } from '../../client.ts';
import { clientErrors, rateLimits, usageCounters, workerHeartbeats } from '../../schema/ops.ts';
import type {
  ClientErrorInsert,
  ClientErrorRow,
  NewRateLimitRow,
  NewUsageCounterRow,
  RateLimitRow,
  UsageCounterRow,
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

/** The overrides of the RateCounter factory: `key` and `windowStart` are required. */
export type RateCounterOverrides = Partial<NewRateLimitRow> &
  Pick<NewRateLimitRow, 'key' | 'windowStart'>;

/** A `rate_limits` counter at 1 for the key and window the test states. */
export function makeRateCounter(overrides: RateCounterOverrides): NewRateLimitRow {
  return { count: 1, ...overrides };
}

/** Writes makeRateCounter(overrides) and returns the stored row. */
export async function insertRateCounter(
  db: Db,
  overrides: RateCounterOverrides,
): Promise<RateLimitRow> {
  const [row] = await db.insert(rateLimits).values(makeRateCounter(overrides)).returning();
  if (row === undefined) {
    throw new Error('The rate_limits insert returned no row.');
  }
  return row;
}

/** The overrides of the UsageCounter factory: `name` and `period` are required. */
export type UsageCounterOverrides = Partial<NewUsageCounterRow> &
  Pick<NewUsageCounterRow, 'name' | 'period'>;

/** A `usage_counters` row at 1 for the name and period the test states. */
export function makeUsageCounter(overrides: UsageCounterOverrides): NewUsageCounterRow {
  return { count: 1, ...overrides };
}

/** Writes makeUsageCounter(overrides) and returns the stored row. */
export async function insertUsageCounter(
  db: Db,
  overrides: UsageCounterOverrides,
): Promise<UsageCounterRow> {
  const [row] = await db.insert(usageCounters).values(makeUsageCounter(overrides)).returning();
  if (row === undefined) {
    throw new Error('The usage_counters insert returned no row.');
  }
  return row;
}
