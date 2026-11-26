// Step 4 of the bundle writer: facts by PIPE-confidence, freshness, "keeps a day job?" and
// plausibility. Values that fail are dropped, never replaced.
import { fitsDayJob } from '@citizenrun/shared';
import type { BElection, BFilingTrack, BOffice, FieldMetaRow } from '@citizenrun/shared';
import { FRESHNESS_DAYS } from '../lib/confidence.ts';
import { factKey, groupFacts, mergeFacts as mergeTableFacts } from '../lib/facts.ts';
import type { Fact } from '../lib/facts.ts';
import {
  checkDateInRange,
  checkFee,
  checkHours,
  checkPay,
  checkSeats,
  checkSignatures,
  checkTerm,
  checkTrackDates,
} from '../lib/plausibility.ts';
import { metaToEvidence } from '../stages/shared/evidence.ts';
import type { OfficeRefRow } from '../stages/shared/office-ref.ts';
import type { AssembledRows, OriginIndex } from './assemble.ts';

const MS_PER_DAY = 86_400_000;

type Confidence = FieldMetaRow['confidence'];

type MetaTable = 'jurisdictions' | 'districts' | 'offices' | 'elections' | 'filing_tracks';
const META_TABLES: readonly MetaTable[] = [
  'jurisdictions',
  'districts',
  'offices',
  'elections',
  'filing_tracks',
];

/**
 * For each row and field with at least one fact: the facts' evidence plus the owning stage's
 * value as evidence (when not null), resolved by PIPE-confidence. `conflicts` counts the fields
 * whose resolution returned a conflict.
 */
export function mergeFacts(
  rows: AssembledRows,
  facts: readonly Fact[],
  origins: OriginIndex,
  now: Date,
): { rows: AssembledRows; conflicts: number } {
  const grouped = groupFacts(facts);
  let conflicts = 0;
  const out: AssembledRows = { ...rows };
  for (const table of META_TABLES) {
    const merged = mergeTableFacts(
      table,
      rows[table] as readonly (BOffice & { source_key: string })[],
      grouped,
      (row, field) => {
        const value = (row as unknown as Record<string, unknown>)[field];
        const origin = origins.get(`${table}|${row.source_key}`);
        if (value === null || value === undefined || origin === undefined) {
          return null;
        }
        return metaToEvidence(
          table,
          origin.origin,
          value,
          row.field_meta[field],
          origin.finishedAt,
        );
      },
      now,
    );
    (out as Record<MetaTable, unknown[]>)[table] = merged.rows;
    conflicts += merged.conflicts.length;
  }
  return { rows: out, conflicts };
}

function stale(checkedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(checkedAt) > FRESHNESS_DAYS * MS_PER_DAY;
}

function dropOne(level: Confidence): Confidence {
  return level === 'high' ? 'medium' : 'low';
}

/** One level down (high to medium, medium to low) when `now - checked_at` exceeds 180 days. */
export function applyFreshness(meta: FieldMetaRow, now: Date): FieldMetaRow {
  return stale(meta.checked_at, now) ? { ...meta, confidence: dropOne(meta.confidence) } : meta;
}

function freshMap(
  table: MetaTable,
  key: string,
  map: Record<string, FieldMetaRow>,
  merged: ReadonlySet<string>,
  now: Date,
): Record<string, FieldMetaRow> {
  const out: Record<string, FieldMetaRow> = {};
  for (const [field, meta] of Object.entries(map)) {
    out[field] = merged.has(factKey({ table, key, field })) ? meta : applyFreshness(meta, now);
  }
  return out;
}

/**
 * Freshness once per bundle: every `field_meta` entry the merge did not produce (those of the
 * fields `facts` name were resolved with freshness already), and the row confidence of every
 * office power and filing track.
 */
export function freshenRows(rows: AssembledRows, facts: readonly Fact[], now: Date): AssembledRows {
  const merged = new Set(facts.map((fact) => factKey(fact)));
  const out: AssembledRows = { ...rows };
  for (const table of META_TABLES) {
    (out as Record<MetaTable, unknown[]>)[table] = rows[table].map((row) => ({
      ...row,
      field_meta: freshMap(table, row.source_key, row.field_meta, merged, now),
    }));
  }
  out.filing_tracks = out.filing_tracks.map((track) =>
    stale(track.checked_at, now) ? { ...track, confidence: dropOne(track.confidence) } : track,
  );
  out.office_powers = rows.office_powers.map((power) =>
    power.checked_at !== null && stale(power.checked_at, now)
      ? { ...power, confidence: dropOne(power.confidence) }
      : power,
  );
  return out;
}

/** `fits_day_job` from full time, hours a week and meeting times (L-fits-day-job, D-500). */
export function deriveFitsDayJob(office: BOffice): BOffice {
  return {
    ...office,
    fits_day_job: fitsDayJob(office.full_time, office.hours_per_week, office.meeting_times),
  };
}

type Dropped = Record<string, number>;

function count(dropped: Dropped, name: string): void {
  dropped[name] = (dropped[name] ?? 0) + 1;
}

function withoutMeta(
  map: Record<string, FieldMetaRow>,
  fields: readonly string[],
): Record<string, FieldMetaRow> {
  const out: Record<string, FieldMetaRow> = {};
  for (const [field, meta] of Object.entries(map)) {
    if (!fields.includes(field)) {
      out[field] = meta;
    }
  }
  return out;
}

