import type { Db } from '@citizenrun/db';
import { localDateTimeIn } from '@citizenrun/shared';
import type { CandidacyView, ElectionView, OfficeDetail, ResultView } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import {
  civicReadContextOf,
  loadCandidacyViews,
  loadElectionViews,
  loadOfficeSummaries,
  loadResultViews,
} from '../civic/loaders.ts';
import type { CivicReadContext } from '../civic/loaders.ts';
import { personSummaryRows } from '../civic/person-summary.ts';
import { countUpcomingCandidacies, listCandidacyIds } from './list-candidates.ts';
import { buildOfficeDetail } from './office-detail.ts';
import type { OfficeDetailRow } from './office-detail.ts';
import { resolveOffice } from './resolve-office.ts';

// E-OFF-01: the office page. The summary keys come from L-office-summary; the page's own reads run
// in parallel, each on a pooled connection of its own. Nothing is written.

// PB-38: the most upcoming elections and results a page lists.
const UPCOMING_ELECTIONS_MAX = 10;
const RESULTS_MAX = 10;
// The candidates a page lists before the full list.
const PAGE_CANDIDATES_MAX = 20;

/** An instant column as ISO 8601 UTC with milliseconds and Z, the wire form. */
function isoInstant(column: SQL): SQL {
  return sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

async function readDetailRow(db: Db, officeId: string): Promise<OfficeDetailRow | null> {
  // index: offices_pkey, office_types_pkey, jurisdictions_pkey, districts_pkey
  const rows = await db.execute<OfficeDetailRow>(
    sql`select t.name as "officeTypeName",
               o.term_years::float8 as "termYears",
               o.term_limit_terms as "termLimitTerms",
               o.electorate,
               o.benefits,
               o.meeting_times as "meetingTimes",
               o.pay_change_note as "payChangeNote",
               o.where_to_file as "whereToFile",
               o.party_selection as "partySelection",
               o.eligibility,
               o.entrenched,
               o.decided_in as "decidedIn",
               o.effort,
               o.ease_inputs as "easeInputs",
               ${isoInstant(sql`o.changed_at`)} as "changedAt",
               o.field_meta as "fieldMeta",
               j.budget_cents::float8 as "budgetCents",
               j.budget_year as "budgetYear",
               j.field_meta as "jurisdictionFieldMeta",
               d.lean::float8 as lean,
               d.lean_basis as "leanBasis"
        from offices o
        join office_types t on t.id = o.office_type_id
        join jurisdictions j on j.id = o.jurisdiction_id
        join districts d on d.id = o.district_id
        where o.id = ${officeId}::uuid`,
    'objects',
  );
  return rows[0] ?? null;
}

async function readPowers(db: Db, officeId: string): Promise<OfficeDetail['powers']> {
  // index: office_powers_pkey (office prefix), powers_pkey, issue_powers_power
  return db.execute<OfficeDetail['powers'][number]>(
    sql`select op.power_id as "powerId",
               p.name,
               p.description,
               op.relevance,
               op.quote,
               op.source_url as "sourceUrl",
               op.confidence,
               ${isoInstant(sql`op.checked_at`)} as "checkedAt",
               coalesce((select array_agg(ip.issue_id order by i.sort)
                         from issue_powers ip
                         join issues i on i.id = ip.issue_id
                         where ip.power_id = op.power_id), '{}') as "issueIds"
        from office_powers op
        join powers p on p.id = op.power_id
        where op.office_id = ${officeId}::uuid
        order by op.relevance desc, p.name`,
    'objects',
  );
}

async function readIssueRelevance(
  db: Db,
  officeId: string,
): Promise<OfficeDetail['issueRelevance']> {
  // index: office_issues_pkey (office prefix), issues_pkey
  return db.execute<OfficeDetail['issueRelevance'][number]>(
    sql`select oi.issue_id as "issueId", oi.relevance
        from office_issues oi
        join issues i on i.id = oi.issue_id
        where oi.office_id = ${officeId}::uuid
        order by oi.relevance desc, i.sort`,
    'objects',
  );
}

/** The office's next 10 non-retired elections from `today`, and the next fileable one, as ElectionView. */
async function readElections(
  db: Db,
  input: {
    officeId: string;
    today: string;
    nextId: string | null;
    now: Date;
    ctx: CivicReadContext;
  },
): Promise<{ upcoming: ElectionView[]; next: ElectionView | null }> {
  // index: elections_contest_key
  const rows = await db.execute<{ id: string }>(
    sql`select e.id
        from elections e
        where e.office_id = ${input.officeId}::uuid
          and e.retired_at is null
          and e.election_date >= ${input.today}::date
        order by e.election_date,
                 array_position(array['primary', 'primary_runoff', 'general', 'general_runoff',
                                      'special']::text[], e.kind),
                 e.party nulls first
        limit ${UPCOMING_ELECTIONS_MAX}`,
    'objects',
  );
  const ids = rows.map((row) => row.id);
  // The next fileable election is read in the same call when it is not among them.
  const views = await loadElectionViews(db, {
    ids: input.nextId === null ? ids : [...ids, input.nextId],
    now: input.now,
    ctx: input.ctx,
  });
  return {
    upcoming: ids.flatMap((id) => {
      const view = views.get(id);
      return view === undefined ? [] : [view];
    }),
    next: input.nextId === null ? null : (views.get(input.nextId) ?? null),
  };
}

async function readResults(db: Db, officeId: string): Promise<ResultView[]> {
  // index: results_contest_key (backward)
  const rows = await db.execute<{ id: string }>(
    sql`select r.id
        from results r
        where r.office_id = ${officeId}::uuid
        order by r.election_date desc, r.kind desc, r.party desc nulls first
        limit ${RESULTS_MAX}`,
    'objects',
  );
  const views = await loadResultViews(db, { ids: rows.map((row) => row.id) });
  return rows.flatMap((row) => {
    const view = views.get(row.id);
    return view === undefined ? [] : [view];
  });
}

type HolderRow = {
  personId: string;
  seatLabel: string | null;
  since: string | null;
  seatUpNext: boolean | null;
  termLimited: boolean | null;
  notRunning: boolean | null;
  cashOnHandCents: number | null;
  cashAsOf: string | null;
  cashSourceUrl: string | null;
  party: string | null;
};

/** Current officeholders, roster directors included (D-316), and the party of each holder. */
async function readOfficeholders(
  db: Db,
  input: { officeId: string; viewerId: string | null; now: Date; ctx: CivicReadContext },
): Promise<{ officeholders: OfficeDetail['officeholders']; parties: Array<string | null> }> {
  // index: officeholders_office, people_pkey
  const rows = await db.execute<HolderRow>(
    sql`select oh.person_id as "personId",
               oh.seat_label as "seatLabel",
               oh.since::text as since,
               oh.seat_up_next as "seatUpNext",
               oh.term_limited as "termLimited",
               oh.not_running as "notRunning",
               oh.cash_on_hand_cents::float8 as "cashOnHandCents",
               oh.cash_as_of::text as "cashAsOf",
               oh.cash_source_url as "cashSourceUrl",
               p.party
        from officeholders oh
        join people p on p.id = oh.person_id
        where oh.office_id = ${input.officeId}::uuid
          and oh.until is null
        order by oh.seat_up_next desc nulls last, oh.since asc nulls last, p.name`,
    'objects',
  );
  const persons = await personSummaryRows(db, {
    ids: rows.map((row) => row.personId),
    viewerId: input.viewerId,
    includeRosterOnly: true,
    now: input.now,
    ctx: input.ctx,
  });
  const officeholders = rows.flatMap((row) => {
    const person = persons.get(row.personId);
    if (person === undefined) {
      return [];
    }
    return [
      {
        person,
        seatLabel: row.seatLabel,
        since: row.since,
        seatUpNext: row.seatUpNext,
        termLimited: row.termLimited,
        notRunning: row.notRunning,
        cashOnHandCents: row.cashOnHandCents,
        cashAsOf: row.cashAsOf,
        cashSourceUrl: row.cashSourceUrl,
      },
    ];
  });
  return { officeholders, parties: rows.map((row) => row.party) };
}

/** The first candidacies of the upcoming elections in E-OFF-02's order, and how many there are. */
async function readCandidates(
  db: Db,
  input: {
    officeId: string;
    today: string;
    viewerId: string | null;
    now: Date;
    ctx: CivicReadContext;
  },
): Promise<{ candidates: CandidacyView[]; count: number }> {
  const [rows, count] = await Promise.all([
    listCandidacyIds(db, {
      officeId: input.officeId,
      electionId: null,
      today: input.today,
      after: null,
      limit: PAGE_CANDIDATES_MAX,
    }),
    countUpcomingCandidacies(db, { officeId: input.officeId, today: input.today }),
  ]);
  const page = rows.slice(0, PAGE_CANDIDATES_MAX);
  const views = await loadCandidacyViews(db, {
    ids: page.map((row) => row.id),
    viewerId: input.viewerId,
    now: input.now,
    ctx: input.ctx,
  });
  return {
    candidates: page.flatMap((row) => {
      const view = views.get(row.id);
      return view === undefined ? [] : [view];
    }),
    count,
  };
}

/** OfficeDetail of one office for a viewer (null when logged out); null when the office does not resolve. Also called by the public office page with a null viewer (D-165). */
export async function loadOfficeDetail(
  deps: Deps,
  input: { idOrSlug: string; viewerId: string | null; singleIssueId: string | null; now: Date },
): Promise<OfficeDetail | null> {
  const { db } = deps;
  const { viewerId, now } = input;
  const office = await resolveOffice(db, input.idOrSlug);
  if (office === null) {
    return null;
  }
  const ctx = civicReadContextOf(deps);
  const summaries = await loadOfficeSummaries(db, {
    ids: [office.id],
    viewerId,
    singleIssueId: input.singleIssueId,
    now,
    ctx,
  });
  const summary = summaries.get(office.id);
  if (summary === undefined) {
    return null;
  }
  const today = localDateTimeIn(office.timezone, now).date;
  const officeId = office.id;
  const [row, powers, issueRelevance, elections, results, holders, candidates] = await Promise.all([
    readDetailRow(db, officeId),
    readPowers(db, officeId),
    readIssueRelevance(db, officeId),
    readElections(db, { officeId, today, nextId: summary.nextElection?.id ?? null, now, ctx }),
    readResults(db, officeId),
    readOfficeholders(db, { officeId, viewerId, now, ctx }),
    readCandidates(db, { officeId, today, viewerId, now, ctx }),
  ]);
  if (row === null) {
    return null;
  }
  return buildOfficeDetail(
    {
      summary,
      row,
      powers,
      issueRelevance,
      nextElectionDetail: elections.next,
      upcomingElections: elections.upcoming,
      results,
      officeholders: holders.officeholders,
      holderParties: holders.parties,
      candidates: candidates.candidates,
      candidatesCount: candidates.count,
    },
    (column) => {
      ctx.log.warn('civic.field_meta_invalid', { column });
    },
  );
}
