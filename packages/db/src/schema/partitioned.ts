import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// The partitioned tables, declared for typing only (D-237). They and their month partitions are
// created in SQL migrations; `schema/index.ts` never re-exports this file, so `drizzle-kit
// generate` never emits or diffs them.

/** A flat object of small scalars; never text a user typed. */
export type AppEventProps = Record<string, string | number | boolean | null>;

/** The general product event log, partitioned by month of `created_at` (T-app_events). */
export const appEvents = pgTable(
  'app_events',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity(),
    userId: uuid('user_id'),
    name: text('name').notNull(),
    props: jsonb('props').$type<AppEventProps>().notNull().default({}),
    platform: text('platform'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'app_events_pkey', columns: [table.createdAt, table.id] }),
    check('app_events_platform_check', sql`${table.platform} in ('ios', 'android', 'web')`),
    index('app_events_user').on(table.userId, table.createdAt),
    index('app_events_name').on(table.name, table.createdAt),
  ],
);

export type AppEventRow = typeof appEvents.$inferSelect;
export type NewAppEventRow = typeof appEvents.$inferInsert;
