// The input of the one turnout classifier for every generated contest (PIPE-turnout-class): the
// concurrent top office of each date, over every contest of the state on that date.
import { classifyTurnout, novemberElectionDay } from '@citizenrun/rules';
import type { ConcurrentTopOffice } from '@citizenrun/rules';
import type { ElectionKind, TurnoutClass } from '@citizenrun/shared';

export type DatedContest = {
  readonly state: string;
  readonly date: string;
  readonly kind: ElectionKind;
  readonly party: string | null;
  readonly officeTypeId: string;
  /** An office of the template's `statewide` block. */
  readonly statewide: boolean;
};

const LEGISLATURE: ReadonlySet<string> = new Set(['state-senate', 'state-house']);
const FEDERAL: ReadonlySet<string> = new Set(['us-senate', 'us-house']);

/**
 * The first that applies: `president` on a presidential November election day, `governor`,
 * `statewide` (another office of the statewide block), `legislature`, `federal`, else `local`.
 */
export function concurrentTopOffice(contestsOnDate: readonly DatedContest[]): ConcurrentTopOffice {
  const date = contestsOnDate[0]?.date;
  if (date !== undefined) {
    const year = Number(date.slice(0, 4));
    if (year % 4 === 0 && date === novemberElectionDay(year)) {
      return 'president';
    }
  }
  if (contestsOnDate.some((c) => c.officeTypeId === 'governor')) {
    return 'governor';
  }
  if (contestsOnDate.some((c) => c.statewide && !FEDERAL.has(c.officeTypeId))) {
    return 'statewide';
  }
  if (contestsOnDate.some((c) => LEGISLATURE.has(c.officeTypeId))) {
    return 'legislature';
  }
  if (contestsOnDate.some((c) => FEDERAL.has(c.officeTypeId))) {
    return 'federal';
  }
  return 'local';
}

/** The key of a contest's class: `<date>|<kind>|<party or empty>`. */
export function turnoutKey(c: {
  readonly date: string;
  readonly kind: ElectionKind;
  readonly party: string | null;
}): string {
  return `${c.date}|${c.kind}|${c.party ?? ''}`;
}

/** The turnout class of every contest, keyed `<date>|<kind>|<party or empty>`. */
export function turnoutClasses(
  contests: readonly DatedContest[],
): ReadonlyMap<string, TurnoutClass> {
  const byDate = new Map<string, DatedContest[]>();
  for (const contest of contests) {
    const group = byDate.get(contest.date) ?? [];
    group.push(contest);
    byDate.set(contest.date, group);
  }
  const classes = new Map<string, TurnoutClass>();
  for (const group of byDate.values()) {
    const top = concurrentTopOffice(group);
    for (const contest of group) {
      const key = turnoutKey(contest);
      if (classes.has(key)) {
        continue;
      }
      classes.set(
        key,
        classifyTurnout({
          date: contest.date,
          state: contest.state,
          kind: contest.kind,
          party: contest.party,
          concurrentTopOffice: top,
        }),
      );
    }
  }
  return classes;
}
