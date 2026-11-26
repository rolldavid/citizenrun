import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BuildAliasTable } from 'drizzle-orm/pg-core';
import type {
  Confidence,
  ElectionKind,
  Electorate,
  FitsDayJob,
  JurisdictionKind,
  Level,
  PayKind,
  PayPeriod,
} from '@citizenrun/shared';
import type { Db, Tx } from '../client.ts';
import type { elections, offices } from '../schema/civic.ts';
import type { districts, jurisdictions } from '../schema/geo.ts';
import type { people } from '../schema/people.ts';

// The query helpers of A4: a list of civic rows leaves retired rows out. Each is built from the
// columns of the table or alias it is given, so `alias(offices, 'o')` gets `"o"."retired_at"`.
// No helper filters `placeholder`. On this Drizzle line an alias has a type of its own, so each
// table type admits the table and its aliases.

export type JurisdictionsTable =
  typeof jurisdictions | BuildAliasTable<typeof jurisdictions, string>;
export type DistrictsTable = typeof districts | BuildAliasTable<typeof districts, string>;
export type OfficesTable = typeof offices | BuildAliasTable<typeof offices, string>;
export type ElectionsTable = typeof elections | BuildAliasTable<typeof elections, string>;
export type PeopleTable = typeof people | BuildAliasTable<typeof people, string>;

/** retired_at is null on the given jurisdictions table or alias. */
export function activeJurisdictions(j: JurisdictionsTable): SQL {
  return sql`${j.retiredAt} is null`;
}

/** retired_at is null on the given districts table or alias. */
export function activeDistricts(d: DistrictsTable): SQL {
  return sql`${d.retiredAt} is null`;
}

/** retired_at is null on the given offices table or alias. */
export function activeOffices(o: OfficesTable): SQL {
  return sql`${o.retiredAt} is null`;
}

/** retired_at is null on the given elections table or alias. */
export function activeElections(e: ElectionsTable): SQL {
  return sql`${e.retiredAt} is null`;
}

/** retired_at is null, merged_into is null and not roster_only (D-316). */
export function activePeople(p: PeopleTable): SQL {
  return sql`(${p.retiredAt} is null and ${p.mergedInto} is null and not ${p.rosterOnly})`;
}

// ---------------------------------------------------------------------------------------------------
// L-office-summary

// L-headline-issue
export const HEADLINE_WEIGHT_STARRED = 0.9;
// L-headline-issue
export const HEADLINE_WEIGHT_OTHER = 0.7;

/** One next-election candidate of an office as the statement returns it (snake_case, dates as text). */
export type OfficeElectionCandidateRow = {
  id: string;
  election_date: string;
  kind: ElectionKind;
  party: string | null;
  filing_opens: string | null;
  filing_deadline: string | null;
  /** 'HH:MM'. */
  filing_deadline_time: string | null;
  /** The headline track's stored proof, or null when the election has no deadline or no such track. */
  proof: unknown;
};

