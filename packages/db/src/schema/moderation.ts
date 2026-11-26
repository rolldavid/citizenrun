import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The audit log of every admin write (T-admin_actions). `admin_id` has no foreign key, so an
 * admin's deleted account does not erase the log; the nil id marks a row with no admin request
 * behind it.
 */
export const adminActions = pgTable(
  'admin_actions',
  {
    id: uuid('id').primaryKey(),
    adminId: uuid('admin_id').notNull(),
    action: text('action').notNull(),
    target: jsonb('target').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_actions_admin').on(table.adminId, table.id.desc().nullsFirst()),
    index('admin_actions_target').on(
      sql`(${table.target} ->> 'type')`,
      sql`(${table.target} ->> 'id')`,
    ),
  ],
);

export type AdminActionRow = typeof adminActions.$inferSelect;
export type NewAdminActionRow = typeof adminActions.$inferInsert;
