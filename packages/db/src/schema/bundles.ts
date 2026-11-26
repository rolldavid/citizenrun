import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/** The history of bundle loads with their counts and gate results (T-data_bundles). */
export const dataBundles = pgTable(
  'data_bundles',
  {
    id: uuid('id').primaryKey(),
    version: text('version').notNull(),
    kind: text('kind').notNull().default('full'),
    status: text('status').notNull(),
    stats: jsonb('stats').$type<Record<string, unknown>>(),
    loadedAt: timestamp('loaded_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('data_bundles_version_key').on(table.version),
    check('data_bundles_kind_check', sql`${table.kind} in ('full', 'filings')`),
    check(
      'data_bundles_status_check',
      sql`${table.status} in ('loading', 'loaded', 'rejected', 'held', 'reverted')`,
    ),
    index('data_bundles_loaded')
      .on(table.kind, table.loadedAt.desc().nullsFirst())
      .where(sql`${table.status} = 'loaded'`),
  ],
);

export type DataBundleRow = typeof dataBundles.$inferSelect;
export type NewDataBundleRow = typeof dataBundles.$inferInsert;

/** The prior values a load replaced, so a revert can restore them (T-bundle_changes). */
export const bundleChanges = pgTable(
  'bundle_changes',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    bundleId: uuid('bundle_id').notNull(),
    tableName: text('table_name').notNull(),
    rowKey: jsonb('row_key').$type<Record<string, string>>().notNull(),
    op: text('op').notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'bundle_changes_bundle_id_fkey',
      columns: [table.bundleId],
      foreignColumns: [dataBundles.id],
    }).onDelete('cascade'),
    check('bundle_changes_op_check', sql`${table.op} in ('insert', 'update', 'retire', 'delete')`),
    index('bundle_changes_bundle').on(table.bundleId, table.tableName),
  ],
);

export type BundleChangeRow = typeof bundleChanges.$inferSelect;
export type NewBundleChangeRow = typeof bundleChanges.$inferInsert;
