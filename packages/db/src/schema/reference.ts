import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

/**
 * The 19 issues a user can pick (T-issues). Rows come only from the migration that copies
 * `data/issues.yaml`; ids are frozen once released.
 */
export const issues = pgTable(
  'issues',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    colorLight: text('color_light').notNull(),
    colorDark: text('color_dark').notNull(),
    icon: text('icon').notNull(),
    sort: integer('sort').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('issues_id_check', sql`${table.id} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    unique('issues_sort_key').on(table.sort),
  ],
);

export type IssueRow = typeof issues.$inferSelect;
export type NewIssueRow = typeof issues.$inferInsert;
