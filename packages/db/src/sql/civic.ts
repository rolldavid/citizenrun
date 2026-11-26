import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BuildAliasTable } from 'drizzle-orm/pg-core';
import { assertNever } from '@citizenrun/shared';
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
  /** The viewer's issue with the largest weighted relevance; null for a viewer with none. */
  headlineIssueId: string | null;
  /** The featured officeholder's person id, before the person is resolved. */
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
  // A single-seat office: seats = 1 and body_size null or 1 (L-holders-up-next).
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

// ---------------------------------------------------------------------------------------------------
// L-office-list: the candidate ids of the office list, in order, with the keyset of step 5. Every
// value is bound; the sort expression is the only SQL chosen in code, from a closed switch.

export type OfficeListSort = 'opportunity' | 'impact' | 'ease' | 'pay' | 'deadline';

/** The filters of L-office-list step 4; null (or false) is no filter. */
export type OfficeListFilters = {
  issueIds: readonly string[] | null;
  levels: readonly string[] | null;
  officeTypeIds: readonly string[] | null;
  jurisdictionKinds: readonly string[] | null;
  minPayCents: number | null;
  fitsDayJob: boolean;
  maxHours: number | null;
  deadlineWithinDays: number | null;
  q: string | null;
};

/** The parts of the set path's candidate set (step 2), intersected; null is not given. */
export type OfficeListSet = {
  mineUserId: string | null;
  districtId: string | null;
  includeContained: boolean;
  jurisdictionId: string | null;
  state: string | null;
};

/** The last row of the page before: its key, id and placeholder flag; null for the first page. */
export type OfficeListAfter = { k: number | string | null; id: string; p: boolean } | null;

/** One candidate office: its sort key, placeholder flag, the stored deadline and zone for the exact day test, and the set path's count. */
export type OfficeListRow = {
  id: string;
  k: number | string | null;
  p: boolean;
  nextFilingDeadline: string | null;
  timezone: string | null;
  total: number | null;
};

export const SET_PATH_MAX = 5_000; // PB-10

type OfficeListDbRow = {
  id: string;
  k: string | null;
  p: boolean;
  nextFilingDeadline: string | null;
  timezone: string | null;
  total: number | null;
};

/** The sort key of an office row: its expression (null when the sort has no key yet), direction and how a cursor key is bound. */
type SortKey = {
  expr: SQL | null;
  direction: 'asc' | 'desc';
  bind: (k: number | string) => SQL;
  read: (k: string | null) => number | string | null;
};

function numberKey(k: string | null): number | null {
  return k === null ? null : toNumber(k);
}

function noKey(): null {
  return null;
}

/**
 * The key of a sort while no office is scored (so `opportunity` and `impact` have
 * none and order by id). On the set path a stale deadline sorts with the unknown ones.
 */
function sortKeyOf(sort: OfficeListSort, todayPagoPago: string, path: 'set' | 'ranked'): SortKey {
  switch (sort) {
    case 'opportunity':
    case 'impact':
      return { expr: null, direction: 'desc', bind: (k) => sql`${k}`, read: noKey };
    case 'ease':
      return {
        expr: sql`o.ease`,
        direction: 'desc',
        bind: (k) => sql`${k}::numeric`,
        read: numberKey,
      };
    case 'pay':
      return {
        expr: sql`o.pay_annual_cents`,
        direction: 'desc',
        bind: (k) => sql`${k}::bigint`,
        read: numberKey,
      };
    case 'deadline':
      return {
        expr:
          path === 'set'
            ? sql`(case when o.next_filing_deadline >= ${todayPagoPago}::date then o.next_filing_deadline end)`
            : sql`o.next_filing_deadline`,
        direction: 'asc',
        bind: (k) => sql`${k}::date`,
        read: (k) => k,
      };
    default:
      return assertNever(sort);
  }
}

/** The candidate set of the set path (step 2): never retired, placeholders only when kept. */
function setPredicate(set: OfficeListSet, keepPlaceholders: boolean): SQL {
  const parts: SQL[] = [sql`o.retired_at is null`];
  if (!keepPlaceholders) {
    parts.push(sql`not o.placeholder`);
  }
  if (set.mineUserId !== null) {
    // index: user_districts_pkey, offices_district
    parts.push(
      sql`o.district_id in (select ud.district_id from user_districts ud
                            where ud.user_id = ${set.mineUserId}::uuid)`,
    );
  }
  if (set.districtId !== null) {
    const district = sql`${set.districtId}::uuid`;
    // index: offices_district, district_fallbacks_via
    parts.push(
      set.includeContained
        ? sql`(o.district_id = ${district}
               or o.district_id in (select f.district_id from district_fallbacks f
                                    where f.via_district_id = ${district}))`
        : sql`o.district_id = ${district}`,
    );
  }
  if (set.jurisdictionId !== null) {
    // index: offices_jurisdiction
    parts.push(sql`o.jurisdiction_id = ${set.jurisdictionId}::uuid`);
  }
  if (set.state !== null) {
    parts.push(sql`o.state = ${set.state}`);
  }
  return sql.join(parts, sql` and `);
}