/** The OfficeSummary columns of one office, numbers as numbers, dates as `YYYY-MM-DD`, instants as ISO UTC. */
export type OfficeSummaryRow = {
  id: string;
  slug: string;
  title: string;
  officeTypeId: string;
  level: Level;
  electorate: Electorate;
  state: string;
  placeholder: boolean;
  completeness: 'complete' | 'partial' | 'minimal' | null;
  partisan: boolean | null;
  seats: number;
  bodySize: number | null;
  seatsUpNext: number | null;
  vacantSeatsUpNext: number | null;
  payAnnualCents: number | null;
  payKind: PayKind | null;
  payAmountCents: number | null;
  payPeriod: PayPeriod | null;
  hoursPerWeek: number | null;
  fitsDayJob: FitsDayJob | null;
  fullTime: boolean | null;
  signaturesRequired: number | null;
  filingFeeCents: number | null;
  costToRunCents: number | null;
  ease: number | null;
  easeConfidence: Confidence | null;
  votesToWin: number | null;
  votesLow: number | null;
  votesHigh: number | null;
  votesEstimated: boolean | null;
  /** offices.field_meta as stored. */
  fieldMeta: unknown;
  retiredAt: string | null;
  nextElectionId: string | null;
  jurisdictionId: string;
  jurisdictionName: string;
  jurisdictionKind: JurisdictionKind;
  jurisdictionState: string;
  jurisdictionWebsite: string | null;
  jurisdictionTimezone: string | null;
  districtId: string;
  districtTileId: number;
  districtName: string;
  districtLevel: Level;
  districtGeometryQuality: 'exact' | 'parent_fallback' | 'county_approx';
  districtOutlineSvg: string | null;
  districtOutlineBbox: number[] | null;
  /** The viewer has at least one user_issues row; false for a null viewer. */
  hasIssues: boolean;
  /** The stored next election alone, or the candidates of the two uncertain days and the first certain one. */
  electionCandidates: OfficeElectionCandidateRow[];
  /** The latest election_date of the office's non-retired elections. */
  lastElectionDate: string | null;
  following: boolean;
  bookmarked: boolean;
  /** At most three issue chips, in chip order. */
  issues: { issueId: string; relevance: 1 | 2 | 3 }[];
  /** The office's issue with the highest relevance, ties by issues.sort (PB-06). */
  strongestIssueId: string | null;
  /** The viewer's issue with the largest weighted relevance (R-159); null for a viewer with none. */
  headlineIssueId: string | null;
  /** The featured officeholder's person id (R-008), before the person is resolved. */
  featuredPersonId: string | null;
  featuredHolderSince: string | null;
  /** bool_or of term_limited over the current holders up next. */
  upNextTermLimited: boolean | null;
  /** bool_or of not_running over the current holders up next. */
  upNextNotRunning: boolean | null;
};

type NumericText = string | number;

// The columns node-pg returns as text (bigint, numeric, jsonb ->>), converted once here.
type OfficeSummaryDbRow = Omit<
  OfficeSummaryRow,
  | 'payAnnualCents'
  | 'payAmountCents'
  | 'hoursPerWeek'
  | 'filingFeeCents'
  | 'costToRunCents'
  | 'ease'
  | 'districtTileId'
  | 'districtOutlineBbox'
> & {
  payAnnualCents: NumericText | null;
  payAmountCents: NumericText | null;
  hoursPerWeek: NumericText | null;
  filingFeeCents: NumericText | null;
  costToRunCents: NumericText | null;
  ease: NumericText | null;
  districtTileId: NumericText;
  districtOutlineBbox: NumericText[] | null;
};

function toNumber(value: NumericText): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new RangeError('A numeric column is not a finite number.');
  }
  return n;
}

function toSafeInteger(value: NumericText): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('An integer column is not a safe integer.');
  }
  return n;
}

function nullable<T>(value: NumericText | null, convert: (v: NumericText) => T): T | null {
  return value === null ? null : convert(value);
}

