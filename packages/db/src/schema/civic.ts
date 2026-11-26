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
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
import { tsvector } from '../types.ts';
import { districts, jurisdictions } from './geo.ts';
import { issues, officeTypes, powers } from './reference.ts';

/**
 * One elected position, or one multi-seat body elected at large (T-offices). Every fact column
 * is null until a source gives it (A17). `search` is written only through L-office-search.
 */
export const offices = pgTable(
  'offices',
  {
    id: uuid('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    slug: text('slug').notNull(),
    tileId: bigint('tile_id', { mode: 'number' }).generatedAlwaysAsIdentity({
      maxValue: 9007199254740991,
    }),
    jurisdictionId: uuid('jurisdiction_id').notNull(),
    districtId: uuid('district_id').notNull(),
    officeTypeId: text('office_type_id').notNull(),
    state: char('state', { length: 2 }).notNull(),
    title: text('title').notNull(),
    placeholder: boolean('placeholder').notNull().default(false),
    seats: integer('seats').notNull().default(1),
    bodySize: integer('body_size'),
    seatsUpNext: integer('seats_up_next'),
    vacantSeatsUpNext: integer('vacant_seats_up_next'),
    termYears: numeric('term_years'),
    termLimitTerms: integer('term_limit_terms'),
    partisan: boolean('partisan'),
    partySelection: text('party_selection'),
    electorate: integer('electorate'),
    payAnnualCents: bigint('pay_annual_cents', { mode: 'number' }),
    payKind: text('pay_kind'),
    payAmountCents: bigint('pay_amount_cents', { mode: 'number' }),
    payPeriod: text('pay_period'),
    payChangeNote: text('pay_change_note'),
    benefits: text('benefits').array(),
    hoursPerWeek: numeric('hours_per_week'),
    fullTime: boolean('full_time'),
    meetingTimes: text('meeting_times').array(),
    fitsDayJob: text('fits_day_job'),
    filingFeeCents: bigint('filing_fee_cents', { mode: 'number' }),
    signaturesRequired: integer('signatures_required'),
    whereToFile: text('where_to_file'),
    eligibility: jsonb('eligibility').$type<unknown[]>(),
    scale: numeric('scale'),
    pivot: numeric('pivot'),
    termFactor: numeric('term_factor'),
    ease: numeric('ease'),
    easeInputs: jsonb('ease_inputs').$type<unknown[]>(),
    easeConfidence: text('ease_confidence'),
    entrenched: boolean('entrenched'),
    decidedIn: text('decided_in'),
    votesToWin: integer('votes_to_win'),
    votesLow: integer('votes_low'),
    votesHigh: integer('votes_high'),
    votesEstimated: boolean('votes_estimated'),
    effort: jsonb('effort').$type<Record<string, unknown>>(),
    rankBase: numeric('rank_base'),
    nextElectionId: uuid('next_election_id'),
    nextFilingDeadline: date('next_filing_deadline', { mode: 'string' }),
    completeness: text('completeness'),
    fieldMeta: jsonb('field_meta').$type<Record<string, unknown>>().notNull().default({}),
    overrides: jsonb('overrides').$type<Record<string, unknown>>().notNull().default({}),
    search: tsvector('search'),
    changedAt: timestamp('changed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  // The return type is written out because offices and elections reference each other.
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'offices_jurisdiction_id_fkey',
      columns: [table.jurisdictionId],
      foreignColumns: [jurisdictions.id],
    }),
    foreignKey({
      name: 'offices_district_id_fkey',
      columns: [table.districtId],
      foreignColumns: [districts.id],
    }),
    foreignKey({
      name: 'offices_office_type_id_fkey',
      columns: [table.officeTypeId],
      foreignColumns: [officeTypes.id],
    }),
    foreignKey({
      name: 'offices_next_election_id_fkey',
      columns: [table.nextElectionId],
      foreignColumns: [elections.id],
    }).onDelete('set null'),
    unique('offices_source_key_key').on(table.sourceKey),
    unique('offices_slug_key').on(table.slug),
    unique('offices_tile_id_key').on(table.tileId),
    check(
      'offices_slug_check',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) <= 120`,
    ),
    check('offices_state_check', sql`${table.state} ~ '^[A-Z]{2}$'`),
    check('offices_seats_check', sql`${table.seats} >= 1`),
    check('offices_seats_up_next_check', sql`${table.seatsUpNext} <= ${table.bodySize}`),
    check(
      'offices_vacant_seats_up_next_check',
      sql`${table.vacantSeatsUpNext} >= 0 and ${table.vacantSeatsUpNext} <= ${table.seatsUpNext}`,
    ),
    check(
      'offices_party_selection_check',
      sql`${table.partySelection} in ('primary_ballot', 'caucus', 'party_meeting')`,
    ),
    check(
      'offices_pay_kind_check',
      sql`${table.payKind} in ('salary', 'stipend', 'per_meeting', 'none')`,
    ),
    check('offices_pay_period_check', sql`${table.payPeriod} in ('year', 'month', 'meeting')`),
    check(
      'offices_benefits_check',
      sql`${table.benefits} <@ array['health', 'retirement', 'other']::text[]`,
    ),
    check(
      'offices_meeting_times_check',
      sql`${table.meetingTimes} <@ array['daytime', 'evenings', 'weekends']::text[]`,
    ),
    check('offices_fits_day_job_check', sql`${table.fitsDayJob} in ('yes', 'likely', 'no')`),
    check('offices_ease_check', sql`${table.ease} between 0 and 100`),
    check(
      'offices_ease_confidence_check',
      sql`${table.easeConfidence} in ('high', 'medium', 'low')`,
    ),
    check('offices_decided_in_check', sql`${table.decidedIn} in ('primary', 'general')`),
    check(
      'offices_completeness_check',
      sql`${table.completeness} in ('complete', 'partial', 'minimal')`,
    ),
    index('offices_search').using('gin', table.search),
    index('offices_title_trgm').using('gin', table.title.op('gin_trgm_ops')),
    index('offices_district').on(table.districtId),
    index('offices_jurisdiction').on(table.jurisdictionId),
    index('offices_office_type').on(table.officeTypeId),
    index('offices_state_rank')
      .on(table.state, table.rankBase.desc().nullsLast(), table.id)
      .where(sql`${table.retiredAt} is null`),
    index('offices_state_spt')
      .on(
        table.state,
        sql`(${table.scale} * ${table.pivot} * ${table.termFactor}) desc nulls last`,
        table.id,
      )
      .where(sql`${table.retiredAt} is null`),
    index('offices_state_ease')
      .on(table.state, table.ease.desc().nullsLast(), table.id)
      .where(sql`${table.retiredAt} is null`),
    index('offices_state_pay')
      .on(table.state, table.payAnnualCents.desc().nullsLast(), table.id)
      .where(sql`${table.retiredAt} is null`),
    index('offices_state_deadline')
      .on(table.state, table.nextFilingDeadline, table.id)
      .where(sql`${table.retiredAt} is null and ${table.nextFilingDeadline} is not null`),
  ],
);

export type OfficeRow = typeof offices.$inferSelect;
export type NewOfficeRow = typeof offices.$inferInsert;

/** Which powers an office holds and how strongly: 3 decides, 2 shares, 1 indirect. */
export const officePowers = pgTable(
  'office_powers',
  {
    officeId: uuid('office_id').notNull(),
    powerId: text('power_id').notNull(),
    relevance: smallint('relevance').notNull(),
    quote: text('quote'),
    sourceUrl: text('source_url'),
    confidence: text('confidence').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'office_powers_pkey', columns: [table.officeId, table.powerId] }),
    foreignKey({
      name: 'office_powers_office_id_fkey',
      columns: [table.officeId],
      foreignColumns: [offices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'office_powers_power_id_fkey',
      columns: [table.powerId],
      foreignColumns: [powers.id],
    }),
    check('office_powers_relevance_check', sql`${table.relevance} between 1 and 3`),
    check('office_powers_confidence_check', sql`${table.confidence} in ('high', 'medium', 'low')`),
    check('office_powers_source_url_check', sql`${table.sourceUrl} like 'https://%'`),
    index('office_powers_power').on(table.powerId, table.relevance.desc().nullsFirst()),
  ],
);

export type OfficePowerRow = typeof officePowers.$inferSelect;
export type NewOfficePowerRow = typeof officePowers.$inferInsert;

/** Derived: the highest relevance among an issue's powers that the office holds. */
export const officeIssues = pgTable(
  'office_issues',
  {
    officeId: uuid('office_id').notNull(),
    issueId: text('issue_id').notNull(),
    relevance: smallint('relevance').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'office_issues_pkey', columns: [table.officeId, table.issueId] }),
    foreignKey({
      name: 'office_issues_office_id_fkey',
      columns: [table.officeId],
      foreignColumns: [offices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'office_issues_issue_id_fkey',
      columns: [table.issueId],
      foreignColumns: [issues.id],
    }),
    check('office_issues_relevance_check', sql`${table.relevance} between 1 and 3`),
    index('office_issues_issue').on(table.issueId, table.relevance.desc().nullsFirst()),
  ],
);

export type OfficeIssueRow = typeof officeIssues.$inferSelect;
export type NewOfficeIssueRow = typeof officeIssues.$inferInsert;

/**
 * One contest for an office on a date, with its headline filing window (T-elections). The five
 * headline columns are written only by L-headline-deadline.
 */
export const elections = pgTable(
  'elections',
  {
    id: uuid('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    officeId: uuid('office_id').notNull(),
    electionDate: date('election_date', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    party: text('party'),
    filingOpens: date('filing_opens', { mode: 'string' }),
    filingDeadline: date('filing_deadline', { mode: 'string' }),
    filingDeadlineTime: time('filing_deadline_time'),
    petitionDue: date('petition_due', { mode: 'string' }),
    deadlineBasis: text('deadline_basis'),
    deadlineConflict: jsonb('deadline_conflict').$type<unknown[]>(),
    turnoutClass: text('turnout_class').notNull(),
    fieldMeta: jsonb('field_meta').$type<Record<string, unknown>>().notNull().default({}),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'elections_office_id_fkey',
      columns: [table.officeId],
      foreignColumns: [offices.id],
    }).onDelete('cascade'),
    unique('elections_source_key_key').on(table.sourceKey),
    unique('elections_contest_key')
      .on(table.officeId, table.electionDate, table.kind, table.party)
      .nullsNotDistinct(),
    check(
      'elections_kind_check',
      sql`${table.kind} in ('primary', 'general', 'primary_runoff', 'general_runoff', 'special')`,
    ),
    check('elections_party_check', sql`${table.party} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check(
      'elections_deadline_basis_check',
      sql`${table.deadlineBasis} in ('computed', 'scraped', 'both')`,
    ),
    check(
      'elections_turnout_class_check',
      sql`${table.turnoutClass} in ('presidential_general', 'midterm_general', 'odd_year_general', 'primary', 'standalone_local', 'odd_year_statewide', 'spring_local', 'spring_with_presidential_primary', 'runoff')`,
    ),
    check('elections_filing_window_check', sql`${table.filingOpens} <= ${table.filingDeadline}`),
    check('elections_filing_deadline_check', sql`${table.filingDeadline} <= ${table.electionDate}`),
    index('elections_deadline').on(table.filingDeadline),
    index('elections_date').on(table.electionDate),
    index('elections_opens')
      .on(table.filingOpens)
      .where(sql`${table.filingOpens} is not null`),
  ],
);

