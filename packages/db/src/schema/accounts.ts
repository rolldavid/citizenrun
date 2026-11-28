import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, citext } from '../types.ts';
import { districts } from './geo.ts';
import { issues } from './reference.ts';

/** A person who signed up (T-users). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    handle: citext('handle'),
    name: text('name'),
    bio: text('bio'),
    bioHeld: boolean('bio_held').notNull().default(false),
    bioAiScreenStatus: text('bio_ai_screen_status'),
    link: text('link'),
    avatarKey: text('avatar_key'),
    avatarPendingKey: text('avatar_pending_key'),
    email: citext('email'),
    emailStatus: text('email_status').notNull().default('ok'),
    role: text('role').notNull().default('user'),
    status: text('status').notNull().default('active'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true, mode: 'date' }),
    suspendedReason: text('suspended_reason'),
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true, mode: 'date' }),
    ageMethod: text('age_method'),
    ageResult: text('age_result'),
    ageSourceTier: text('age_source_tier'),
    ageCheckedAt: timestamp('age_checked_at', { withTimezone: true, mode: 'date' }),
    onboardingStep: text('onboarding_step').notNull().default('photo'),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true, mode: 'date' }),
    dmPolicy: text('dm_policy').notNull().default('everyone'),
    tagPolicy: text('tag_policy').notNull().default('everyone'),
    personalize: boolean('personalize').notNull().default(true),
    locale: text('locale').notNull().default('en'),
    acceptsHelp: boolean('accepts_help').notNull().default(true),
    notificationSettings: jsonb('notification_settings')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    locationPrecision: text('location_precision'),
    districtsStaleAt: timestamp('districts_stale_at', { withTimezone: true, mode: 'date' }),
    handleChangedAt: timestamp('handle_changed_at', { withTimezone: true, mode: 'date' }),
    calendarTokenHash: text('calendar_token_hash'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('users_handle_key').on(table.handle),
    unique('users_email_key').on(table.email),
    unique('users_calendar_token_hash_key').on(table.calendarTokenHash),
    check('users_handle_check', sql`${table.handle}::text ~ '^[a-z0-9_.]{3,20}$'`),
    check('users_link_check', sql`${table.link} like 'https://%'`),
    check(
      'users_bio_ai_screen_status_check',
      sql`${table.bioAiScreenStatus} in ('ok', 'refused', 'error', 'budget')`,
    ),
    check(
      'users_email_status_check',
      sql`${table.emailStatus} in ('ok', 'bounced', 'complained', 'disabled')`,
    ),
    check('users_role_check', sql`${table.role} in ('user', 'admin')`),
    check('users_status_check', sql`${table.status} in ('active', 'suspended', 'deleting')`),
    check(
      'users_suspended_reason_check',
      sql`${table.suspendedReason} in ('content_policy', 'spam', 'impersonation', 'copyright', 'under_18', 'legal', 'other')`,
    ),
    check(
      'users_suspended_at_check',
      sql`${table.status} <> 'suspended' or ${table.suspendedAt} is not null`,
    ),
    check(
      'users_age_method_check',
      sql`${table.ageMethod} in ('store_signal', 'self_declared', 'none')`,
    ),
    check('users_age_result_check', sql`${table.ageResult} in ('adult')`),
    check(
      'users_age_source_tier_check',
      sql`${table.ageSourceTier} in ('confirmed', 'declared', 'self')`,
    ),
    check(
      'users_age_record_check',
      sql`case when ${table.ageMethod} is null then num_nulls(${table.ageResult}, ${table.ageSourceTier}, ${table.ageCheckedAt}) = 3 when ${table.ageMethod} = 'none' then ${table.ageResult} is null and ${table.ageSourceTier} is null and ${table.ageCheckedAt} is not null else num_nulls(${table.ageResult}, ${table.ageSourceTier}, ${table.ageCheckedAt}) = 0 end`,
    ),
    check(
      'users_onboarding_step_check',
      sql`${table.onboardingStep} in ('photo', 'handle', 'issues', 'location', 'done')`,
    ),
    check('users_dm_policy_check', sql`${table.dmPolicy} in ('everyone', 'following', 'none')`),
    check('users_tag_policy_check', sql`${table.tagPolicy} in ('everyone', 'following', 'none')`),
    check('users_locale_check', sql`${table.locale} ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    check('users_location_precision_check', sql`${table.locationPrecision} in ('exact', 'approx')`),
    index('users_handle_trgm').using('gin', sql`(${table.handle}::text) gin_trgm_ops`),
    index('users_name_trgm').using('gin', sql`lower(${table.name}) gin_trgm_ops`),
    index('users_not_active')
      .on(table.status, table.deletionRequestedAt)
      .where(sql`${table.status} <> 'active'`),
    index('users_bio_held')
      .on(table.id)
      .where(sql`${table.bioHeld}`),
    index('users_age_unset')
      .on(table.createdAt)
      .where(sql`${table.ageMethod} is null`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/** The sign-in methods attached to a user (T-auth_identities). */
