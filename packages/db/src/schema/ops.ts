import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