export type ElectionRow = typeof elections.$inferSelect;
export type NewElectionRow = typeof elections.$inferInsert;

/** One filing window per way onto the ballot for an election (D-081, D-330). */
export const filingTracks = pgTable(
  'filing_tracks',
  {
    id: uuid('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    electionId: uuid('election_id').notNull(),
    track: text('track').notNull(),
    opensOn: date('opens_on', { mode: 'string' }),
    closesOn: date('closes_on', { mode: 'string' }),
    closesTime: time('closes_time'),
    petitionOpens: date('petition_opens', { mode: 'string' }),
    petitionDue: date('petition_due', { mode: 'string' }),
    feeCents: bigint('fee_cents', { mode: 'number' }),
    signatures: integer('signatures'),
    whereToFile: text('where_to_file'),
    basis: text('basis').notNull(),
    sourceUrl: text('source_url'),
    quote: text('quote'),
    ruleCitation: text('rule_citation'),
    confidence: text('confidence').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' }).notNull(),
    fieldMeta: jsonb('field_meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'filing_tracks_election_id_fkey',
      columns: [table.electionId],
      foreignColumns: [elections.id],
    }).onDelete('cascade'),
    unique('filing_tracks_source_key_key').on(table.sourceKey),
    unique('filing_tracks_track_key').on(table.electionId, table.track),
    check(
      'filing_tracks_track_check',
      sql`${table.track} in ('party_primary', 'independent', 'nonpartisan', 'write_in', 'incumbent')`,
    ),
    check('filing_tracks_basis_check', sql`${table.basis} in ('computed', 'scraped', 'both')`),
    check('filing_tracks_confidence_check', sql`${table.confidence} in ('high', 'medium', 'low')`),
    check('filing_tracks_window_check', sql`${table.opensOn} <= ${table.closesOn}`),
    check('filing_tracks_source_url_check', sql`${table.sourceUrl} like 'https://%'`),
    index('filing_tracks_closes')
      .on(table.closesOn)
      .where(sql`${table.closesOn} is not null`),
  ],
);

