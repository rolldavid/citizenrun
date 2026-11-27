import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { LA_FIXTURES } from '../__fixtures__/la/index.ts';
import { addDays, isBusinessDay, roll, weekdayOf, SATURDAY, SUNDAY, TUESDAY } from '../dates.ts';
import { runStateRulesSuite } from '../testing/check-fixtures.ts';
import type { RuleDeclaration } from '../testing/check-fixtures.ts';
import { classifyTurnout } from '../turnout.ts';
import type { IsoDate, OfficeRef } from '../types.ts';
import { laRules } from './la.ts';

const NEVER_REASON =
  'R.S. 18:468 closes qualifying at 4:30 p.m. on the Thursday or Friday after the opening day R.S. 18:467 fixes; no Louisiana legal holiday falls on those days';

const declaredRules: readonly RuleDeclaration[] = [
  {
    id: 'la.la_qualifying.nonpartisan',
    trackSet: 'la_qualifying',
    track: 'nonpartisan',
    rolled: { never: true, fields: ['closesOn'], reason: NEVER_REASON },
  },
  {
    id: 'la.la_party_primary.nonpartisan',
    trackSet: 'la_party_primary',
    track: 'nonpartisan',
    rolled: { never: true, fields: ['closesOn'], reason: NEVER_REASON },
  },
  {
    id: 'la.la_party_primary.party_primary',
    trackSet: 'la_party_primary',
    track: 'party_primary',
    rolled: { never: true, fields: ['closesOn'], reason: NEVER_REASON },
  },
  {
    id: 'la.la_party_primary.independent',
    trackSet: 'la_party_primary',
    track: 'independent',
    rolled: { never: true, fields: ['closesOn'], reason: NEVER_REASON },
  },
];

/** The closed party primary offices (R.S. 18:2(9)); the open-primary office types are left out (D-329). */
const PARTISAN_OFFICE_TYPES = [
  'us-senate',
  'us-house',
  'state-appellate-judge',
  'state-education-board',
  'utility-commission',
] as const;

runStateRulesSuite({
  state: 'LA',
  rules: laRules,
  fixtures: LA_FIXTURES,
  declaredRules,
  officialHosts: ['sos.la.gov', 'legis.la.gov', 'ethics.la.gov', 'calcasieuclerk.gov'],
  partisanOfficeTypes: PARTISAN_OFFICE_TYPES,
  partyPrimaryExempt: false,
});

function office(
  officeTypeId: string,
  schedule: string,
  trackSet: string,
  extra: Partial<OfficeRef> = {},
): OfficeRef {
  return {
    state: 'LA',
    templateKey: `fixture-${officeTypeId}`,
    officeTypeId,
    jurisdictionKind: 'state',
    countyGeoid: null,
    partisan: null,
    schedule,
    trackSet,
    staggerGroup: null,
    termYears: null,
    payAnnualCents: null,
    population: null,
    ...extra,
  };
}

const GOVERNOR = office('governor', 'la_gubernatorial', 'la_qualifying');
const US_SENATE = office('us-senate', 'la_party_primary_congressional', 'la_party_primary');
const BESE = office('state-education-board', 'la_party_primary_gubernatorial', 'la_party_primary');

/** One office of each schedule, with the track set the rules interface pairs with it. */
const OFFICES_BY_SCHEDULE: Readonly<Record<string, OfficeRef>> = {
  la_gubernatorial: GOVERNOR,
  la_congressional: office('trial-judge', 'la_congressional', 'la_qualifying', {
    jurisdictionKind: 'county',
  }),
  la_municipal_spring: office('city-council', 'la_municipal_spring', 'la_qualifying', {
    jurisdictionKind: 'city',
    population: 12_000,
  }),
  la_orleans_odd_year: office('city-council', 'la_orleans_odd_year', 'la_qualifying', {
    jurisdictionKind: 'city',
    population: 380_000,
  }),
  la_party_primary_congressional: US_SENATE,
  la_party_primary_gubernatorial: BESE,
  la_party_committee: office('party-committee', 'la_party_committee', 'la_party_committee', {
    jurisdictionKind: 'party',
  }),
  la_no_public_election: office('pension-board', 'la_no_public_election', 'la_qualifying'),
};

function nextBusinessDay(d: IsoDate, year: number): IsoDate {
  const calendar = laRules.holidays(year);
  let date = addDays(d, 1);
  while (!isBusinessDay(date, calendar)) {
    date = addDays(date, 1);
  }
  return date;
}

