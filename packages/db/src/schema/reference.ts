import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { tsvector } from '../types.ts';

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

/**
 * The legal powers that connect issues to offices (T-powers). A migration copies `id`, `name` and
 * `description` from `data/powers.yaml`; `phrases` and `search` are written only by the bundle
 * load (D-292).
 */
export const powers = pgTable(
  'powers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    phrases: text('phrases')
      .array()
      .notNull()
      .default(sql`'{}'`),
    search: tsvector('search'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('powers_id_check', sql`${table.id} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    index('powers_search').using('gin', table.search),
  ],
);

export type PowerRow = typeof powers.$inferSelect;
export type NewPowerRow = typeof powers.$inferInsert;

/** Which powers move which issue (T-issue_powers). Rows come only from a migration. */
export const issuePowers = pgTable(
  'issue_powers',
  {
    issueId: text('issue_id').notNull(),
    powerId: text('power_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'issue_powers_pkey', columns: [table.issueId, table.powerId] }),
    foreignKey({
      name: 'issue_powers_issue_id_fkey',
      columns: [table.issueId],
      foreignColumns: [issues.id],
    }),
    foreignKey({
      name: 'issue_powers_power_id_fkey',
      columns: [table.powerId],
      foreignColumns: [powers.id],
    }),
    index('issue_powers_power').on(table.powerId, table.issueId),
  ],
);

export type IssuePowerRow = typeof issuePowers.$inferSelect;
export type NewIssuePowerRow = typeof issuePowers.$inferInsert;

/**
 * The kinds of elected office (T-office_types). Rows come only from the migration that copies
 * `data/office-types.yaml`; ids are frozen once released.
 */
export const officeTypes = pgTable(
  'office_types',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    level: text('level').notNull(),
    illustration: text('illustration').notNull(),
    electorate: text('electorate').notNull().default('public'),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('office_types_id_check', sql`${table.id} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      'office_types_level_check',
      sql`${table.level} in ('local', 'county', 'state', 'federal', 'special')`,
    ),
    check(
      'office_types_electorate_check',
      sql`${table.electorate} in ('public', 'members', 'party')`,
    ),
  ],
);

export type OfficeTypeRow = typeof officeTypes.$inferSelect;
export type NewOfficeTypeRow = typeof officeTypes.$inferInsert;
