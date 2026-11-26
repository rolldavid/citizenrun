import { officeSummaryRows } from '@citizenrun/db';
import type { Db, OfficeSummaryRow, Tx } from '@citizenrun/db';
import { fieldMetaEntries, localDateTimeIn, roundDiv, toFieldMeta } from '@citizenrun/shared';
import type {
  CandidacyStatus,
  CandidacyView,
  Confidence,
  DeadlineBasis,
  ElectionKind,
  ElectionView,
  FieldMeta,
  FilingTrack,
  Logger,
  OfficeSummary,
  PersonSummary,
  ResultView,
  TrackKind,
  TurnoutClass,
} from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import type { MediaBucket } from '../../lib/media.ts';
import { filingStatusFor, officeFilingStatus } from '../offices/filing-status.ts';
import { pickNextElection } from './next-election.ts';
import type { ElectionCandidate } from './next-election.ts';
import { personSummaryRows } from './person-summary.ts';

// The batch loaders (L-civic-loaders, D-480): one loader per shape, ids in, a Map keyed by the
// requested id out. A loader leaves an id it cannot resolve out and decides nothing about
// visibility: a retired row comes back with retiredAt set and the caller filters.

export type { MediaBucket } from '../../lib/media.ts';

/** What a civic read needs beside the database: the media bucket that signs photo URLs, and the logger. */
export type CivicReadContext = { media: MediaBucket; log: Logger };

/** The media bucket loadMe passes to toAvatarMedia, and the request's logger. */
export function civicReadContextOf(deps: Deps): CivicReadContext {
  return { media: deps.storage.media, log: deps.logger };
}

// The one date a deadline prefilter takes: every deadline still open anywhere is on or after it.
const PREFILTER_ZONE = 'Pacific/Pago_Pago';