/** An instant column as ISO 8601 UTC with milliseconds and Z, the wire form. */
function isoInstant(column: SQL): SQL {
  return sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** The OfficeSummary columns of the given offices in one statement, with the viewer's flags; rows in no particular order. */
export async function officeSummaryRows(
  db: Db | Tx,
  input: {
    officeIds: readonly string[];
    viewerId: string | null;
    /** The issue of single-issue Impact; no column of this statement reads it until Impact is scored. */
    singleIssueId: string | null;
    todayPagoPago: string;
  },
): Promise<OfficeSummaryRow[]> {
  const { officeIds, viewerId, todayPagoPago } = input;
  if (officeIds.length === 0) {
    return [];
  }
  const viewer = sql`${viewerId}::uuid`;
  const today = sql`${todayPagoPago}::date`;
  // A single-seat office: seats = 1 and body_size null or 1 (R-008, L-holders-up-next).
  const singleSeat = sql`(o.seats = 1 and (o.body_size is null or o.body_size = 1))`;
  // The Pago Pago date keeps every deadline still open somewhere; the exact test is
  // pickNextElection's, in the jurisdiction's zone. A runoff is never fileable.
  const stillOpen = sql`e.kind not in ('primary_runoff', 'general_runoff')
      and (e.filing_deadline >= ${today} or (e.filing_deadline is null and e.election_date > ${today}))`;
  // index: offices_pkey, office_types_pkey, jurisdictions_pkey, districts_pkey
  // index: elections_contest_key (office prefix), filing_tracks_track_key (election prefix)
  // index: follows_pkey, bookmarks_pkey, office_issues_pkey, user_issues_pkey
  // index: officeholders_office, people_pkey
  const rows = await db.execute<OfficeSummaryDbRow>(
    sql`with vi as (
          select exists (select 1 from user_issues where user_id = ${viewer}) as has_issues
        )
        select
          o.id as "id",
          o.slug as "slug",
          o.title as "title",
          o.office_type_id as "officeTypeId",
          t.level as "level",
          t.electorate as "electorate",
          o.state::text as "state",
          o.placeholder as "placeholder",
          o.completeness as "completeness",
          o.partisan as "partisan",
          o.seats as "seats",
          o.body_size as "bodySize",
          o.seats_up_next as "seatsUpNext",
          o.vacant_seats_up_next as "vacantSeatsUpNext",
          o.pay_annual_cents as "payAnnualCents",
          o.pay_kind as "payKind",
          o.pay_amount_cents as "payAmountCents",
          o.pay_period as "payPeriod",
          o.hours_per_week as "hoursPerWeek",
          o.fits_day_job as "fitsDayJob",
          o.full_time as "fullTime",
          o.signatures_required as "signaturesRequired",
          o.filing_fee_cents as "filingFeeCents",
          o.effort ->> 'dollars' as "costToRunCents",
          o.ease as "ease",
          o.ease_confidence as "easeConfidence",
          o.votes_to_win as "votesToWin",
          o.votes_low as "votesLow",
          o.votes_high as "votesHigh",
          o.votes_estimated as "votesEstimated",
          o.field_meta as "fieldMeta",
          ${isoInstant(sql`o.retired_at`)} as "retiredAt",
          o.next_election_id as "nextElectionId",
          j.id as "jurisdictionId",
          j.name as "jurisdictionName",
          j.kind as "jurisdictionKind",
          j.state::text as "jurisdictionState",
          j.website as "jurisdictionWebsite",
          j.timezone as "jurisdictionTimezone",
          d.id as "districtId",
          d.tile_id as "districtTileId",
          d.name as "districtName",
          d.level as "districtLevel",
          d.geometry_quality as "districtGeometryQuality",
          d.outline_svg as "districtOutlineSvg",
          d.outline_bbox as "districtOutlineBbox",
          vi.has_issues as "hasIssues",
          coalesce(nx.candidates, '[]'::jsonb) as "electionCandidates",
          (select max(e3.election_date) from elections e3
            where e3.office_id = o.id and e3.retired_at is null)::text as "lastElectionDate",
          exists (select 1 from follows f
            where f.follower_id = ${viewer} and f.target_type = 'office' and f.target_id = o.id) as "following",
          exists (select 1 from bookmarks b
            where b.user_id = ${viewer} and b.office_id = o.id) as "bookmarked",
          ch.issues as "issues",
          si.issue_id as "strongestIssueId",
          hi.issue_id as "headlineIssueId",
          fh.person_id as "featuredPersonId",
          fh.since::text as "featuredHolderSince",
          os.term_limited as "upNextTermLimited",
          os.not_running as "upNextNotRunning"
        from offices o
        join office_types t on t.id = o.office_type_id
        join jurisdictions j on j.id = o.jurisdiction_id
        join districts d on d.id = o.district_id
        cross join vi
        left join lateral (
          select jsonb_agg(jsonb_build_object(
                   'id', c.id,
                   'election_date', c.election_date,
                   'kind', c.kind,
                   'party', c.party,
                   'filing_opens', c.filing_opens,
                   'filing_deadline', c.filing_deadline,
                   'filing_deadline_time', to_char(c.filing_deadline_time, 'HH24:MI'),
                   'proof', hp.proof)) as candidates
          from (
            select e.id, e.election_date, e.kind, e.party, e.filing_opens, e.filing_deadline,
                   e.filing_deadline_time
            from elections e
            where o.next_election_id is not null and e.id = o.next_election_id
            union all
            select e.id, e.election_date, e.kind, e.party, e.filing_opens, e.filing_deadline,
                   e.filing_deadline_time
            from elections e
            where o.next_election_id is null and e.office_id = o.id and e.retired_at is null
              and ${stillOpen}
              and coalesce(e.filing_deadline, e.election_date) <= ${today} + 1
            union all
            (select e.id, e.election_date, e.kind, e.party, e.filing_opens, e.filing_deadline,
                    e.filing_deadline_time
             from elections e
             where o.next_election_id is null and e.office_id = o.id and e.retired_at is null
               and ${stillOpen}
               and coalesce(e.filing_deadline, e.election_date) > ${today} + 1
             order by coalesce(e.filing_deadline, e.election_date), e.election_date,
                      array_position(array['primary', 'general', 'special', 'primary_runoff',
                                           'general_runoff'], e.kind),
                      coalesce(e.party, ''), e.id
             limit 1)
          ) c
          left join lateral (
            select case when ft.field_meta ? 'closes_on' then ft.field_meta -> 'closes_on'
                        else jsonb_build_object(
                               'source_url', ft.source_url,
                               'quote', ft.quote,
                               'confidence', ft.confidence,
                               'checked_at', ${isoInstant(sql`ft.checked_at`)})
                             || case when ft.rule_citation is null then '{}'::jsonb
                                     else jsonb_build_object('rule_citation', ft.rule_citation) end
                   end as proof
            from filing_tracks ft
            where c.filing_deadline is not null
              and ft.election_id = c.id and ft.closes_on = c.filing_deadline
            order by ft.closes_time nulls last, ft.track
            limit 1
          ) hp on true
        ) nx on true
        left join lateral (
          select coalesce(jsonb_agg(jsonb_build_object('issueId', x.issue_id, 'relevance', x.relevance)
                                    order by x.mine desc, x.relevance desc, x.sort), '[]'::jsonb) as issues
          from (
            select oi.issue_id, oi.relevance, (ui.user_id is not null) as mine, i.sort
            from office_issues oi
            join issues i on i.id = oi.issue_id
            left join user_issues ui on ui.user_id = ${viewer} and ui.issue_id = oi.issue_id
            where oi.office_id = o.id
            order by (ui.user_id is not null) desc, oi.relevance desc, i.sort
            limit 3
          ) x
        ) ch on true
        left join lateral (
          select oi.issue_id
          from office_issues oi
          join issues i on i.id = oi.issue_id
          where oi.office_id = o.id
          order by oi.relevance desc, i.sort
          limit 1
        ) si on true
        left join lateral (
          select ui.issue_id
          from user_issues ui
          join office_issues oi on oi.office_id = o.id and oi.issue_id = ui.issue_id
          join issues i on i.id = ui.issue_id
          where ui.user_id = ${viewer}
          order by (case when ui.starred then ${HEADLINE_WEIGHT_STARRED}::float8
                         else ${HEADLINE_WEIGHT_OTHER}::float8 end) * oi.relevance desc,
                   ui.starred desc, i.sort
          limit 1
        ) hi on true
        left join lateral (
          select oh.person_id, oh.since
          from officeholders oh
          join people p on p.id = oh.person_id
          where oh.office_id = o.id and oh.until is null
            and (${singleSeat} or oh.seat_up_next = true)
          order by oh.seat_up_next desc nulls last, oh.since nulls last, p.name
          limit 1
        ) fh on true
        left join lateral (
          select bool_or(oh.term_limited) as term_limited, bool_or(oh.not_running) as not_running
          from officeholders oh
          where oh.office_id = o.id and oh.until is null
            and (${singleSeat} or oh.seat_up_next = true)
        ) os on true
        where o.id = any(${sql.param(officeIds)}::uuid[])`,
    'objects',
  );
  return rows.map((row) => ({
    ...row,
    payAnnualCents: nullable(row.payAnnualCents, toSafeInteger),
    payAmountCents: nullable(row.payAmountCents, toSafeInteger),
    hoursPerWeek: nullable(row.hoursPerWeek, toNumber),
    filingFeeCents: nullable(row.filingFeeCents, toSafeInteger),
    costToRunCents: nullable(row.costToRunCents, toSafeInteger),
    ease: nullable(row.ease, toNumber),
    districtTileId: toSafeInteger(row.districtTileId),
    districtOutlineBbox:
      row.districtOutlineBbox === null ? null : row.districtOutlineBbox.map(toNumber),
  }));
}
