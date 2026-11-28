import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './accounts.ts';

/** One stack frame of a client error report: the file, line and column, nothing else. */
export type ClientErrorFrame = { file: string; line: number; column: number };

/**
 * Client error reports with a fixed schema and no user id (T-client_errors). No free-text
 * message, state, input or URL is stored.
 */
export const clientErrors = pgTable(
  'client_errors',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    route: text('route'),
    component: text('component'),
    appVersion: text('app_version').notNull(),
    platform: text('platform').notNull(),
    frames: jsonb('frames').$type<readonly ClientErrorFrame[]>().notNull().default([]),
    requestId: uuid('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('client_errors_platform_check', sql`platform in ('ios', 'android', 'web')`),
    index('client_errors_created').on(table.createdAt),
  ],
);

/** Days a client error report is kept; the cleanup deletes older rows. */
export const CLIENT_ERRORS_RETENTION_DAYS = 14; // INV-32, T-client_errors

export type ClientErrorRow = typeof clientErrors.$inferSelect;
export type ClientErrorInsert = typeof clientErrors.$inferInsert;

/** The worker's heartbeat, one row updated in place, read by `/readyz` (T-worker_heartbeats, D-145). */
export const workerHeartbeats = pgTable('worker_heartbeats', {
  worker: text('worker').primaryKey(),
  beatAt: timestamp('beat_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  version: text('version'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type WorkerHeartbeatRow = typeof workerHeartbeats.$inferSelect;
export type WorkerHeartbeatInsert = typeof workerHeartbeats.$inferInsert;

/**
 * Fixed-window rate-limit counters per user and per client address (T-rate_limits, D-240). The
 * table is unlogged with fillfactor 70 and `key` sorts in byte order (collate "C"); those three
 * properties are written only in the SQL migration.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
    count: integer('count').notNull(),
  },
  (table) => [
    primaryKey({ name: 'rate_limits_pkey', columns: [table.key, table.windowStart] }),
    index('rate_limits_window').on(table.windowStart),
  ],
);

export type RateLimitRow = typeof rateLimits.$inferSelect;
export type NewRateLimitRow = typeof rateLimits.$inferInsert;

/**
 * Counters for caps on outside services and the daily spend projection (T-usage_counters).
 * `period` is the first day of the month for a monthly counter and the day itself for a daily one,
 * both in UTC.
 */
export const usageCounters = pgTable(
  'usage_counters',
  {
    name: text('name').notNull(),
    period: date('period', { mode: 'string' }).notNull(),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: 'usage_counters_pkey', columns: [table.name, table.period] })],
);

export type UsageCounterRow = typeof usageCounters.$inferSelect;
export type NewUsageCounterRow = typeof usageCounters.$inferInsert;

/**
 * Per-state rules that change without a release: sign-up, its age method and the candidate-facing
 * tools (T-state_rules). The migration inserts the 56 state-level codes with the column defaults.
 */
export const stateRules = pgTable(
  'state_rules',
  {
    state: char('state', { length: 2 }).primaryKey(),
    signup: text('signup').notNull().default('allow'),
    ageMethod: text('age_method').notNull().default('store_signal_or_none'),
    candidateTools: boolean('candidate_tools').notNull().default(true),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'state_rules_updated_by_fkey',
      columns: [table.updatedBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    check('state_rules_state_check', sql`${table.state} ~ '^[A-Z]{2}$'`),
    check('state_rules_signup_check', sql`${table.signup} in ('allow', 'withhold')`),
    check(
      'state_rules_age_method_check',
      sql`${table.ageMethod} in ('store_signal_required', 'store_signal_or_dob', 'store_signal_or_none')`,
    ),
  ],
);

export type StateRuleRow = typeof stateRules.$inferSelect;
export type NewStateRuleRow = typeof stateRules.$inferInsert;