/** An instant column as ISO 8601 UTC with milliseconds and Z, the wire form. */
function isoInstant(column: SQL): SQL {
  return sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

function logInvalid(ctx: CivicReadContext, columns: readonly string[]): void {
  for (const column of columns) {
    ctx.log.warn('civic.field_meta_invalid', { column });
  }
}

/** A stored proof as FieldMeta; one that is present but does not parse is dropped and logged. */
function storedProof(ctx: CivicReadContext, stored: unknown, column: string): FieldMeta | null {
  if (stored === null || stored === undefined) {
    return null;
  }
  const meta = toFieldMeta(stored);
  if (meta === null) {
    logInvalid(ctx, [column]);
  }
  return meta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------------------
// OfficeSummary

function toCandidate(row: OfficeSummaryRow['electionCandidates'][number]): ElectionCandidate {
  return {
    id: row.id,
    electionDate: row.election_date,
    kind: row.kind,
    party: row.party,
    filingOpens: row.filing_opens,
    filingDeadline: row.filing_deadline,
    filingDeadlineTime: row.filing_deadline_time,
    proof: row.proof,
  };
}

function outlineOf(row: OfficeSummaryRow): OfficeSummary['outline'] {
  const bbox = row.districtOutlineBbox;
  if (row.districtOutlineSvg === null || bbox === null) {
    return null;
  }
  const [minX, minY, maxX, maxY] = bbox;
  if (minX === undefined || minY === undefined || maxX === undefined || maxY === undefined) {
    return null;
  }
  return { svg: row.districtOutlineSvg, bbox: [minX, minY, maxX, maxY] };
}

function openSeatOf(row: OfficeSummaryRow): OfficeSummary['openSeat'] {
  if (row.vacantSeatsUpNext !== null && row.vacantSeatsUpNext >= 1) {
    return 'vacant';
  }
  if (row.upNextTermLimited === true) {
    return 'term_limited';
  }
  if (row.upNextNotRunning === true) {
    return 'not_running';
  }
  return null;
}

function toOfficeSummary(
  row: OfficeSummaryRow,
  input: {
    now: Date;
    ctx: CivicReadContext;
    singleIssueId: string | null;
    persons: ReadonlyMap<string, PersonSummary>;
  },
): OfficeSummary {
  const zone = row.jurisdictionTimezone;
  const next = pickNextElection(
    {
      storedId: row.nextElectionId,
      candidates: row.electionCandidates.map(toCandidate),
      zone,
    },
    input.now,
  );
  const filingDeadline =
    next?.filingDeadline == null
      ? null
      : { date: next.filingDeadline, time: next.filingDeadlineTime, timezone: zone };
  const { entries, invalid } = fieldMetaEntries(row.fieldMeta, [
    ['payAnnualCents', 'pay_annual_cents', row.payAnnualCents],
    ['payAmountCents', 'pay_amount_cents', row.payAmountCents],
    ['hoursPerWeek', 'hours_per_week', row.hoursPerWeek],
    ['filingFeeCents', 'filing_fee_cents', row.filingFeeCents],
  ]);
  logInvalid(input.ctx, invalid);
  const fieldMeta: OfficeSummary['fieldMeta'] = { ...entries };
  if (filingDeadline !== null) {
    // The headline track's proof covers closes_on (T-filing_tracks).
    const proof = storedProof(input.ctx, next?.proof, 'closes_on');
    if (proof !== null) {
      fieldMeta.filingDeadline = proof;
    }
  }
  const personal = row.hasIssues;
  const impactIssueId = personal ? null : (input.singleIssueId ?? row.strongestIssueId);
  const featured =
    row.featuredPersonId === null ? undefined : input.persons.get(row.featuredPersonId);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    officeTypeId: row.officeTypeId,
    level: row.level,
    electorate: row.electorate,
    state: row.state,
    jurisdiction: {
      id: row.jurisdictionId,
      name: row.jurisdictionName,
      kind: row.jurisdictionKind,
      state: row.jurisdictionState,
      website: row.jurisdictionWebsite,
      timezone: zone,
    },
    district: {
      id: row.districtId,
      tileId: row.districtTileId,
      name: row.districtName,
      level: row.districtLevel,
      geometryQuality: row.districtGeometryQuality,
    },
    outline: outlineOf(row),
    placeholder: row.placeholder,
    completeness: row.completeness,
    partisan: row.partisan,
    seats: row.seats,
    bodySize: row.bodySize,
    seatsUpNext: row.seatsUpNext,
    payAnnualCents: row.payAnnualCents,
    payKind: row.payKind,
    payAmountCents: row.payAmountCents,
    payPeriod: row.payPeriod,
    hoursPerWeek: row.hoursPerWeek,
    fitsDayJob: row.fitsDayJob,
    fullTime: row.fullTime,
    signaturesRequired: row.signaturesRequired,
    filingFeeCents: row.filingFeeCents,
    costToRunCents: row.costToRunCents,
    ease: row.ease,
    easeConfidence: row.easeConfidence,
    // Impact and Opportunity stay null until offices are scored.
    impact: null,
    impactMode: personal ? 'personal' : 'single_issue',
    impactIssueId,
    opportunity: null,
    votesToWin: row.votesToWin,
    votesLow: row.votesLow,
    votesHigh: row.votesHigh,
    votesEstimated: row.votesEstimated,
    nextElection:
      next === null
        ? null
        : { id: next.id, electionDate: next.electionDate, kind: next.kind, party: next.party },
    filingDeadline,
    filingStatus: officeFilingStatus(
      {
        next:
          next === null
            ? null
            : {
                opensOn: next.filingOpens,
                closesOn: next.filingDeadline,
                closesTime: next.filingDeadlineTime,
                zone,
              },
        lastElectionDate: row.lastElectionDate,
        zone,
      },
      input.now,
    ),
    headlineIssueId: personal ? row.headlineIssueId : impactIssueId,
    issues: row.issues,
    featuredOfficeholder: featured ?? null,
    featuredHolderSince: featured === undefined ? null : row.featuredHolderSince,
    openSeat: openSeatOf(row),
    fieldMeta,
    retiredAt: row.retiredAt,
    // No declaration table exists yet, so the viewer is never running.
    viewer: {
      following: row.following,
      bookmarked: row.bookmarked,
      running: false,
      declarationId: null,
    },
  };
}

/** OfficeSummary of each id with the viewer's flags (L-office-summary); viewerId null gives single-issue mode and flags false. */
export async function loadOfficeSummaries(
  db: Db | Tx,
  input: {
    ids: readonly string[];
    viewerId: string | null;
    now: Date;
    ctx: CivicReadContext;
    singleIssueId?: string | null;
  },
): Promise<Map<string, OfficeSummary>> {
  const singleIssueId = input.singleIssueId ?? null;
  const rows = await officeSummaryRows(db, {
    officeIds: [...new Set(input.ids)],
    viewerId: input.viewerId,
    singleIssueId,
    todayPagoPago: localDateTimeIn(PREFILTER_ZONE, input.now).date,
  });
  const featuredIds = rows.flatMap((row) =>
    row.featuredPersonId === null ? [] : [row.featuredPersonId],
  );
  const persons =
    featuredIds.length === 0
      ? new Map<string, PersonSummary>()
      : await loadPersonSummaries(db, {
          ids: featuredIds,
          viewerId: input.viewerId,
          now: input.now,
          ctx: input.ctx,
        });
  const result = new Map<string, OfficeSummary>();
  for (const row of rows) {
    result.set(
      row.id,
      toOfficeSummary(row, { now: input.now, ctx: input.ctx, singleIssueId, persons }),
    );
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------
// PersonSummary

/** PersonSummary of each id, merges resolved to the survivor; roster-only people are left out. */
export function loadPersonSummaries(
  db: Db | Tx,
  input: { ids: readonly string[]; viewerId: string | null; now: Date; ctx: CivicReadContext },
): Promise<Map<string, PersonSummary>> {
  return personSummaryRows(db, { ...input, includeRosterOnly: false });
}

// ---------------------------------------------------------------------------------------------------
// ElectionView

type StoredTrack = {
  id: string;
  track: TrackKind;
  opens_on: string | null;
  closes_on: string | null;
  closes_time: string | null;
  petition_opens: string | null;
  petition_due: string | null;
  fee_cents: number | null;
  signatures: number | null;
  where_to_file: string | null;
  basis: DeadlineBasis;
  source_url: string | null;
  quote: string | null;
  rule_citation: string | null;
  confidence: Confidence;
  checked_at: string;
  field_meta: unknown;
};

type StoredConflict = {
  track: TrackKind;
  field: string;
  computed?: { value?: string | null; rule_citation?: string | null } | null;
  scraped?: {
    value?: string | null;
    source_url?: string | null;
    quote?: string | null;
    checked_at?: string | null;
  } | null;
};

type ElectionDbRow = {
  id: string;
  officeId: string;
  electionDate: string;
  kind: ElectionKind;
  party: string | null;
  turnoutClass: TurnoutClass;
  filingOpens: string | null;
  filingDeadline: string | null;
  filingDeadlineTime: string | null;
  petitionDue: string | null;
  deadlineBasis: DeadlineBasis | null;
  deadlineConflict: StoredConflict[] | null;
  electionDateMeta: unknown;
  timezone: string | null;
  candidatesCount: number;
  tracks: StoredTrack[];
};

// The act-on columns of a track, wire key and stored key (FilingTrack.fieldMeta).
const TRACK_PROOF_COLUMNS = [
  ['opensOn', 'opens_on'],
  ['closesOn', 'closes_on'],
  ['closesTime', 'closes_time'],
  ['petitionOpens', 'petition_opens'],
  ['petitionDue', 'petition_due'],
  ['feeCents', 'fee_cents'],
  ['signatures', 'signatures'],
  ['whereToFile', 'where_to_file'],
] as const satisfies ReadonlyArray<readonly [keyof FilingTrack['fieldMeta'], keyof StoredTrack]>;

function toFilingTrack(
  track: StoredTrack,
  zone: string | null,
  ctx: CivicReadContext,
): FilingTrack {
  // A column with no entry of its own shares the track's proof (T-filing_tracks).
  const ownProof: FieldMeta = {
    sourceUrl: track.source_url,
    quote: track.quote,
    confidence: track.confidence,
    checkedAt: track.checked_at,
    ruleCitation: track.rule_citation,
  };
  const stored = isRecord(track.field_meta) ? track.field_meta : {};
  const fieldMeta: FilingTrack['fieldMeta'] = {};
  for (const [wireKey, storedKey] of TRACK_PROOF_COLUMNS) {
    if (track[storedKey] === null) {
      continue;
    }
    if (Object.hasOwn(stored, storedKey)) {
      const meta = storedProof(ctx, stored[storedKey], storedKey);
      if (meta !== null) {
        fieldMeta[wireKey] = meta;
      }
    } else {
      fieldMeta[wireKey] = ownProof;
    }
  }
  return {
    id: track.id,
    track: track.track,
    opensOn: track.opens_on,
    closesOn: track.closes_on,
    closesTime: track.closes_time,
    timezone: zone,
    petitionOpens: track.petition_opens,
    petitionDue: track.petition_due,
    feeCents: track.fee_cents,
    signatures: track.signatures,
    whereToFile: track.where_to_file,
    basis: track.basis,
    sourceUrl: track.source_url,
    quote: track.quote,
    ruleCitation: track.rule_citation,
    confidence: track.confidence,
    checkedAt: track.checked_at,
    fieldMeta,
  };
}

function toConflict(item: StoredConflict): NonNullable<ElectionView['deadlineConflict']>[number] {
  return {
    track: item.track,
    field: item.field,
    computed: {
      value: item.computed?.value ?? null,
      ruleCitation: item.computed?.rule_citation ?? null,
    },
    scraped: {
      value: item.scraped?.value ?? null,
      sourceUrl: item.scraped?.source_url ?? null,
      quote: item.scraped?.quote ?? null,
      checkedAt: item.scraped?.checked_at ?? null,
    },
  };
}

/** ElectionView of each id, with its tracks in track order and its candidacy count. */
export async function loadElectionViews(
  db: Db | Tx,
  input: { ids: readonly string[]; now: Date; ctx: CivicReadContext },
): Promise<Map<string, ElectionView>> {
  const result = new Map<string, ElectionView>();
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) {
    return result;
  }
  // index: elections_pkey, offices_pkey, jurisdictions_pkey
  // index: filing_tracks_track_key (election prefix), candidacies_election
  const rows = await db.execute<ElectionDbRow>(
    sql`select e.id,
               e.office_id as "officeId",
               e.election_date::text as "electionDate",
               e.kind,
               e.party,
               e.turnout_class as "turnoutClass",
               e.filing_opens::text as "filingOpens",
               e.filing_deadline::text as "filingDeadline",
               to_char(e.filing_deadline_time, 'HH24:MI') as "filingDeadlineTime",
               e.petition_due::text as "petitionDue",
               e.deadline_basis as "deadlineBasis",
               e.deadline_conflict as "deadlineConflict",
               e.field_meta -> 'election_date' as "electionDateMeta",
               j.timezone,
               (select count(*) from candidacies c where c.election_id = e.id)::int as "candidatesCount",
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', ft.id,
                          'track', ft.track,
                          'opens_on', ft.opens_on,
                          'closes_on', ft.closes_on,
                          'closes_time', to_char(ft.closes_time, 'HH24:MI'),
                          'petition_opens', ft.petition_opens,
                          'petition_due', ft.petition_due,
                          'fee_cents', ft.fee_cents,
                          'signatures', ft.signatures,
                          'where_to_file', ft.where_to_file,
                          'basis', ft.basis,
                          'source_url', ft.source_url,
                          'quote', ft.quote,
                          'rule_citation', ft.rule_citation,
                          'confidence', ft.confidence,
                          'checked_at', ${isoInstant(sql`ft.checked_at`)},
                          'field_meta', ft.field_meta)
                        order by array_position(array['party_primary', 'nonpartisan', 'independent',
                                                      'write_in', 'incumbent'], ft.track))
                 from filing_tracks ft
                 where ft.election_id = e.id), '[]'::jsonb) as tracks
        from elections e
        join offices o on o.id = e.office_id
        join jurisdictions j on j.id = o.jurisdiction_id
        where e.id = any(${sql.param(ids)}::uuid[])`,
    'objects',
  );
  for (const row of rows) {
    const zone = row.timezone;
    result.set(row.id, {
      id: row.id,
      officeId: row.officeId,
      electionDate: row.electionDate,
      electionDateMeta: storedProof(input.ctx, row.electionDateMeta, 'election_date'),
      kind: row.kind,
      party: row.party,
      turnoutClass: row.turnoutClass,
      filingOpens: row.filingOpens,
      filingDeadline:
        row.filingDeadline === null
          ? null
          : { date: row.filingDeadline, time: row.filingDeadlineTime, timezone: zone },
      petitionDue: row.petitionDue,
      deadlineBasis: row.deadlineBasis,
      deadlineConflict: row.deadlineConflict === null ? null : row.deadlineConflict.map(toConflict),
      filingStatus: filingStatusFor(
        {
          opensOn: row.filingOpens,
          closesOn: row.filingDeadline,
          closesTime: row.filingDeadlineTime,
          zone,
        },
        input.now,
      ),
      tracks: row.tracks.map((track) => toFilingTrack(track, zone, input.ctx)),
      candidatesCount: row.candidatesCount,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------
// ResultView

type ResultDbRow = {
  id: string;
  electionDate: string;
  kind: ElectionKind;
  party: string | null;
  turnoutClass: TurnoutClass;
  totalVotes: number | null;
  winnerVotes: number | null;
  marginVotes: number | null;
  contested: boolean | null;
  candidates: { name: string; party: string | null; votes: number; winner: boolean }[] | null;
  certified: boolean;
  sourceUrl: string | null;
  checkedAt: string | null;
  population18: number | null;
};

/** ResultView of each id; turnoutPct over the office district's adult population (D-532). */
export async function loadResultViews(
  db: Db | Tx,
  input: { ids: readonly string[] },
): Promise<Map<string, ResultView>> {
  const result = new Map<string, ResultView>();
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) {
    return result;
  }
  // index: results_pkey, offices_pkey, districts_pkey
  const rows = await db.execute<ResultDbRow>(
    sql`select r.id,
               r.election_date::text as "electionDate",
               r.kind,
               r.party,
               r.turnout_class as "turnoutClass",
               r.total_votes as "totalVotes",
               r.winner_votes as "winnerVotes",
               r.margin_votes as "marginVotes",
               r.contested,
               r.candidates,
               r.certified,
               r.source_url as "sourceUrl",
               ${isoInstant(sql`r.checked_at`)} as "checkedAt",
               d.population_18 as "population18"
        from results r
        join offices o on o.id = r.office_id
        join districts d on d.id = o.district_id
        where r.id = any(${sql.param(ids)}::uuid[])`,
    'objects',
  );
  for (const row of rows) {
    const known =
      row.totalVotes !== null && row.population18 !== null && row.population18 > 0
        ? { votes: row.totalVotes, population: row.population18 }
        : null;
    result.set(row.id, {
      id: row.id,
      electionDate: row.electionDate,
      kind: row.kind,
      party: row.party,
      turnoutClass: row.turnoutClass,
      totalVotes: row.totalVotes,
      turnoutPct: known === null ? null : roundDiv(100 * known.votes, known.population),
      winnerVotes: row.winnerVotes,
      marginVotes: row.marginVotes,
      contested: row.contested,
      candidates:
        row.candidates === null
          ? null
          : row.candidates.map((candidate) => ({
              name: candidate.name,
              party: candidate.party,
              votes: candidate.votes,
              winner: candidate.winner,
            })),
      certified: row.certified,
      sourceUrl: row.sourceUrl,
      checkedAt: row.checkedAt,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------
// CandidacyView

type CandidacyDbRow = {
  id: string;
  personId: string;
  electionId: string;
  electionDate: string;
  electionKind: ElectionKind;
  electionParty: string | null;
  party: string | null;
  status: CandidacyStatus;
  statusHistory: { status: CandidacyStatus; on: string; source_url?: string | null }[];
  filedOn: string | null;
  sourceUrl: string | null;
  officeId: string;
  officeSlug: string;
  officeTitle: string;
  officeState: string;
  jurisdictionName: string;
  officeRetiredAt: string | null;
};

/** CandidacyView of each id; a candidacy whose person does not resolve is left out. */
export async function loadCandidacyViews(
  db: Db | Tx,
  input: { ids: readonly string[]; viewerId: string | null; now: Date; ctx: CivicReadContext },
): Promise<Map<string, CandidacyView>> {
  const result = new Map<string, CandidacyView>();
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) {
    return result;
  }
  // index: candidacies_pkey, elections_pkey, offices_pkey, jurisdictions_pkey
  const rows = await db.execute<CandidacyDbRow>(
    sql`select c.id,
               c.person_id as "personId",
               c.election_id as "electionId",
               e.election_date::text as "electionDate",
               e.kind as "electionKind",
               e.party as "electionParty",
               c.party,
               c.status,
               c.status_history as "statusHistory",
               c.filed_on::text as "filedOn",
               c.source_url as "sourceUrl",
               o.id as "officeId",
               o.slug as "officeSlug",
               o.title as "officeTitle",
               o.state::text as "officeState",
               j.name as "jurisdictionName",
               ${isoInstant(sql`o.retired_at`)} as "officeRetiredAt"
        from candidacies c
        join elections e on e.id = c.election_id
        join offices o on o.id = e.office_id
        join jurisdictions j on j.id = o.jurisdiction_id
        where c.id = any(${sql.param(ids)}::uuid[])`,
    'objects',
  );
  const persons = await personSummaryRows(db, {
    ids: rows.map((row) => row.personId),
    viewerId: input.viewerId,
    includeRosterOnly: false,
    now: input.now,
    ctx: input.ctx,
  });
  for (const row of rows) {
    const person = persons.get(row.personId);
    if (person === undefined) {
      continue;
    }
    result.set(row.id, {
      id: row.id,
      person,
      office: {
        id: row.officeId,
        slug: row.officeSlug,
        title: row.officeTitle,
        state: row.officeState,
        jurisdictionName: row.jurisdictionName,
        retiredAt: row.officeRetiredAt,
      },
      electionId: row.electionId,
      electionDate: row.electionDate,
      electionKind: row.electionKind,
      electionParty: row.electionParty,
      party: row.party,
      status: row.status,
      statusHistory: row.statusHistory.map((entry) => ({
        status: entry.status,
        on: entry.on,
        sourceUrl: entry.source_url ?? null,
      })),
      filedOn: row.filedOn,
      sourceUrl: row.sourceUrl,
    });
  }
  return result;
}