/** The filters of step 4 over `o`, `t` (office type) and `j` (jurisdiction); a nullable column never matches null. */
function filterPredicate(filters: OfficeListFilters, todayPagoPago: string): SQL[] {
  const parts: SQL[] = [];
  if (filters.issueIds !== null) {
    // index: office_issues_pkey
    parts.push(
      sql`exists (select 1 from office_issues oi
                  where oi.office_id = o.id and oi.issue_id = any(${sql.param(filters.issueIds)}::text[]))`,
    );
  }
  if (filters.levels !== null) {
    parts.push(sql`t.level = any(${sql.param(filters.levels)}::text[])`);
  }
  if (filters.officeTypeIds !== null) {
    parts.push(sql`o.office_type_id = any(${sql.param(filters.officeTypeIds)}::text[])`);
  }
  if (filters.jurisdictionKinds !== null) {
    parts.push(sql`j.kind = any(${sql.param(filters.jurisdictionKinds)}::text[])`);
  }
  if (filters.minPayCents !== null) {
    parts.push(sql`o.pay_annual_cents >= ${filters.minPayCents}::bigint`);
  }
  if (filters.fitsDayJob) {
    parts.push(sql`o.fits_day_job in ('yes', 'likely')`);
  }
  if (filters.maxHours !== null) {
    parts.push(sql`o.hours_per_week <= ${filters.maxHours}::numeric`);
  }
  if (filters.deadlineWithinDays !== null) {
    // One day past the bound: another zone's today can be one day after Pago Pago's; the exact
    // daysUntil test drops the extra day.
    parts.push(
      sql`o.next_filing_deadline >= ${todayPagoPago}::date
          and o.next_filing_deadline <= ${todayPagoPago}::date + ${filters.deadlineWithinDays}::int + 1`,
    );
  }
  if (filters.q !== null) {
    // index: offices_search, offices_title_trgm
    parts.push(
      sql`(o.search @@ websearch_to_tsquery('english', ${filters.q}) or o.title % ${filters.q})`,
    );
  }
  return parts;
}

/** "After the cursor" of step 5 for the given key; with placeholders kept, the placeholder flag leads. */
function afterPredicate(key: SortKey, after: OfficeListAfter, keepPlaceholders: boolean): SQL[] {
  if (after === null) {
    return [];
  }
  const id = sql`${after.id}::uuid`;
  let condition: SQL;
  if (key.expr === null) {
    condition = sql`o.id > ${id}`;
  } else if (after.k === null) {
    condition = sql`(${key.expr} is null and o.id > ${id})`;
  } else {
    const k = key.bind(after.k);
    const beyond = key.direction === 'desc' ? sql`${key.expr} < ${k}` : sql`${key.expr} > ${k}`;
    condition = sql`(${beyond} or (${key.expr} = ${k} and o.id > ${id}) or ${key.expr} is null)`;
  }
  if (keepPlaceholders) {
    const p = sql`${after.p}::boolean`;
    condition = sql`(o.placeholder > ${p} or (o.placeholder = ${p} and ${condition}))`;
  }
  return [condition];
}

/** `<expr> desc nulls last` or `<expr> asc nulls last`. */
function keyOrder(expr: SQL, direction: 'asc' | 'desc'): SQL {
  return direction === 'desc' ? sql`${expr} desc nulls last` : sql`${expr} asc nulls last`;
}

function toOfficeListRows(rows: readonly OfficeListDbRow[], key: SortKey): OfficeListRow[] {
  return rows.map((row) => ({
    id: row.id,
    k: key.read(row.k),
    p: row.p,
    nextFilingDeadline: row.nextFilingDeadline,
    timezone: row.timezone,
    total: row.total,
  }));
}

