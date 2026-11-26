import { daysUntil, localDateTimeIn } from '@citizenrun/shared';
import type { ElectionKind } from '@citizenrun/shared';

/** One candidate election of an office's next-election read (L-office-summary step 1). */
export type ElectionCandidate = {
  id: string;
  electionDate: string;
  kind: ElectionKind;
  party: string | null;
  filingOpens: string | null;
  filingDeadline: string | null;
  /** 'HH:MM', or null when no source states the hour. */
  filingDeadlineTime: string | null;
  /** The headline track's stored proof, or null. */
  proof: unknown;
};

// L-target-election
export const KIND_ORDER_FOR_NEXT: readonly ElectionKind[] = [
  'primary',
  'general',
  'special',
  'primary_runoff',
  'general_runoff',
];

// A runoff is never fileable: no candidate files for one and it has no filing track.
const NEVER_FILEABLE: ReadonlySet<ElectionKind> = new Set(['primary_runoff', 'general_runoff']);

function kindRank(kind: ElectionKind): number {
  return KIND_ORDER_FOR_NEXT.indexOf(kind);
}

// Code-unit order, so the pick never depends on the runtime's locale.
function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function compareCandidates(a: ElectionCandidate, b: ElectionCandidate): number {
  return (
    compareText(a.filingDeadline ?? a.electionDate, b.filingDeadline ?? b.electionDate) ||
    compareText(a.electionDate, b.electionDate) ||
    kindRank(a.kind) - kindRank(b.kind) ||
    compareText(a.party ?? '', b.party ?? '') ||
    compareText(a.id, b.id)
  );
}

function isFileable(candidate: ElectionCandidate, zone: string | null, now: Date): boolean {
  if (NEVER_FILEABLE.has(candidate.kind)) {
    return false;
  }
  if (candidate.filingDeadline !== null) {
    // A deadline closed by its hour today is still fileable by this date rule.
    return daysUntil(candidate.filingDeadline, zone, now) >= 0;
  }
  return candidate.electionDate > localDateTimeIn(zone, now).date;
}

/** The election offices.next_election_id names, else the first fileable candidate by L-target-election rules 1 and 2; null when none. */
export function pickNextElection(
  input: { storedId: string | null; candidates: readonly ElectionCandidate[]; zone: string | null },
  now: Date,
): ElectionCandidate | null {
  if (input.storedId !== null) {
    return input.candidates.find((candidate) => candidate.id === input.storedId) ?? null;
  }
  const sorted = [...input.candidates].sort(compareCandidates);
  return sorted.find((candidate) => isFileable(candidate, input.zone, now)) ?? null;
}
