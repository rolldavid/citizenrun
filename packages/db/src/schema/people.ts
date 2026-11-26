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
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './accounts.ts';
import { elections, offices } from './civic.ts';

/**
 * A candidate or officeholder found in public records (T-people). `name_key` is computed by the
 * database (D-291); a claimed profile's owner column is cleared by its foreign key.
 */
export const people = pgTable(
  'people',
  {
    id: uuid('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    firstName: text('first_name'),
    middleName: text('middle_name'),
    lastName: text('last_name'),
    suffix: text('suffix'),
    nameKey: text('name_key').generatedAlwaysAs(sql`os_name_key(first_name, last_name)`),
    party: text('party'),
    photoKey: text('photo_key'),
    photoCredit: text('photo_credit'),
    photoLicense: text('photo_license'),
    photoSourceUrl: text('photo_source_url'),
    photoWidth: integer('photo_width'),
    photoHeight: integer('photo_height'),
    photoPendingKey: text('photo_pending_key'),
    website: text('website'),
    donateUrl: text('donate_url'),
    volunteerUrl: text('volunteer_url'),
    pendingLinks: jsonb('pending_links').$type<Record<string, unknown>>(),
    claimedBy: uuid('claimed_by'),
    origin: jsonb('origin').$type<Record<string, unknown>>(),
    rosterOnly: boolean('roster_only').notNull().default(false),
    overrides: jsonb('overrides').$type<Record<string, unknown>>().notNull().default({}),
    mergedInto: uuid('merged_into'),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'people_claimed_by_fkey',
      columns: [table.claimedBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'people_merged_into_fkey',
      columns: [table.mergedInto],
      foreignColumns: [table.id],
    }),
    unique('people_source_key_key').on(table.sourceKey),
    unique('people_slug_key').on(table.slug),
    check(
      'people_slug_check',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 120`,
    ),
    check('people_party_check', sql`${table.party} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('people_website_check', sql`${table.website} like 'https://%'`),
    check('people_donate_url_check', sql`${table.donateUrl} like 'https://%'`),
    check('people_volunteer_url_check', sql`${table.volunteerUrl} like 'https://%'`),
    check('people_photo_source_url_check', sql`${table.photoSourceUrl} like 'https://%'`),
    index('people_name_trgm').using('gin', table.name.op('gin_trgm_ops')),
    index('people_name_key_trgm').using('gin', table.nameKey.op('gin_trgm_ops')),
    index('people_last_name').on(sql`lower(${table.lastName})`),
    uniqueIndex('people_one_owner')
      .on(table.claimedBy)
      .where(sql`${table.claimedBy} is not null`),
    index('people_photo_key')
      .on(table.photoKey)
      .where(sql`${table.photoKey} is not null`),
    index('people_pending_links')
      .on(table.id)
      .where(sql`${table.pendingLinks} is not null`),
  ],
);

export type PersonRow = typeof people.$inferSelect;
export type NewPersonRow = typeof people.$inferInsert;

/** Other names a person has filed or served under (T-person_aliases). */
export const personAliases = pgTable(
  'person_aliases',
  {
    personId: uuid('person_id').notNull(),
    alias: text('alias').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'person_aliases_pkey', columns: [table.personId, table.alias] }),
    foreignKey({
      name: 'person_aliases_person_id_fkey',
      columns: [table.personId],
      foreignColumns: [people.id],
    }).onDelete('cascade'),
    index('person_aliases_trgm').using('gin', table.alias.op('gin_trgm_ops')),
  ],
);

export type PersonAliasRow = typeof personAliases.$inferSelect;
export type NewPersonAliasRow = typeof personAliases.$inferInsert;

/** Nickname pairs for the filing matcher (D-291). Both columns are lower-case and unaccented. */
export const givenNameAliases = pgTable(
  'given_name_aliases',
  {
    canonical: text('canonical').notNull(),
    alias: text('alias').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'given_name_aliases_pkey', columns: [table.canonical, table.alias] }),
    check(
      'given_name_aliases_source_check',
      sql`${table.source} in ('nicknames', 'supplement', 'admin')`,
    ),
    index('given_name_aliases_alias').on(table.alias),
  ],
);

export type GivenNameAliasRow = typeof givenNameAliases.$inferSelect;
export type NewGivenNameAliasRow = typeof givenNameAliases.$inferInsert;