describe('LA rules cases', () => {
  it('holidays are cited', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year += 1) {
        const calendar = laRules.holidays(year);
        expect(calendar.holidays.length).toBeGreaterThan(0);
        for (const holiday of calendar.holidays) {
          expect(new URL(holiday.citation.sourceUrl).protocol).toBe('https:');
          expect(holiday.citation.quote.trim()).not.toBe('');
          expect(holiday.date.startsWith(String(year))).toBe(true);
        }
      }
    });
  });

  it('each holiday the rules can meet rolls', async () => {
    await eachZone(() => {
      for (let year = 2026; year <= 2028; year += 1) {
        const calendar = laRules.holidays(year);
        const names = calendar.holidays.map((holiday) => holiday.name);
        expect(names).toEqual(
          expect.arrayContaining([
            'Mardi Gras',
            'Good Friday',
            'Huey P. Long Day',
            'Juneteenth Day',
          ]),
        );
        for (const holiday of calendar.holidays) {
          const weekday = weekdayOf(holiday.date);
          if (weekday === SATURDAY || weekday === SUNDAY) {
            continue;
          }
          expect(roll(holiday.date, 'next_business_day', calendar)).toBe(
            nextBusinessDay(holiday.date, year),
          );
          const saturdayBefore = addDays(holiday.date, -((weekday - SATURDAY + 7) % 7 || 7));
          const rolledBack = roll(saturdayBefore, 'previous_business_day', calendar);
          expect(isBusinessDay(rolledBack, calendar)).toBe(true);
          expect(rolledBack < saturdayBefore).toBe(true);
        }
      }
      // Mardi Gras 2027 (9 February) and Good Friday 2027 (26 March) move a deadline to the next business day.
      const cal2027 = laRules.holidays(2027);
      expect(roll('2027-02-09', 'next_business_day', cal2027)).toBe('2027-02-10');
      expect(roll('2027-03-26', 'next_business_day', cal2027)).toBe('2027-03-29');
    });
  });

  it('every schedule and track set answers', async () => {
    await eachZone(() => {
      expect([...laRules.schedules].sort()).toEqual(Object.keys(OFFICES_BY_SCHEDULE).sort());
      const trackSetsUsed = new Set<string>();
      for (const year of [2026, 2027]) {
        for (const schedule of laRules.schedules) {
          const fixtureOffice = OFFICES_BY_SCHEDULE[schedule];
          expect(fixtureOffice).toBeDefined();
          if (fixtureOffice === undefined) {
            continue;
          }
          trackSetsUsed.add(fixtureOffice.trackSet);
          for (const contest of laRules.contests({ office: fixtureOffice, year })) {
            expect(() => laRules.filingTracks({ office: fixtureOffice, contest })).not.toThrow();
            expect(laRules.certificationDate({ office: fixtureOffice, contest })).not.toBeNull();
          }
        }
      }
      expect([...trackSetsUsed].sort()).toEqual([...laRules.trackSets].sort());
    });
  });

  it('an unknown schedule throws', async () => {
    await eachZone(() => {
      expect(() =>
        laRules.contests({ office: office('governor', 'la_nope', 'la_qualifying'), year: 2027 }),
      ).toThrow(new RangeError('la: unknown schedule la_nope'));
    });
  });

  it('offices with no public election have no contests', async () => {
    await eachZone(() => {
      const noElection = OFFICES_BY_SCHEDULE.la_no_public_election;
      expect(noElection).toBeDefined();
      if (noElection === undefined) {
        return;
      }
      for (let year = 2024; year <= 2030; year += 1) {
        expect(laRules.contests({ office: noElection, year })).toEqual([]);
      }
    });
  });

  it('the 2027 primary elects outright', async () => {
    await eachZone(() => {
      const contests = laRules.contests({ office: GOVERNOR, year: 2027 });
      expect(
        contests.map(({ date, kind, party, electsOutright }) => ({
          date,
          kind,
          party,
          electsOutright,
        })),
      ).toEqual([
        { date: '2027-10-09', kind: 'primary', party: null, electsOutright: true },
        { date: '2027-11-20', kind: 'general', party: null, electsOutright: false },
      ]);
    });
  });

  it('Louisiana primaries classify as the general of their year', async () => {
    await eachZone(() => {
      expect(
        classifyTurnout({
          date: '2027-10-09',
          state: 'LA',
          kind: 'primary',
          party: null,
          concurrentTopOffice: 'governor',
        }),
      ).toBe('odd_year_statewide');
    });
  });

  it('elections fall on Saturdays', async () => {
    await eachZone(() => {
      // R.S. 18:402(C)(2)(a) holds the congressional fall primary, which is also the general of a
      // congressional-year party primary office, on the first Tuesday after the first Monday in November.
      const tuesdayCitations = new Set(['R.S. 18:402(C)(2)(a)', 'Acts 2026, No. 7, Section 7(B)']);
      for (let year = 2026; year <= 2028; year += 1) {
        for (const fixtureOffice of Object.values(OFFICES_BY_SCHEDULE)) {
          for (const contest of laRules.contests({ office: fixtureOffice, year })) {
            if (tuesdayCitations.has(contest.dateCitation.citation)) {
              expect(weekdayOf(contest.date)).toBe(TUESDAY);
            } else {
              expect(weekdayOf(contest.date)).toBe(SATURDAY);
            }
          }
        }
      }
    });
  });

  it('the 2027 qualifying week is not a fixture', async () => {
    await eachZone(() => {
      const cases = LA_FIXTURES.flatMap((fixture) => fixture.cases);
      expect(
        cases.filter(
          (fixtureCase) =>
            fixtureCase.contest.date.startsWith('2027') && fixtureCase.contest.kind === 'primary',
        ),
      ).toEqual([]);
    });
  });

  it('the open primary has no runoff', async () => {
    await eachZone(() => {
      const kinds = laRules.contests({ office: GOVERNOR, year: 2027 }).map((c) => c.kind);
      expect(kinds).not.toContain('primary_runoff');
      expect(kinds).not.toContain('general_runoff');
      expect(kinds).toEqual(['primary', 'general']);
    });
  });

  it('open-primary offices qualify on one nonpartisan track', async () => {
    await eachZone(() => {
      expect(PARTISAN_OFFICE_TYPES).not.toContain('governor');
      const [primary] = laRules.contests({ office: GOVERNOR, year: 2027 });
      expect(primary).toBeDefined();
      if (primary === undefined) {
        return;
      }
      const tracks = laRules.filingTracks({ office: GOVERNOR, contest: primary });
      expect(tracks.map((t) => t.track)).toEqual(['nonpartisan']);
    });
  });

  it('a runoff follows the primary', async () => {
    await eachZone(() => {
      const sections: Readonly<Record<number, string>> = {
        2026: 'R.S. 18:419.2(A)(2)',
        2028: 'R.S. 18:402(C)(1)(d)',
      };
      for (const year of [2026, 2028]) {
        const contests = laRules.contests({ office: US_SENATE, year });
        const runoffs = contests.filter((c) => c.kind === 'primary_runoff');
        expect(runoffs.map((r) => r.party)).toEqual(['democratic', 'republican']);
        for (const runoff of runoffs) {
          const primary = contests.find((c) => c.kind === 'primary' && c.party === runoff.party);
          expect(primary).toBeDefined();
          expect(primary !== undefined && primary.date < runoff.date).toBe(true);
          expect(runoff.electsOutright).toBe(false);
          expect(runoff.dateCitation.citation).toBe(sections[year]);
        }
        expect(contests.some((c) => c.kind === 'general_runoff')).toBe(false);
      }
    });
  });

  it('runoffs have no filing tracks', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year += 1) {
        for (const fixtureOffice of [US_SENATE, BESE]) {
          for (const contest of laRules.contests({ office: fixtureOffice, year })) {
            if (contest.kind === 'primary_runoff' || contest.kind === 'general_runoff') {
              expect(laRules.filingTracks({ office: fixtureOffice, contest })).toEqual([]);
            }
          }
        }
      }
    });
  });

  it('no party primary is held before 2026', async () => {
    await eachZone(() => {
      for (const year of [2023, 2024]) {
        for (const fixtureOffice of [
          US_SENATE,
          BESE,
          office('us-house', 'la_party_primary_congressional', 'la_party_primary'),
        ]) {
          const contests = laRules.contests({ office: fixtureOffice, year });
          expect(contests.every((c) => c.party === null && c.kind !== 'primary_runoff')).toBe(true);
        }
      }
    });
  });
});
