import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './accounts.ts';
import { offices } from './civic.ts';

/**
 * Every upload key the API issued: who may attach it, to what, and whether its object still
 * exists (T-uploads, D-064, D-248).
 */
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    purpose: text('purpose').notNull(),
    platform: text('platform').notNull(),
    contentType: text('content_type').notNull(),
    maxBytes: bigint('max_bytes', { mode: 'number' }).notNull(),
    declaredBytes: bigint('declared_bytes', { mode: 'number' }).notNull(),
    bytes: bigint('bytes', { mode: 'number' }),
    sha256: text('sha256'),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    objectDeletedAt: timestamp('object_deleted_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'uploads_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    unique('uploads_key_key').on(table.key),
    check('uploads_kind_check', sql`${table.kind} in ('photo', 'video')`),
    check(
      'uploads_purpose_check',
      sql`${table.purpose} in ('avatar', 'post', 'message', 'person_photo')`,
    ),
    check('uploads_platform_check', sql`${table.platform} in ('ios', 'android', 'web')`),
    check(
      'uploads_content_type_check',
      sql`${table.contentType} in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm')`,
    ),
    check('uploads_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    index('uploads_user').on(table.userId, table.id),
    index('uploads_unconsumed')
      .on(table.createdAt)
      .where(sql`${table.consumedAt} is null and ${table.objectDeletedAt} is null`),
  ],
);

export type UploadRow = typeof uploads.$inferSelect;
export type NewUploadRow = typeof uploads.$inferInsert;

/**
 * A user following a user, a person or an office (T-follows). `target_id` has no foreign key:
 * civic targets are never deleted, and the deletion job removes the follows of a deleted user.
 */
export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'follows_pkey',
      columns: [table.followerId, table.targetType, table.targetId],
    }),
    foreignKey({
      name: 'follows_follower_id_fkey',
      columns: [table.followerId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    check('follows_target_type_check', sql`${table.targetType} in ('user', 'person', 'office')`),
    check(
      'follows_not_self_check',
      sql`${table.targetType} <> 'user' or ${table.targetId} <> ${table.followerId}`,
    ),
    index('follows_target').on(
      table.targetType,
      table.targetId,
      table.createdAt.desc().nullsFirst(),
      table.followerId,
    ),
    index('follows_follower').on(table.followerId, table.createdAt.desc().nullsFirst()),
  ],
);

export type FollowRow = typeof follows.$inferSelect;
export type NewFollowRow = typeof follows.$inferInsert;

/** Offices a user saved quietly; private to the user (T-bookmarks). */
export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: uuid('user_id').notNull(),
    officeId: uuid('office_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'bookmarks_pkey', columns: [table.userId, table.officeId] }),
    foreignKey({
      name: 'bookmarks_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'bookmarks_office_id_fkey',
      columns: [table.officeId],
      foreignColumns: [offices.id],
    }).onDelete('cascade'),
    index('bookmarks_user').on(table.userId, table.createdAt.desc().nullsFirst()),
    index('bookmarks_office').on(table.officeId),
  ],
);

export type BookmarkRow = typeof bookmarks.$inferSelect;
export type NewBookmarkRow = typeof bookmarks.$inferInsert;

/**
 * A report of a wrong value on an office page, with an optional source link that is never
 * fetched (T-field_reports). The reporter's column is cleared when the account is deleted.
 */
export const fieldReports = pgTable(
  'field_reports',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id'),
    officeId: uuid('office_id').notNull(),
    field: text('field'),
    message: text('message'),
    sourceUrl: text('source_url'),
    status: text('status').notNull().default('open'),
    exportedAt: timestamp('exported_at', { withTimezone: true, mode: 'date' }),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'field_reports_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'field_reports_office_id_fkey',
      columns: [table.officeId],
      foreignColumns: [offices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'field_reports_decided_by_fkey',
      columns: [table.decidedBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    check('field_reports_status_check', sql`${table.status} in ('open', 'fixed', 'rejected')`),
    check('field_reports_source_url_check', sql`${table.sourceUrl} like 'https://%'`),
    index('field_reports_queue')
      .on(table.id)
      .where(sql`${table.status} = 'open'`),
    index('field_reports_office').on(table.officeId),
    index('field_reports_user').on(table.userId, table.id),
    index('field_reports_decided')
      .on(table.decidedAt)
      .where(sql`${table.decidedAt} is not null`),
  ],
);

export type FieldReportRow = typeof fieldReports.$inferSelect;
export type NewFieldReportRow = typeof fieldReports.$inferInsert;