/** Who holds, or held, each seat of an office (T-officeholders). */
export const officeholders = pgTable(
  'officeholders',
  {
    id: uuid('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    officeId: uuid('office_id').notNull(),
    personId: uuid('person_id').notNull(),
    seatLabel: text('seat_label'),
    since: date('since', { mode: 'string' }),
    until: date('until', { mode: 'string' }),
    seatUpNext: boolean('seat_up_next'),
    termLimited: boolean('term_limited'),
    notRunning: boolean('not_running'),
    cashOnHandCents: bigint('cash_on_hand_cents', { mode: 'number' }),
    cashAsOf: date('cash_as_of', { mode: 'string' }),
    cashSourceUrl: text('cash_source_url'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'officeholders_office_id_fkey',
      columns: [table.officeId],
      foreignColumns: [offices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'officeholders_person_id_fkey',
      columns: [table.personId],
      foreignColumns: [people.id],
    }),
    unique('officeholders_source_key_key').on(table.sourceKey),
    check('officeholders_cash_source_url_check', sql`${table.cashSourceUrl} like 'https://%'`),
    index('officeholders_office').on(table.officeId),
    index('officeholders_person').on(table.personId),
  ],
);

export type OfficeholderRow = typeof officeholders.$inferSelect;
export type NewOfficeholderRow = typeof officeholders.$inferInsert;

/** A person's filing for an office in an election (T-candidacies). Never deleted. */
export const candidacies = pgTable(
  'candidacies',
  {
    id: uuid('id').primaryKey(),
    filingKey: text('filing_key').notNull(),
    source: text('source').notNull(),
    personId: uuid('person_id').notNull(),
    electionId: uuid('election_id').notNull(),
    party: text('party'),
    status: text('status').notNull(),
    statusHistory: jsonb('status_history').$type<unknown[]>().notNull().default([]),
    filedOn: date('filed_on', { mode: 'string' }),
    rawName: text('raw_name').notNull(),
    firstName: text('first_name'),
    middleName: text('middle_name'),
    lastName: text('last_name'),
    suffix: text('suffix'),
    nameKey: text('name_key').generatedAlwaysAs(sql`os_name_key(first_name, last_name)`),
    sourceUrl: text('source_url'),
    matchConfidence: numeric('match_confidence'),
    overrides: jsonb('overrides').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'candidacies_person_id_fkey',
      columns: [table.personId],
      foreignColumns: [people.id],
    }),
    foreignKey({
      name: 'candidacies_election_id_fkey',
      columns: [table.electionId],
      foreignColumns: [elections.id],
    }).onDelete('cascade'),
    unique('candidacies_filing_key_key').on(table.filingKey),
    unique('candidacies_person_election_key')
      .on(table.personId, table.electionId, table.party)
      .nullsNotDistinct(),
    check(
      'candidacies_status_check',
      sql`${table.status} in ('committee_registered', 'filed', 'qualified', 'on_ballot', 'advanced', 'withdrawn', 'disqualified', 'won', 'lost')`,
    ),
    check('candidacies_party_check', sql`${table.party} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('candidacies_match_confidence_check', sql`${table.matchConfidence} between 0 and 1`),
    check('candidacies_source_url_check', sql`${table.sourceUrl} like 'https://%'`),
    index('candidacies_election').on(table.electionId, table.createdAt.desc().nullsFirst()),
    index('candidacies_created').on(table.createdAt.desc().nullsFirst()),
  ],
);

export type CandidacyRow = typeof candidacies.$inferSelect;
export type NewCandidacyRow = typeof candidacies.$inferInsert;

/** Every filing key resolved to a candidacy, with what its source last said (T-candidacy_filings). */
export const candidacyFilings = pgTable(
  'candidacy_filings',
  {
    filingKey: text('filing_key').primaryKey(),
    candidacyId: uuid('candidacy_id').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull(),
    sourceUrl: text('source_url'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    goneAt: timestamp('gone_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'candidacy_filings_candidacy_id_fkey',
      columns: [table.candidacyId],
      foreignColumns: [candidacies.id],
    }).onDelete('cascade'),
    check(
      'candidacy_filings_status_check',
      sql`${table.status} in ('committee_registered', 'filed', 'qualified', 'on_ballot', 'advanced', 'withdrawn', 'disqualified', 'won', 'lost')`,
    ),
    check('candidacy_filings_source_url_check', sql`${table.sourceUrl} like 'https://%'`),
    index('candidacy_filings_candidacy').on(table.candidacyId),
    index('candidacy_filings_source')
      .on(table.source)
      .where(sql`${table.goneAt} is null`),
  ],
);

export type CandidacyFilingRow = typeof candidacyFilings.$inferSelect;
export type NewCandidacyFilingRow = typeof candidacyFilings.$inferInsert;

/**
 * Filing rows and certified-result names the matcher could not place, for the admin queue
 * (T-unmatched_filings). `raw` holds only the allow-listed fields (D-084).
 */
export const unmatchedFilings = pgTable(
  'unmatched_filings',
  {
    id: uuid('id').primaryKey(),
    filingKey: text('filing_key').notNull(),
    kind: text('kind').notNull().default('filing'),
    source: text('source').notNull(),
    state: char('state', { length: 2 }),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    reason: text('reason'),
    suggested: jsonb('suggested').$type<unknown[]>(),
    features: jsonb('features').$type<Record<string, unknown>>(),
    resolution: text('resolution'),
    officeId: uuid('office_id'),
    personId: uuid('person_id'),
    decidedBy: uuid('decided_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'unmatched_filings_office_id_fkey',
      columns: [table.officeId],
      foreignColumns: [offices.id],
    }),
    foreignKey({
      name: 'unmatched_filings_person_id_fkey',
      columns: [table.personId],
      foreignColumns: [people.id],
    }),
    foreignKey({
      name: 'unmatched_filings_decided_by_fkey',
      columns: [table.decidedBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    unique('unmatched_filings_filing_key_key').on(table.filingKey),
    check('unmatched_filings_kind_check', sql`${table.kind} in ('filing', 'result')`),
    check(
      'unmatched_filings_resolution_check',
      sql`${table.resolution} in ('matched', 'created', 'rejected')`,
    ),
    index('unmatched_filings_open')
      .on(table.id)
      .where(sql`${table.resolvedAt} is null`),
  ],
);

export type UnmatchedFilingRow = typeof unmatchedFilings.$inferSelect;
export type NewUnmatchedFilingRow = typeof unmatchedFilings.$inferInsert;
