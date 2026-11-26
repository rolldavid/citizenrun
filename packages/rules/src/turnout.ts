// The one turnout classifier (L-turnout-classify, D-086, D-329, D-500).
import { assertNever } from '@citizenrun/shared';
import type { ElectionKind, TurnoutClass } from '@citizenrun/shared';
import { novemberElectionDay, toDayNumber } from './dates.ts';

export type ConcurrentTopOffice =
  'president' | 'governor' | 'statewide' | 'legislature' | 'federal' | 'local';
export type TurnoutInput = {
  date: string; // election_date
  state: string; // two-letter code
  kind: ElectionKind;
  party: string | null; // elections.party
  concurrentTopOffice: ConcurrentTopOffice | null; // the highest office on the same ballot, from the template
};

/** States whose nonpartisan primary can elect outright (D-329). */
export const MAJORITY_PRIMARY_STATES: ReadonlySet<string> = new Set(['LA']);

const SPRING_FIRST_MONTH = 3;
const SPRING_LAST_MONTH = 6;

/** Rule 4: a general, or a majority primary classified as the general of its year. */
function classifyAsGeneral(input: TurnoutInput, majorityPrimary: boolean): TurnoutClass {
  const year = Number(input.date.slice(0, 4));
  const month = Number(input.date.slice(5, 7));
  if (majorityPrimary || input.date === novemberElectionDay(year)) {
    if (year % 4 === 0) {
      return 'presidential_general';
    }
    if (year % 4 === 2) {
      return 'midterm_general';
    }
    const top = input.concurrentTopOffice;
    return top === 'governor' || top === 'statewide' || top === 'legislature'
      ? 'odd_year_statewide'
      : 'odd_year_general';
  }
  if (month >= SPRING_FIRST_MONTH && month <= SPRING_LAST_MONTH) {
    return year % 4 === 0 && input.concurrentTopOffice === 'president'
      ? 'spring_with_presidential_primary'
      : 'spring_local';
  }
  return 'standalone_local';
}

/** D-329: the turnout class of one election. RangeError when `date` is not a real YYYY-MM-DD date. */
export function classifyTurnout(input: TurnoutInput): TurnoutClass {
  toDayNumber(input.date);
  switch (input.kind) {
    case 'primary_runoff':
    case 'general_runoff':
      return 'runoff';
    case 'special':
      return 'standalone_local';
    case 'primary': {
      const majorityPrimary = input.party === null && MAJORITY_PRIMARY_STATES.has(input.state);
      return majorityPrimary ? classifyAsGeneral(input, true) : 'primary';
    }
    case 'general':
      return classifyAsGeneral(input, false);
    default:
      return assertNever(input.kind);
  }
}