/** Candidate offices of the set path before the other filters, counted up to SET_PATH_MAX + 1. */
export async function countSetCandidates(
  db: Db | Tx,
  input: { set: OfficeListSet; keepPlaceholders: boolean },
): Promise<number> {
  // index: user_districts_pkey, offices_district, district_fallbacks_via, offices_jurisdiction
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n
        from (select 1 from offices o
              where ${setPredicate(input.set, input.keepPlaceholders)}
              limit ${SET_PATH_MAX + 1}) x`,
    'objects',
  );
  return rows[0]?.n ?? 0;
}

/**
 * One page of the set path (steps 2, 4 and 5): `limit + 1` rows after `after`, placeholders last
 * when kept; with `withTotal` the same statement counts every match before the limit (D-518).
 */
export async function officeListSetPage(
  db: Db | Tx,
  input: {
    set: OfficeListSet;
    keepPlaceholders: boolean;
    filters: OfficeListFilters;
    sort: OfficeListSort;
    todayPagoPago: string;
    after: OfficeListAfter;
    limit: number;
    withTotal: boolean;
  },
): Promise<OfficeListRow[]> {
  const key = sortKeyOf(input.sort, input.todayPagoPago, 'set');
  const where = sql.join(
    [
      setPredicate(input.set, input.keepPlaceholders),
      ...filterPredicate(input.filters, input.todayPagoPago),
      ...afterPredicate(key, input.after, input.keepPlaceholders),
    ],
    sql` and `,
  );
  const order = sql.join(
    [
      ...(input.keepPlaceholders ? [sql`o.placeholder asc`] : []),
      ...(key.expr === null ? [] : [keyOrder(key.expr, key.direction)]),
      sql`o.id`,
    ],
    sql`, `,
  );
  const total = input.withTotal ? sql`(count(*) over ())::int` : sql`null::int`;
  // index: offices_pkey, office_types_pkey, jurisdictions_pkey
  const rows = await db.execute<OfficeListDbRow>(
    sql`select o.id,
               ${key.expr ?? sql`null`}::text as k,
               o.placeholder as p,
               o.next_filing_deadline::text as "nextFilingDeadline",
               j.timezone,
               ${total} as total
        from offices o
        join office_types t on t.id = o.office_type_id
        join jurisdictions j on j.id = o.jurisdiction_id
        where ${where}
        order by ${order}
        limit ${input.limit + 1}`,
    'objects',
  );
  return toOfficeListRows(rows, key);
}

/**
 * One page of the ranked path (steps 3 to 5) over one state or many, placeholders excluded:
 * `limit + 1` rows after `after` on the index of the sort; `total` is null (D-518).
 */
export async function officeListRankedPage(
  db: Db | Tx,
  input: {
    states: readonly string[];
    filters: OfficeListFilters;
    sort: OfficeListSort;
    todayPagoPago: string;
    after: OfficeListAfter;
    limit: number;
  },
): Promise<OfficeListRow[]> {
  if (input.states.length === 0) {
    return [];
  }
  const key = sortKeyOf(input.sort, input.todayPagoPago, 'ranked');
  const inner = (state: SQL): SQL => {
    const where = sql.join(
      [
        sql`o.state = ${state}`,
        sql`o.retired_at is null`,
        sql`not o.placeholder`,
        ...(input.sort === 'deadline'
          ? [sql`o.next_filing_deadline >= ${input.todayPagoPago}::date`]
          : []),
        ...filterPredicate(input.filters, input.todayPagoPago),
        ...afterPredicate(key, input.after, false),
      ],
      sql` and `,
    );
    const order = key.expr === null ? sql`o.id` : sql`${keyOrder(key.expr, key.direction)}, o.id`;
    return sql`select o.id,
                      ${key.expr ?? sql`null::text`} as sk,
                      ${key.expr ?? sql`null`}::text as k,
                      o.placeholder as p,
                      o.next_filing_deadline::text as "nextFilingDeadline",
                      j.timezone,
                      null::int as total
               from offices o
               join office_types t on t.id = o.office_type_id
               join jurisdictions j on j.id = o.jurisdiction_id
               where ${where}
               order by ${order}
               limit ${input.limit + 1}`;
  };
  const [only] = input.states;
  if (input.states.length === 1 && only !== undefined) {
    // index: offices_state_ease, offices_state_pay, offices_state_deadline, offices_pkey
    const rows = await db.execute<OfficeListDbRow>(inner(sql`${only}`), 'objects');
    return toOfficeListRows(rows, key);
  }
  const outerOrder =
    key.expr === null ? sql`x.id` : sql`${keyOrder(sql`x.sk`, key.direction)}, x.id`;
  // index: state_rules_pkey, offices_state_ease, offices_state_pay, offices_state_deadline
  const rows = await db.execute<OfficeListDbRow>(
    sql`select x.id, x.k, x.p, x."nextFilingDeadline", x.timezone, x.total
        from state_rules s
        cross join lateral (${inner(sql`s.state`)}) x
        where s.state::text = any(${sql.param(input.states)}::text[])
        order by ${outerOrder}
        limit ${input.limit + 1}`,
    'objects',
  );
  return toOfficeListRows(rows, key);
}