export const authIdentities = pgTable(
  'auth_identities',
  {
    userId: uuid('user_id').notNull(),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    refreshTokenEnc: bytea('refresh_token_enc'),
    clientId: text('client_id'),
    isPrivateEmail: boolean('is_private_email'),
    email: citext('email'),
    emailVerified: boolean('email_verified'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'auth_identities_pkey', columns: [table.provider, table.subject] }),
    foreignKey({
      name: 'auth_identities_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    check('auth_identities_provider_check', sql`${table.provider} in ('email', 'apple', 'google')`),
    index('auth_identities_user').on(table.userId),
  ],
);

export type AuthIdentityRow = typeof authIdentities.$inferSelect;
export type NewAuthIdentityRow = typeof authIdentities.$inferInsert;

/** Pending email sign-in codes, one row per challenge (T-email_codes). */
export const emailCodes = pgTable(
  'email_codes',
  {
    id: uuid('id').primaryKey(),
    email: citext('email').notNull(),
    pendingTokenHash: text('pending_token_hash').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    sendCount: integer('send_count').notNull().default(1),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('email_codes_pending_token_hash_key').on(table.pendingTokenHash),
    index('email_codes_email').on(table.email, table.createdAt),
  ],
);

export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type NewEmailCodeRow = typeof emailCodes.$inferInsert;

/** Signed-in sessions for phones and the website (T-sessions). */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    platform: text('platform').notNull(),
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'sessions_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    unique('sessions_token_hash_key').on(table.tokenHash),
    check('sessions_platform_check', sql`${table.platform} in ('ios', 'android', 'web')`),
    index('sessions_user').on(table.userId),
    index('sessions_expires').on(table.expiresAt),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

/** Single-use sign-in secrets every API replica agrees on (T-auth_challenges). */
export const authChallenges = pgTable(
  'auth_challenges',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    secretHash: text('secret_hash').notNull(),
    userId: uuid('user_id'),
    sessionId: uuid('session_id'),
    platform: text('platform'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'auth_challenges_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'auth_challenges_session_id_fkey',
      columns: [table.sessionId],
      foreignColumns: [sessions.id],
    }).onDelete('cascade'),
    unique('auth_challenges_secret_hash_key').on(table.secretHash),
    check(
      'auth_challenges_kind_check',
      sql`${table.kind} in ('nonce', 'apple_handoff', 'ws_ticket')`,
    ),
    check('auth_challenges_platform_check', sql`${table.platform} in ('ios', 'android', 'web')`),
    check(
      'auth_challenges_session_id_check',
      sql`${table.sessionId} is null or ${table.kind} = 'ws_ticket'`,
    ),
    index('auth_challenges_expires').on(table.expiresAt),
    index('auth_challenges_session')
      .on(table.sessionId)
      .where(sql`${table.sessionId} is not null`),
  ],
);

export type AuthChallengeRow = typeof authChallenges.$inferSelect;
export type NewAuthChallengeRow = typeof authChallenges.$inferInsert;

/** What a user agreed to and which version of the document; append-only (T-user_consents). */
export const userConsents = pgTable(
  'user_consents',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    version: text('version').notNull(),
    granted: boolean('granted').notNull(),
    platform: text('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'user_consents_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    check(
      'user_consents_kind_check',
      sql`${table.kind} in ('terms', 'content_policy', 'privacy_policy', 'ai_screening')`,
    ),
    check('user_consents_platform_check', sql`${table.platform} in ('ios', 'android', 'web')`),
    index('user_consents_user').on(table.userId, table.kind, table.id.desc().nullsFirst()),
  ],
);

export type UserConsentRow = typeof userConsents.$inferSelect;
export type NewUserConsentRow = typeof userConsents.$inferInsert;

/** Handles held for 90 days after release or deletion, by keyed hash (T-reserved_handles). */
export const reservedHandles = pgTable(
  'reserved_handles',
  {
    handleHash: text('handle_hash').primaryKey(),
    reason: text('reason').notNull(),
    reservedUntil: timestamp('reserved_until', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('reserved_handles_reason_check', sql`${table.reason} in ('released', 'deleted')`),
    index('reserved_handles_until').on(table.reservedUntil),
  ],
);

export type ReservedHandleRow = typeof reservedHandles.$inferSelect;
export type NewReservedHandleRow = typeof reservedHandles.$inferInsert;

/** The issues a user picked, up to 3 starred; private to the user (T-user_issues). */
export const userIssues = pgTable(
  'user_issues',
  {
    userId: uuid('user_id').notNull(),
    issueId: text('issue_id').notNull(),
    starred: boolean('starred').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'user_issues_pkey', columns: [table.userId, table.issueId] }),
    foreignKey({
      name: 'user_issues_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_issues_issue_id_fkey',
      columns: [table.issueId],
      foreignColumns: [issues.id],
    }),
  ],
);

export type UserIssueRow = typeof userIssues.$inferSelect;
export type NewUserIssueRow = typeof userIssues.$inferInsert;

/**
 * The districts a user lives in: ids only, never the point or the address they came from; private
 * to the user (T-user_districts).
 */
export const userDistricts = pgTable(
  'user_districts',
  {
    userId: uuid('user_id').notNull(),
    districtId: uuid('district_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'user_districts_pkey', columns: [table.userId, table.districtId] }),
    foreignKey({
      name: 'user_districts_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_districts_district_id_fkey',
      columns: [table.districtId],
      foreignColumns: [districts.id],
    }).onDelete('cascade'),
    index('user_districts_district').on(table.districtId),
  ],
);

export type UserDistrictRow = typeof userDistricts.$inferSelect;
export type NewUserDistrictRow = typeof userDistricts.$inferInsert;

/** A user's export requests; the file is built by the worker (T-data_exports). */
export const dataExports = pgTable(
  'data_exports',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    status: text('status').notNull().default('queued'),
    objectKey: text('object_key'),
    readyAt: timestamp('ready_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'data_exports_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    check(
      'data_exports_status_check',
      sql`${table.status} in ('queued', 'ready', 'failed', 'expired')`,
    ),
    index('data_exports_user').on(table.userId, table.id.desc().nullsFirst()),
    index('data_exports_ready')
      .on(table.readyAt)
      .where(sql`${table.status} = 'ready'`),
  ],
);

export type DataExportRow = typeof dataExports.$inferSelect;
export type NewDataExportRow = typeof dataExports.$inferInsert;
