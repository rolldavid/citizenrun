import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './accounts.ts';

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