function dropOfficeValues(
  office: BOffice,
  refs: ReadonlyMap<string, OfficeRefRow>,
  dropped: Dropped,
): BOffice {
  let row = office;
  const drop = (check: string, fields: readonly (keyof BOffice)[]) => {
    count(dropped, `plausibility_dropped:${check}`);
    const next: Record<string, unknown> = { ...row };
    for (const field of fields) next[field] = null;
    next['field_meta'] = withoutMeta(row.field_meta, fields);
    row = next as BOffice;
  };
  if (row.body_size !== null) {
    const failure = checkSeats({ seats: null, body_size: row.body_size, seats_up_next: null });
    if (failure !== null) drop(failure.check, ['body_size']);
  }
  const seatsUp = checkSeats({
    seats: null,
    body_size: row.body_size,
    seats_up_next: row.seats_up_next,
  });
  if (seatsUp !== null) drop(seatsUp.check, ['seats_up_next', 'vacant_seats_up_next']);
  if (row.term_years !== null) {
    const failure = checkTerm(row.term_years);
    if (failure !== null) drop(failure.check, ['term_years']);
  }
  if (row.hours_per_week !== null) {
    const failure = checkHours(row.hours_per_week);
    if (failure !== null) drop(failure.check, ['hours_per_week']);
  }
  const payRange = refs.get(row.slug)?.pay_range ?? null;
  for (let guard = 0; guard < 2; guard++) {
    const failure = checkPay(row, payRange);
    if (failure === null) break;
    drop(
      failure.check,
      failure.check === 'pay_per_meeting' ? ['pay_amount_cents'] : ['pay_annual_cents'],
    );
  }
  if (row.filing_fee_cents !== null) {
    const failure = checkFee(row.filing_fee_cents);
    if (failure !== null) drop(failure.check, ['filing_fee_cents']);
  }
  // A signature count of 0 is a real zero: the rule is of kind `none`.
  if (row.signatures_required !== null && row.signatures_required !== 0) {
    const failure = checkSignatures(row.signatures_required, null);
    if (failure !== null) drop(failure.check, ['signatures_required']);
  }
  return row;
}

const TRACK_DATE_FIELD: Readonly<Record<string, readonly (keyof BFilingTrack)[]>> = {
  closes_before_election: ['closes_on', 'closes_time'],
  opens_before_closes: ['opens_on'],
  petition_due_before_election: ['petition_due'],
  petition_opens_before_due: ['petition_opens'],
};

function dropTrackValues(
  track: BFilingTrack,
  electionDate: string,
  dropped: Dropped,
): BFilingTrack {
  let row = track;
  const drop = (check: string, fields: readonly (keyof BFilingTrack)[]) => {
    count(dropped, `plausibility_dropped:${check}`);
    const next: Record<string, unknown> = { ...row };
    for (const field of fields) next[field] = null;
    next['field_meta'] = withoutMeta(row.field_meta, fields);
    row = next as BFilingTrack;
  };
  for (let guard = 0; guard < 4; guard++) {
    const failure = checkTrackDates(row, electionDate);
    if (failure === null) break;
    drop(failure.check, TRACK_DATE_FIELD[failure.check] ?? []);
  }
  if (row.fee_cents !== null) {
    const failure = checkFee(row.fee_cents);
    if (failure !== null) drop(failure.check, ['fee_cents']);
  }
  if (row.signatures !== null && row.signatures !== 0) {
    const failure = checkSignatures(row.signatures, null);
    if (failure !== null) drop(failure.check, ['signatures']);
  }
  return row;
}

function trackDates(track: BFilingTrack): string[] {
  return [track.opens_on, track.closes_on, track.petition_opens, track.petition_due].filter(
    (date): date is string => date !== null,
  );
}

/**
 * PIPE-plausibility on every value: a failing nullable value becomes null and loses its proof
 * (`plausibility_dropped:<check>`); a seat count outside 1 to 200 drops the office with its powers,
 * elections, tracks and holders (`office_implausible`); an election or track date more than five
 * years from `today` drops that election with its tracks, or that track.
 */
export function applyPlausibility(
  rows: AssembledRows,
  refs: ReadonlyMap<string, OfficeRefRow>,
  today: string,
): { rows: AssembledRows; dropped: Record<string, number> } {
  const dropped: Dropped = {};
  const offices: BOffice[] = [];
  const droppedOffices = new Set<string>();
  for (const office of rows.offices) {
    if (checkSeats({ seats: office.seats, body_size: null, seats_up_next: null }) !== null) {
      count(dropped, 'office_implausible');
      droppedOffices.add(office.source_key);
      continue;
    }
    offices.push(dropOfficeValues(office, refs, dropped));
  }
  // Only rows of a dropped office or election go with it; a dangling key is left for the integrity check.
  const elections: BElection[] = [];
  const droppedElections = new Set<string>();
  for (const election of rows.elections) {
    if (droppedOffices.has(election.office_key)) {
      droppedElections.add(election.source_key);
      continue;
    }
    if (checkDateInRange(election.election_date, today) !== null) {
      count(dropped, 'plausibility_dropped:date_in_range');
      droppedElections.add(election.source_key);
      continue;
    }
    elections.push(election);
  }
  const electionDates = new Map(elections.map((e) => [e.source_key, e.election_date]));
  const tracks: BFilingTrack[] = [];
  for (const track of rows.filing_tracks) {
    if (droppedElections.has(track.election_key)) continue;
    if (trackDates(track).some((date) => checkDateInRange(date, today) !== null)) {
      count(dropped, 'plausibility_dropped:date_in_range');
      continue;
    }
    const electionDate = electionDates.get(track.election_key);
    tracks.push(electionDate === undefined ? track : dropTrackValues(track, electionDate, dropped));
  }
  return {
    rows: {
      ...rows,
      offices,
      office_powers: rows.office_powers.filter((power) => !droppedOffices.has(power.office_key)),
      elections,
      filing_tracks: tracks,
      officeholders: rows.officeholders.filter((holder) => !droppedOffices.has(holder.office_key)),
    },
    dropped,
  };
}
