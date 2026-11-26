import type { TurnoutClass } from '@citizenrun/shared';
import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { classifyTurnout, MAJORITY_PRIMARY_STATES } from './turnout.ts';
import type { ConcurrentTopOffice, TurnoutInput } from './turnout.ts';

function input(
  date: string,
  state: string,
  kind: TurnoutInput['kind'],
  party: string | null,
  concurrentTopOffice: ConcurrentTopOffice | null,
): TurnoutInput {
  return { date, state, kind, party, concurrentTopOffice };
}

// L-turnout-classify's fixture rows 1 to 14.
const ROWS: readonly (readonly [number, TurnoutInput, TurnoutClass])[] = [
  [1, input('2028-11-07', 'NC', 'general', null, 'president'), 'presidential_general'],
  [2, input('2026-11-03', 'TX', 'general', null, 'governor'), 'midterm_general'],
  [3, input('2027-11-02', 'WA', 'general', null, 'local'), 'odd_year_general'],
  [4, input('2027-11-02', 'VA', 'general', null, 'legislature'), 'odd_year_statewide'],
  [5, input('2027-04-06', 'IL', 'general', null, 'local'), 'spring_local'],
  [6, input('2028-04-04', 'WI', 'general', null, 'president'), 'spring_with_presidential_primary'],
  [7, input('2027-10-09', 'LA', 'primary', null, 'governor'), 'odd_year_statewide'],
  [8, input('2027-08-03', 'WA', 'primary', null, 'local'), 'primary'],
  [9, input('2028-03-07', 'TX', 'primary', 'democratic', 'president'), 'primary'],
  [10, input('2027-08-31', 'MS', 'primary_runoff', 'democratic', 'statewide'), 'runoff'],
  [11, input('2027-02-09', 'WA', 'special', null, null), 'standalone_local'],
  [12, input('2027-05-01', 'TX', 'general', null, 'local'), 'spring_local'],
  [13, input('2027-09-14', 'NC', 'general', null, 'local'), 'standalone_local'],
  [14, input('2026-11-03', 'NC', 'special', null, 'federal'), 'standalone_local'],
];

// TEST-turnout-class's named cases; the states and offices it leaves open come from 05's matching rows.
const NAMED: readonly (readonly [string, TurnoutInput, TurnoutClass])[] = [
  [
    'presidential general',
    input('2028-11-07', 'NC', 'general', null, 'president'),
    'presidential_general',
  ],
  ['midterm general', input('2026-11-03', 'TX', 'general', null, 'governor'), 'midterm_general'],
  ['odd-year general', input('2027-11-02', 'WA', 'general', null, 'local'), 'odd_year_general'],
  [
    'odd-year statewide',
    input('2025-11-04', 'VA', 'general', null, 'governor'),
    'odd_year_statewide',
  ],
  ['spring local', input('2027-04-06', 'IL', 'general', null, 'local'), 'spring_local'],
  [
    'spring with presidential primary',
    input('2028-04-04', 'WI', 'general', null, 'president'),
    'spring_with_presidential_primary',
  ],
  [
    'a partisan primary on presidential primary day',
    input('2028-03-07', 'TX', 'primary', 'democratic', 'president'),
    'primary',
  ],
  ['primary', input('2027-08-03', 'WA', 'primary', null, 'local'), 'primary'],
  [
    'primary that can elect outright',
    input('2027-10-09', 'LA', 'primary', null, 'governor'),
    'odd_year_statewide',
  ],
  ['runoff', input('2027-08-31', 'MS', 'general_runoff', null, 'statewide'), 'runoff'],
  ['special', input('2027-02-09', 'WA', 'special', null, null), 'standalone_local'],
];

describe('classifyTurnout', () => {
  for (const [row, given, expected] of ROWS) {
    it(`row ${String(row)}: ${given.date} ${given.state} ${given.kind} gives ${expected}`, async () => {
      await eachZone(() => {
        expect(classifyTurnout(given)).toBe(expected);
      });
    });
  }

  for (const [name, given, expected] of NAMED) {
    it(name, async () => {
      await eachZone(() => {
        expect(classifyTurnout(given)).toBe(expected);
      });
    });
  }

  it('a Louisiana primary with a party is a primary', async () => {
    await eachZone(() => {
      expect(classifyTurnout(input('2027-10-09', 'LA', 'primary', 'democratic', 'governor'))).toBe(
        'primary',
      );
    });
  });

  it('the majority-primary list is Louisiana only', async () => {
    await eachZone(() => {
      expect([...MAJORITY_PRIMARY_STATES]).toEqual(['LA']);
    });
  });

  it('a majority primary takes the class of its year', async () => {
    await eachZone(() => {
      expect(classifyTurnout(input('2028-03-07', 'LA', 'primary', null, 'president'))).toBe(
        'presidential_general',
      );
      expect(classifyTurnout(input('2026-11-03', 'LA', 'primary', null, 'federal'))).toBe(
        'midterm_general',
      );
      expect(classifyTurnout(input('2027-10-09', 'LA', 'primary', null, null))).toBe(
        'odd_year_general',
      );
    });
  });

  it('the boundaries of spring and of the odd-year statewide offices', async () => {
    await eachZone(() => {
      expect(classifyTurnout(input('2027-03-01', 'IL', 'general', null, 'local'))).toBe(
        'spring_local',
      );
      expect(classifyTurnout(input('2027-06-30', 'IL', 'general', null, null))).toBe(
        'spring_local',
      );
      expect(classifyTurnout(input('2027-02-28', 'IL', 'general', null, 'local'))).toBe(
        'standalone_local',
      );
      expect(classifyTurnout(input('2027-07-01', 'IL', 'general', null, 'local'))).toBe(
        'standalone_local',
      );
      // A spring general in a presidential year without the president on the ballot.
      expect(classifyTurnout(input('2028-04-04', 'WI', 'general', null, 'local'))).toBe(
        'spring_local',
      );
      // The president on a spring ballot outside a presidential year.
      expect(classifyTurnout(input('2027-04-06', 'WI', 'general', null, 'president'))).toBe(
        'spring_local',
      );
      expect(classifyTurnout(input('2027-11-02', 'VA', 'general', null, 'statewide'))).toBe(
        'odd_year_statewide',
      );
      expect(classifyTurnout(input('2027-11-02', 'VA', 'general', null, 'federal'))).toBe(
        'odd_year_general',
      );
      expect(classifyTurnout(input('2027-11-02', 'VA', 'general', null, null))).toBe(
        'odd_year_general',
      );
      // A November general that is not on election day is a standalone election.
      expect(classifyTurnout(input('2027-11-09', 'NC', 'general', null, 'local'))).toBe(
        'standalone_local',
      );
    });
  });

  it('a malformed date is refused', async () => {
    await eachZone(() => {
      expect(() => classifyTurnout(input('2027-02-30', 'NC', 'general', null, null))).toThrow(
        RangeError,
      );
      expect(() => classifyTurnout(input('11/02/2027', 'NC', 'special', null, null))).toThrow(
        RangeError,
      );
    });
  });
});
