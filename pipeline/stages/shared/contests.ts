// The election window, the stagger filter and the next electing contest (PIPE-expand steps 8 and
// 10, P8-20).
import { addDays, daysBefore } from '@citizenrun/rules';
import type { ContestOut, StateRules } from '@citizenrun/rules';
import { toRulesOfficeRef } from './office-ref.ts';
import type { OfficeRefRow } from './office-ref.ts';

/** Days before today the window starts: results and certification still arrive (P8-20). */
const WINDOW_BACK_DAYS = 400;
/** Days after today the window ends: the next full cycle (P8-20). */
const WINDOW_AHEAD_DAYS = 1095;
const PARTY_OFFICE_TYPES: ReadonlySet<string> = new Set([
  'party-precinct-committee',
  'party-committee',
]);

export type ElectionWindow = {
  readonly from: string;
  readonly to: string;
  readonly years: readonly number[];
};

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** From 400 days before `today` to 1,095 days after it, with every calendar year it touches. */
export function electionWindow(today: string): ElectionWindow {
  const from = daysBefore(today, WINDOW_BACK_DAYS);
  const to = addDays(today, WINDOW_AHEAD_DAYS);
  const years: number[] = [];
  for (let year = yearOf(from); year <= yearOf(to); year += 1) {
    years.push(year);
  }
  return { from, to, years };
}

export type WindowContest = ContestOut & { readonly seatsUp: number | null };

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function compareContests(a: WindowContest, b: WindowContest): number {
  if (a.date !== b.date) {
    return a.date < b.date ? -1 : 1;
  }
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  if (a.party === b.party) {
    return 0;
  }
  if (a.party === null) {
    return -1;
  }
  if (b.party === null) {
    return 1;
  }
  return a.party < b.party ? -1 : 1;
}

/**
 * The office's contests whose date lies in the window of `today`, with the seats up at each. A
 * staggered office keeps a contest only in a year one of its groups is elected, and its seats up
 * are those groups' seats. An office with no schedule, and a party committee not chosen on the
 * primary ballot (D-318), has none. A party committee's contests carry the office's party.
 */
export function contestsInWindow(
  ref: OfficeRefRow,
  state: string,
  rules: StateRules,
  today: string,
): readonly WindowContest[] {
  const isPartyOffice = PARTY_OFFICE_TYPES.has(ref.office_type_id);
  if (ref.schedule === null || (isPartyOffice && ref.party_selection !== 'primary_ballot')) {
    return [];
  }
  const office = toRulesOfficeRef(ref, state);
  const window = electionWindow(today);
  const kept: WindowContest[] = [];
  for (const year of window.years) {
    for (const contest of rules.contests({ office, year })) {
      if (contest.date < window.from || contest.date > window.to) {
        continue;
      }
      let seatsUp: number | null = ref.seats;
      if (ref.stagger.length > 0) {
        const groups = ref.stagger.filter(
          (g) => mod(yearOf(contest.date) - g.first, g.every) === 0,
        );
        if (groups.length === 0) {
          continue;
        }
        seatsUp = groups.reduce((sum, g) => sum + g.seats, 0);
      }
      kept.push({ ...contest, party: isPartyOffice ? ref.party : contest.party, seatsUp });
    }
  }
  kept.sort(compareContests);
  const seen = new Set<string>();
  return kept.filter((contest) => {
    const key = JSON.stringify(contest);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** The earliest contest on or after `today` that is a general or elects outright (D-329), or null. */
export function nextElecting(
  contests: readonly WindowContest[],
  today: string,
): WindowContest | null {
  let next: WindowContest | null = null;
  for (const contest of contests) {
    if (contest.date < today || !(contest.kind === 'general' || contest.electsOutright)) {
      continue;
    }
    if (next === null || contest.date < next.date) {
      next = contest;
    }
  }
  return next;
}
