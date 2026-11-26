// The office headline facts (PIPE-deadlines step 3, P8-21): fee, signatures and where-to-file of
// each office's next election's first track.
import type { BElection, BFilingTrack, ElectionKind } from '@citizenrun/shared';
import type { Evidence } from '../../lib/confidence.ts';
import type { Fact } from '../../lib/facts.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';

/** The order a tie on the election date is broken in: general before primary. */
const KIND_ORDER: Readonly<Record<ElectionKind, number>> = Object.freeze({
  general: 0,
  primary: 1,
  primary_runoff: 2,
  general_runoff: 3,
  special: 4,
});

/** The order the first track of an election is taken in (P8-21). */
const TRACK_ORDER: Readonly<Record<BFilingTrack['track'], number>> = Object.freeze({
  nonpartisan: 0,
  party_primary: 1,
  independent: 2,
  write_in: 3,
  incumbent: 4,
});

/** Each track column and the office column its headline fact sets. */
const HEADLINE_COLUMNS = [
  { column: 'fee_cents', field: 'filing_fee_cents' },
  { column: 'signatures', field: 'signatures_required' },
  { column: 'where_to_file', field: 'where_to_file' },
] as const;

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Earliest date; then general before primary; then by party, nulls first. */
function compareElections(a: BElection, b: BElection): number {
  if (a.election_date !== b.election_date) {
    return a.election_date < b.election_date ? -1 : 1;
  }
  const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (kind !== 0) {
    return kind;
  }
  if (a.party === b.party) {
    return byteOrder(a.source_key, b.source_key);
  }
  if (a.party === null) {
    return -1;
  }
  if (b.party === null) {
    return 1;
  }
  return byteOrder(a.party, b.party);
}

function firstTrack(tracks: readonly BFilingTrack[]): BFilingTrack | null {
  let first: BFilingTrack | null = null;
  for (const track of tracks) {
    if (
      first === null ||
      TRACK_ORDER[track.track] < TRACK_ORDER[first.track] ||
      (track.track === first.track && byteOrder(track.source_key, first.source_key) < 0)
    ) {
      first = track;
    }
  }
  return first;
}

/** Computed evidence for one column: its own `field_meta` proof when present, else the track's. */
function headlineEvidence(
  track: BFilingTrack,
  column: (typeof HEADLINE_COLUMNS)[number]['column'],
  value: string | number,
): Evidence {
  const meta = track.field_meta[column];
  return {
    kind: 'computed',
    value,
    source_url: meta === undefined ? track.source_url : meta.source_url,
    quote: meta === undefined ? track.quote : meta.quote,
    rule_citation: meta === undefined ? track.rule_citation : (meta.rule_citation ?? null),
    checked_at: track.checked_at,
  };
}

/**
 * For each office, its next election (the earliest with `election_date >= today`) and that
 * election's first track; a fact for each of its fee, signatures and where-to-file that is not null.
 * An office with no future election or no track gets none. Facts come sorted by office and field.
 */
export function headlineFacts(
  offices: readonly OfficeRefRow[],
  elections: readonly BElection[],
  tracks: readonly BFilingTrack[],
  today: string,
): readonly Fact[] {
  const electionsByOffice = new Map<string, BElection[]>();
  for (const election of elections) {
    if (election.election_date < today) {
      continue;
    }
    const list = electionsByOffice.get(election.office_key);
    if (list === undefined) {
      electionsByOffice.set(election.office_key, [election]);
    } else {
      list.push(election);
    }
  }
  const tracksByElection = new Map<string, BFilingTrack[]>();
  for (const track of tracks) {
    const list = tracksByElection.get(track.election_key);
    if (list === undefined) {
      tracksByElection.set(track.election_key, [track]);
    } else {
      list.push(track);
    }
  }
  const slugs = [...new Set(offices.map((office) => office.slug))].sort(byteOrder);
  const facts: Fact[] = [];
  for (const slug of slugs) {
    const next = [...(electionsByOffice.get(slug) ?? [])].sort(compareElections)[0];
    if (next === undefined) {
      continue;
    }
    const track = firstTrack(tracksByElection.get(next.source_key) ?? []);
    if (track === null) {
      continue;
    }
    for (const { column, field } of HEADLINE_COLUMNS) {
      const value = track[column];
      if (value === null) {
        continue;
      }
      facts.push({
        table: 'offices',
        key: slug,
        field,
        value,
        evidence: headlineEvidence(track, column, value),
        origin: 's05-deadlines',
      });
    }
  }
  return facts.sort((a, b) => byteOrder(a.key, b.key) || byteOrder(a.field, b.field));
}