export type FilingTrackRow = typeof filingTracks.$inferSelect;
export type NewFilingTrackRow = typeof filingTracks.$inferInsert;

/** Past results per office, date, stage and party (T-results). Rows are never removed by a load. */
export const results = pgTable(
  'results',
  {
    id: uuid('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    officeId: uuid('office_id').notNull(),
    electionId: uuid('election_id'),
    electionDate: date('election_date', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    party: text('party'),
    turnoutClass: text('turnout_class').notNull(),
    totalVotes: integer('total_votes'),
    winnerVotes: integer('winner_votes'),
    marginVotes: integer('margin_votes'),
    contested: boolean('contested'),
    candidates: jsonb('candidates').$type<unknown[]>(),
    certified: boolean('certified').notNull().default(false),
    sourceUrl: text('source_url'),
    checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'results_office_id_fkey',
      columns: [table.officeId],
      foreignColumns: [offices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'results_election_id_fkey',
      columns: [table.electionId],
      foreignColumns: [elections.id],
    }).onDelete('set null'),
    unique('results_source_key_key').on(table.sourceKey),
    unique('results_contest_key')
      .on(table.officeId, table.electionDate, table.kind, table.party)
      .nullsNotDistinct(),
    check(
      'results_kind_check',
      sql`${table.kind} in ('primary', 'general', 'primary_runoff', 'general_runoff', 'special')`,
    ),
    check(
      'results_turnout_class_check',
      sql`${table.turnoutClass} in ('presidential_general', 'midterm_general', 'odd_year_general', 'primary', 'standalone_local', 'odd_year_statewide', 'spring_local', 'spring_with_presidential_primary', 'runoff')`,
    ),
    check('results_party_check', sql`${table.party} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('results_source_url_check', sql`${table.sourceUrl} like 'https://%'`),
    index('results_date').on(table.electionDate.desc().nullsFirst()),
    index('results_election')
      .on(table.electionId)
      .where(sql`${table.electionId} is not null`),
  ],
);

export type ResultRow = typeof results.$inferSelect;
export type NewResultRow = typeof results.$inferInsert;
