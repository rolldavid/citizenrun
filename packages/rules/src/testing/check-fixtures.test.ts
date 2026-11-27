import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { addDays, daysBefore, nthWeekdayOfMonth, roll, TUESDAY } from '../dates.ts';
import type { Citation, RulesFixture, StateRules, TrackOut } from '../types.ts';
import {
  checkCitesStatute,
  checkCyclesPresent,
  checkerToday,
  checkMatchesCalendar,
  checkNeverRolls,
  checkNotYetRolled,
  checkOfficialSource,
  checkPartyAndIndependent,
  checkThreeYearsAndRoll,
  checkValidFrom,
  checkZoneProof,
  fixtureOffice,
  runStateRulesSuite,
} from './check-fixtures.ts';
import type {
  FilerDeclaration,
  NeverRolls,
  NewRegime,
  NotYetRolled,
  RuleDeclaration,
  StateSuiteInput,
  SuiteCheck,
  SuiteProblem,
} from './check-fixtures.ts';
import { zzFixtures, zzRules, zzSuiteInput } from './zz.fixtures.ts';

const SYNC_CHECKS = [
  checkMatchesCalendar,
  checkCitesStatute,
  checkValidFrom,
  checkThreeYearsAndRoll,
  checkCyclesPresent,
  checkOfficialSource,
  checkPartyAndIndependent,
] as const;

const SUITE_CASES = [
  'matches the official calendar',
  'cites its statute',
  'respects valid_from',
  'three years per rule, one with a roll',
  'the published 2024 and 2026 calendars are present',
  'the source is official',
  'a party-primary and an independent filer per partisan office type',
  'zone-proof',
];

/** Every problem of every check, synchronous and zone-proof. */
async function allProblems(input: StateSuiteInput): Promise<SuiteProblem[]> {
  const problems = SYNC_CHECKS.flatMap((check) => [...check(input)]);
  return [...problems, ...(await checkZoneProof(input))];
}

function checksOf(problems: readonly SuiteProblem[]): SuiteCheck[] {
  return [...new Set(problems.map((problem) => problem.check))].sort();
}

/** zzRules with its filing tracks changed for some contests. */
function withTracks(change: (track: TrackOut, contestDate: string) => TrackOut): StateRules {
  return {
    ...zzRules,
    filingTracks: (args) =>
      zzRules.filingTracks(args).map((track) => change(track, args.contest.date)),
  };
}

function withRules(rules: StateRules): StateSuiteInput {
  return { ...zzSuiteInput, rules };
}

function withFixtures(fixtures: readonly RulesFixture[]): StateSuiteInput {
  return { ...zzSuiteInput, fixtures };
}

function zzFixture(year: number): RulesFixture {
  const fixture = zzFixtures.find((f) => f.contests[0]?.year === year);
  if (fixture === undefined) {
    throw new Error(`no ZZ fixture for ${String(year)}`);
  }
  return fixture;
}

describe('the fixture state passes every suite case', () => {
  runStateRulesSuite(zzSuiteInput);

  it('registers the eight suite cases', async ({ task }) => {
    await eachZone(() => {
      const registered = task.suite?.tasks.find((sibling) => sibling.name === 'ZZ deadline rules');
      expect(registered?.type).toBe('suite');
      const tests = registered?.type === 'suite' ? registered.tasks : [];
      expect(tests.map((test) => test.type)).toEqual(SUITE_CASES.map(() => 'test'));
      expect(tests.map((test) => test.name).sort()).toEqual([...SUITE_CASES].sort());
    });
  });

  it('every check finds no problem', async () => {
    await eachZone(async () => {
      expect(await allProblems(zzSuiteInput)).toEqual([]);
    });
  });
});

describe('the suite checker', () => {
  it('a missed roll fails the calendar', async () => {
    await eachZone(async () => {
      const missed = withTracks((track, date) =>
        date === '2026-11-03'
          ? { ...track, closesOn: { ...track.closesOn, value: '2026-09-07' } }
          : track,
      );
      const problems = await allProblems(withRules(missed));
      expect(checksOf(problems)).toEqual(['matches_calendar']);
      expect(problems).toEqual([
        expect.objectContaining({ check: 'matches_calendar', where: 'zz-2026-filing' }),
      ]);
    });
  });

  it('an http citation fails', async () => {
    await eachZone(async () => {
      const http = withTracks((track) => ({
        ...track,
        closesOn: {
          ...track.closesOn,
          citation: {
            ...track.closesOn.citation,
            sourceUrl: track.closesOn.citation.sourceUrl.replace('https:', 'http:'),
          },
        },
      }));
      const problems = await allProblems(withRules(http));
      expect(checksOf(problems)).toEqual(['cites_statute']);
      expect(problems.map((problem) => problem.where)).toEqual([
        'zz-2024-filing nonpartisan.closesOn',
        'zz-2026-filing nonpartisan.closesOn',
        'zz-2027-filing nonpartisan.closesOn',
      ]);
    });
  });

  it('a citation with no quote, no name or no link fails', async () => {
    await eachZone(() => {
      const bare = withTracks((track) => ({
        ...track,
        closesOn: {
          ...track.closesOn,
          citation: { ...track.closesOn.citation, citation: ' ', quote: '', sourceUrl: 'nowhere' },
        },
      }));
      expect(checkCitesStatute(withRules(bare))).toHaveLength(9);
    });
  });

  it('a law applied before its time fails', async () => {
    await eachZone(async () => {
      const later = zzRules.filingTracks({
        office: fixtureOffice('ZZ', zzFixture(2027).cases[0]?.office ?? fail(), 'zz-2027-filing'),
        contest: { date: '2027-11-02', kind: 'general', party: null },
      })[0]?.closesOn.citation;
      if (later === undefined) {
        fail();
      }
      const always64 = withTracks((track, date) => ({
        ...track,
        closesOn: {
          value: roll(
            daysBefore(date, 64),
            'next_business_day',
            zzRules.holidays(Number(date.slice(0, 4))),
          ),
          citation: later,
        },
      }));
      const problems = await allProblems(withRules(always64));
      expect(checksOf(problems)).toEqual(['matches_calendar', 'valid_from']);
      expect(
        problems.filter((problem) => problem.check === 'valid_from').map((p) => p.where),
      ).toEqual(['zz-2024-filing nonpartisan.closesOn', 'zz-2026-filing nonpartisan.closesOn']);
      expect(
        problems.filter((problem) => problem.check === 'matches_calendar').map((p) => p.where),
      ).toEqual(['zz-2024-filing', 'zz-2026-filing']);
    });
  });

  it('two years are not enough', async () => {
    await eachZone(async () => {
      const problems = await allProblems(withFixtures([zzFixture(2024), zzFixture(2026)]));
      expect(problems).toEqual([
        expect.objectContaining({ check: 'three_years_and_roll', where: 'zz.nonpartisan' }),
      ]);
    });
  });

  it('a roll that did not move fails', async () => {
    await eachZone(async () => {
      const [declared] = zzSuiteInput.declaredRules;
      if (declared === undefined) {
        fail();
      }
      const problems = await allProblems({
        ...zzSuiteInput,
        declaredRules: [
          {
            ...declared,
            rolled: { ...declared.rolled, caseId: 'zz-2024-filing', unrolled: '2024-09-09' },
          },
        ],
      });
      expect(checksOf(problems)).toEqual(['three_years_and_roll']);
      // 2024-09-09 is a Monday and no holiday, and the published date equals it.
      expect(problems).toHaveLength(2);
    });
  });

  it('a roll declared for a case of another rule, or to the wrong date, fails', async () => {
    await eachZone(() => {
      const [declared] = zzSuiteInput.declaredRules;
      if (declared === undefined) {
        fail();
      }
      const elsewhere = checkThreeYearsAndRoll({
        ...zzSuiteInput,
        declaredRules: [{ ...declared, rolled: { ...declared.rolled, caseId: 'zz-2026-general' } }],
      });
      expect(elsewhere).toEqual([
        expect.objectContaining({ check: 'three_years_and_roll', where: 'zz.nonpartisan' }),
      ]);
      const backwards = checkThreeYearsAndRoll({
        ...zzSuiteInput,
        declaredRules: [
          { ...declared, rolled: { ...declared.rolled, direction: 'previous_business_day' } },
        ],
      });
      expect(backwards).toHaveLength(1);
      const undeclared = checkThreeYearsAndRoll({ ...zzSuiteInput, declaredRules: [] });
      expect(undeclared).toEqual([
        expect.objectContaining({ check: 'three_years_and_roll', where: 'zz_filing nonpartisan' }),
      ]);
    });
  });

  it('a missing cycle fails', async () => {
    await eachZone(async () => {
      const problems = await allProblems(withFixtures([zzFixture(2026), zzFixture(2027)]));
      expect(checksOf(problems)).toEqual(['cycles_present', 'three_years_and_roll']);
      expect(problems.filter((problem) => problem.check === 'cycles_present')).toEqual([
        expect.objectContaining({ detail: expect.stringContaining('2024') as unknown }),
      ]);
      const no2026 = checkCyclesPresent(withFixtures([zzFixture(2024), zzFixture(2027)]));
      expect(no2026).toEqual([
        expect.objectContaining({ detail: expect.stringContaining('2026') as unknown }),
      ]);
    });
  });

  it('an unofficial source fails', async () => {
    await eachZone(async () => {
      const f2024 = zzFixture(2024);
      const f2026 = zzFixture(2026);
      const f2027 = zzFixture(2027);
      const broken: readonly RulesFixture[] = [
        { ...f2024, source: { ...f2024.source, url: 'https://evil.example/fixture-calendar' } },
        { ...f2026, source: { ...f2026.source, sha256: 'abc' } },
        { ...f2027, cases: f2027.cases.map((fixtureCase) => ({ ...fixtureCase, quote: ' ' })) },
      ];
      const problems = await allProblems(withFixtures(broken));
      expect(checksOf(problems)).toEqual(['official_source']);
      expect(problems.map((problem) => problem.where)).toEqual([
        'zz-2024-general',
        'zz-2026-general',
        'zz-2027-general',
      ]);
    });
  });

  it('an official host is matched by name or subdomain, over https only', async () => {
    await eachZone(() => {
      const f2024 = zzFixture(2024);
      const source = (url: string, retrievedOn = '2026-11-20', title = 'Fixture calendar') =>
        checkOfficialSource(
          withFixtures([{ ...f2024, source: { ...f2024.source, url, retrievedOn, title } }]),
        ).length;
      expect(source('https://elections.example.test/calendar')).toBe(0);
      expect(source('https://notexample.test/calendar')).toBe(1);
      expect(source('https://example.test.evil.example/calendar')).toBe(1);
      expect(source('http://example.test/calendar')).toBe(1);
      expect(source('not a link')).toBe(1);
      expect(source('https://example.test/calendar', '2026-02-30')).toBe(1);
      expect(source('https://example.test/calendar', '2026-11-20', '')).toBe(1);
      const upper = checkOfficialSource(
        withFixtures([{ ...f2024, source: { ...f2024.source, sha256: 'A'.repeat(64) } }]),
      );
      expect(upper).toHaveLength(1);
    });
  });

  it('partisan office types need both filers', async () => {
    await eachZone(() => {
      const partisan = { ...zzSuiteInput, partisanOfficeTypes: ['county-commission'] };
      expect(checkPartyAndIndependent(partisan)).toEqual([
        expect.objectContaining({ check: 'party_and_independent', where: 'county-commission' }),
        expect.objectContaining({ check: 'party_and_independent', where: 'county-commission' }),
      ]);
      expect(checkPartyAndIndependent({ ...partisan, partyPrimaryExempt: true })).toEqual([
        expect.objectContaining({
          check: 'party_and_independent',
          detail: expect.stringContaining('independent') as unknown,
        }),
      ]);
    });
  });

  it('a zone-dependent module fails', async () => {
    const dayMs = 86_400_000;
    const zoneDependent = withTracks((track, date) => ({
      ...track,
      closesOn: {
        ...track.closesOn,
        value: new Date(new Date(`${date}T00:00:00`).getTime() - 57 * dayMs)
          .toISOString()
          .slice(0, 10),
      },
    }));
    const outputs: Record<string, string | undefined> = {};
    await eachZone((zone) => {
      outputs[zone] = zoneDependent.filingTracks({
        office: fixtureOffice('ZZ', zzFixture(2026).cases[0]?.office ?? fail(), 'zz-2026-filing'),
        contest: { date: '2026-11-03', kind: 'general', party: null },
      })[0]?.closesOn.value;
    });
    expect(outputs).toEqual({
      'America/Los_Angeles': '2026-09-07',
      'Pacific/Kiritimati': '2026-09-06',
    });
    const problems = await checkZoneProof(withRules(zoneDependent));
    expect(problems.map((problem) => [problem.check, problem.where])).toEqual([
      ['zone_proof', 'zz-2024-filing'],
      ['zone_proof', 'zz-2026-filing'],
      ['zone_proof', 'zz-2027-filing'],
    ]);
  });

  it('an unstated office key is refused', async () => {
    await eachZone(() => {
      const nosy: StateRules = {
        ...zzRules,
        filingTracks: (args) => {
          if (args.office.jurisdictionKind === 'county') {
            return [];
          }
          return zzRules.filingTracks(args);
        },
      };
      expect(() => checkMatchesCalendar(withRules(nosy))).toThrow(
        'zz-2024-filing does not state jurisdictionKind',
      );
    });
  });

  it('a fixture office holds the stated keys and the state', async () => {
    await eachZone(() => {
      const office = fixtureOffice(
        'ZZ',
        {
          templateKey: 'county-commission',
          officeTypeId: 'county-commission',
          schedule: 'zz_county_general',
          trackSet: 'zz_filing',
          payAnnualCents: null,
        },
        'zz-case',
      );
      expect(office.state).toBe('ZZ');
      expect(office.trackSet).toBe('zz_filing');
      expect(office.payAnnualCents).toBeNull();
      expect(() => office.population).toThrow('zz-case does not state population');
      expect(() => ({ ...office })).toThrow('zz-case does not state');
    });
  });
});

/** A closing day with one citation in force for every fixture year. */
const FIXED_CLOSE: Citation = {
  citation: 'Fixture Code zz-2-202b',
  sourceUrl: 'https://example.test/fixture-code/zz-2-202b',
  quote: 'Fixture rule: the filing period closes on the 56th day before the election.',
  validFrom: '2000-01-01',
  validTo: null,
};

/** zzRules whose filing track closes `days` before the election, with no roll. */
function closingOn(days: number): StateRules {
  return withTracks((track, date) => ({
    ...track,
    closesOn: { value: daysBefore(date, days), citation: FIXED_CLOSE },
  }));
}

/** 56 days before each fixture election, worked by hand: a Tuesday in September. */
const TUESDAY_CLOSES: Readonly<Record<string, string>> = {
  '2024-11-05': '2024-09-10',
  '2026-11-03': '2026-09-08',
  '2027-11-02': '2027-09-07',
};

const neverFixtures: readonly RulesFixture[] = zzFixtures.map((fixture) => ({
  ...fixture,
  cases: fixture.cases.map((fixtureCase) => ({
    ...fixtureCase,
    expect: fixtureCase.expect.map((expected) => ({
      ...expected,
      closesOn: TUESDAY_CLOSES[fixtureCase.contest.date] ?? fail(),
    })),
  })),
}));

const NEVER: NeverRolls = {
  never: true,
  fields: ['closesOn'],
  reason: 'Fixture rule: the closing day is always a Tuesday in September.',
};

function neverDeclaration(rolled: NeverRolls = NEVER): RuleDeclaration & { rolled: NeverRolls } {
  return { id: 'zz.nonpartisan', trackSet: 'zz_filing', track: 'nonpartisan', rolled };
}

function neverInput(rules: StateRules, rolled: NeverRolls = NEVER): StateSuiteInput {
  return {
    ...zzSuiteInput,
    rules,
    fixtures: neverFixtures,
    declaredRules: [neverDeclaration(rolled)],
  };
}

describe('a never-roll state passes every suite case', () => {
  runStateRulesSuite(neverInput(closingOn(56)));
});

describe('the never-roll declaration', () => {
  it('a never-roll rule passes when every date is a business day', async () => {
    await eachZone(async () => {
      const input = neverInput(closingOn(56));
      expect(checkThreeYearsAndRoll(input)).toEqual([]);
      expect(checkNeverRolls(input, neverDeclaration())).toEqual([]);
      expect(await allProblems(input)).toEqual([]);
    });
  });

  it('a never-roll rule that lands on a holiday fails', async () => {
    await eachZone(() => {
      const input = neverInput(closingOn(57));
      const problems = checkNeverRolls(input, neverDeclaration());
      expect(problems).toContainEqual({
        check: 'three_years_and_roll',
        where: 'zz.nonpartisan',
        detail:
          'rule zz.nonpartisan declared never to roll gives closesOn 2026-09-07, which is not a business day',
      });
      expect(problems.every((problem) => problem.check === 'three_years_and_roll')).toBe(true);
      // The suite case reaches the proof through checkThreeYearsAndRoll.
      expect(checkThreeYearsAndRoll(input)).toEqual(problems);
    });
  });

  it('a never-roll declaration needs a reason and fields', async () => {
    await eachZone(() => {
      const rules = closingOn(56);
      const short = checkNeverRolls(
        neverInput(rules, { ...NEVER, reason: 'short' }),
        neverDeclaration({ ...NEVER, reason: 'short' }),
      );
      expect(short).toEqual([
        expect.objectContaining({ check: 'three_years_and_roll', where: 'zz.nonpartisan' }),
      ]);
      const noFields = checkNeverRolls(
        neverInput(rules, { ...NEVER, fields: [] }),
        neverDeclaration({ ...NEVER, fields: [] }),
      );
      expect(noFields).toEqual([
        expect.objectContaining({ check: 'three_years_and_roll', where: 'zz.nonpartisan' }),
      ]);
      expect(noFields[0]?.detail).toContain('zz.nonpartisan');
    });
  });

  it('a never-roll rule with no date fails', async () => {
    await eachZone(() => {
      const silent: StateRules = { ...zzRules, filingTracks: () => [] };
      const input: StateSuiteInput = { ...zzSuiteInput, rules: silent };
      expect(checkNeverRolls(input, neverDeclaration())).toEqual([
        {
          check: 'three_years_and_roll',
          where: 'zz.nonpartisan',
          detail: 'rule zz.nonpartisan declared never to roll produced no date to check',
        },
      ]);
    });
  });

  it('a never-roll rule whose field is always null fails', async () => {
    await eachZone(() => {
      const input = neverInput(closingOn(56), { ...NEVER, fields: ['petitionDue'] });
      expect(
        checkNeverRolls(input, neverDeclaration({ ...NEVER, fields: ['petitionDue'] })),
      ).toEqual([
        expect.objectContaining({
          detail: expect.stringContaining('produced no date to check') as unknown,
        }),
      ]);
    });
  });

  it('a module that throws for a year is reported', async () => {
    await eachZone(() => {
      const base = closingOn(56);
      const throwing: StateRules = {
        ...base,
        contests: (args) => {
          if (args.year === 2031) {
            throw new RangeError('Fixture rule: no version is in force for 2031');
          }
          return base.contests(args);
        },
      };
      const problems = checkNeverRolls(neverInput(throwing), neverDeclaration());
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ check: 'three_years_and_roll', where: 'zz.nonpartisan' });
      expect(problems[0]?.detail).toContain('2031');
    });
  });

  it('a never-roll rule still needs three years', async () => {
    await eachZone(() => {
      const twoYears: StateSuiteInput = {
        ...neverInput(closingOn(56)),
        fixtures: neverFixtures.filter((fixture) => fixture.contests[0]?.year !== 2027),
      };
      expect(checkThreeYearsAndRoll(twoYears)).toEqual([
        expect.objectContaining({
          check: 'three_years_and_roll',
          where: 'zz.nonpartisan',
          detail: expect.stringContaining('at least three are needed') as unknown,
        }),
      ]);
    });
  });
});

function fail(): never {
  throw new Error('the ZZ fixture is missing a part this test reads');
}

/** A closing day that a holiday can move and that no fixture year shows moved: the third Tuesday in June. */
const JUNE_CLOSE: Citation = {
  citation: 'Fixture Code zz-2-202c',
  sourceUrl: 'https://example.test/fixture-code/zz-2-202c',
  quote:
    'Fixture rule: the filing period closes on the third Tuesday in June; a closing day that is not a business day moves to the next business day.',
  validFrom: '2000-01-01',
  validTo: null,
};

function yearOfDate(d: string): number {
  return Number(d.slice(0, 4));
}

/** zzRules closing on the third Tuesday in June of the contest's year, rolled forward when `rolls`. */
function juneRules(rolls = true): StateRules {
  return withTracks((track, date) => {
    const year = yearOfDate(date);
    const third = nthWeekdayOfMonth(year, 6, TUESDAY, 3);
    const value = rolls ? roll(third, 'next_business_day', zzRules.holidays(year)) : third;
    return { ...track, closesOn: { value, citation: JUNE_CLOSE } };
  });
}

/** The third Tuesday in June of each fixture year, worked by hand; none is a holiday. */
const JUNE_CLOSES: Readonly<Record<string, string>> = {
  '2024-11-05': '2024-06-18',
  '2026-11-03': '2026-06-16',
  '2027-11-02': '2027-06-15',
};

const juneFixtures: readonly RulesFixture[] = zzFixtures.map((fixture) => ({
  ...fixture,
  cases: fixture.cases.map((fixtureCase) => ({
    ...fixtureCase,
    expect: fixtureCase.expect.map((expected) => ({
      ...expected,
      closesOn: JUNE_CLOSES[fixtureCase.contest.date] ?? fail(),
    })),
  })),
}));

/** June 19 (Juneteenth, a federal holiday) is first the third Tuesday in June in 2029, worked by hand. */
const NOT_YET: NotYetRolled = {
  published: false,
  fields: [{ field: 'closesOn', weekday: TUESDAY }],
  direction: 'next_business_day',
  searchedYears: [2024, 2025, 2026, 2027],
  rollCase: { year: 2029, field: 'closesOn', unrolled: '2029-06-19', expected: '2029-06-20' },
  reason: 'Fixture rule: the third Tuesday in June, which no searched calendar shows moved.',
};

function notYetDeclaration(
  rolled: NotYetRolled = NOT_YET,
): RuleDeclaration & { rolled: NotYetRolled } {
  return { id: 'zz.nonpartisan', trackSet: 'zz_filing', track: 'nonpartisan', rolled };
}

function notYetInput(
  rules: StateRules = juneRules(),
  rolled: NotYetRolled = NOT_YET,
  fixtures: readonly RulesFixture[] = juneFixtures,
): StateSuiteInput {
  return { ...zzSuiteInput, rules, fixtures, declaredRules: [notYetDeclaration(rolled)] };
}

/** The problems of a not-yet-rolled declaration, with the module of `notYetInput`. */
function notYetProblems(
  change: Partial<NotYetRolled>,
  rules: StateRules = juneRules(),
): readonly SuiteProblem[] {
  const rolled = { ...NOT_YET, ...change };
  return checkNotYetRolled(notYetInput(rules, rolled), notYetDeclaration(rolled));
}

function details(problems: readonly SuiteProblem[]): string[] {
  return problems.map((problem) => problem.detail);
}

describe('a not-yet-rolled state passes every suite case', () => {
  runStateRulesSuite(notYetInput());
});

describe('the not-yet-rolled declaration', () => {
  it('a rule no searched year moved passes when the module rolls the roll case', async () => {
    await eachZone(async () => {
      const input = notYetInput();
      expect(checkNotYetRolled(input, notYetDeclaration())).toEqual([]);
      expect(checkThreeYearsAndRoll(input)).toEqual([]);
      expect(await allProblems(input)).toEqual([]);
    });
  });

  it('it needs a reason and declared fields, each once', async () => {
    await eachZone(() => {
      for (const change of [
        { reason: 'short' },
        { fields: [] },
        {
          fields: [
            { field: 'closesOn', weekday: TUESDAY },
            { field: 'closesOn', weekday: TUESDAY },
          ],
        },
      ] as const) {
        const problems = notYetProblems(change);
        expect(problems).toHaveLength(1);
        expect(problems[0]?.detail).toContain('needs at least one field, each once');
      }
    });
  });

  it('it needs three searched years in ascending order', async () => {
    await eachZone(() => {
      expect(details(notYetProblems({ searchedYears: [2026, 2027] }))).toEqual([
        expect.stringContaining('needs at least 3 searched years') as unknown,
      ]);
      expect(details(notYetProblems({ searchedYears: [2024, 2026, 2025, 2027] }))).toEqual([
        expect.stringContaining('ascending order') as unknown,
      ]);
    });
  });

  it('every fixtured contest year is a searched year', async () => {
    await eachZone(() => {
      expect(details(notYetProblems({ searchedYears: [2025, 2026, 2027] }))).toEqual([
        'rule zz.nonpartisan declared not yet rolled has a case in 2024, which is not a searched year',
      ]);
    });
  });

  it('a field whose weekday varies needs a case in every searched year', async () => {
    await eachZone(() => {
      expect(details(notYetProblems({ fields: [{ field: 'closesOn', weekday: null }] }))).toEqual([
        'rule zz.nonpartisan declared not yet rolled has a field whose weekday varies and no case in the searched year 2025',
      ]);
      expect(
        notYetProblems({
          fields: [{ field: 'closesOn', weekday: null }],
          searchedYears: [2024, 2026, 2027],
        }),
      ).toEqual([]);
    });
  });

  it('a searched year in which the module moved the date fails', async () => {
    await eachZone(() => {
      const base = juneRules();
      const moved2025: StateRules = {
        ...base,
        filingTracks: (args) =>
          base.filingTracks(args).map((track) =>
            yearOfDate(args.contest.date) === 2025
              ? {
                  ...track,
                  closesOn: { ...track.closesOn, value: addDays(track.closesOn.value, 1) },
                }
              : track,
          ),
      };
      expect(details(notYetProblems({}, moved2025))).toEqual([
        'rule zz.nonpartisan declared not yet rolled gives closesOn 2025-06-18 in the searched year 2025, off its declared weekday',
      ]);
    });
  });

  it('the roll case is after 2028, after the searched years and no later than 2060', async () => {
    await eachZone(() => {
      for (const year of [2028, 2061]) {
        expect(details(notYetProblems({ rollCase: { ...NOT_YET.rollCase, year } }))).toEqual([
          expect.stringContaining(`has its roll case in ${String(year)}`) as unknown,
        ]);
      }
      expect(
        details(
          notYetProblems({ searchedYears: [2024, 2025, 2026, 2027, 2029, 2030] }).filter(
            (problem) => problem.detail.includes('roll case in'),
          ),
        ),
      ).toEqual([expect.stringContaining('after 2030') as unknown]);
    });
  });

  it('the roll case names a declared field', async () => {
    await eachZone(() => {
      expect(
        details(notYetProblems({ rollCase: { ...NOT_YET.rollCase, field: 'opensOn' } })),
      ).toEqual([
        'rule zz.nonpartisan declared not yet rolled has its roll case on opensOn, which is not a declared field',
      ]);
    });
  });

  it('the unrolled date is on its weekday and is not a business day', async () => {
    await eachZone(() => {
      const offWeekday = details(
        notYetProblems({ rollCase: { ...NOT_YET.rollCase, unrolled: '2029-06-20' } }),
      );
      expect(offWeekday).toContain(
        'rule zz.nonpartisan declared not yet rolled has its unrolled closesOn 2029-06-20 off the declared weekday 2',
      );
      expect(offWeekday).toContain(
        'rule zz.nonpartisan declared not yet rolled has an unrolled closesOn 2029-06-20 that is a business day',
      );
      expect(
        details(notYetProblems({ rollCase: { ...NOT_YET.rollCase, unrolled: '2029-06-12' } })),
      ).toContain(
        'rule zz.nonpartisan declared not yet rolled has an unrolled closesOn 2029-06-12 that is a business day',
      );
    });
  });

  it('rolling the unrolled date in the declared direction gives the expected date, which differs', async () => {
    await eachZone(() => {
      expect(
        details(notYetProblems({ rollCase: { ...NOT_YET.rollCase, expected: '2029-06-21' } })),
      ).toEqual([
        'rule zz.nonpartisan declared not yet rolled rolls 2029-06-19 to the next_business_day to 2029-06-20; the roll case expects 2029-06-21',
        'rule zz.nonpartisan declared not yet rolled gives closesOn 2029-06-20 in 2029; the roll case expects 2029-06-21',
      ]);
      expect(details(notYetProblems({ direction: 'previous_business_day' }))).toContain(
        'rule zz.nonpartisan declared not yet rolled rolls 2029-06-19 to the previous_business_day to 2029-06-18; the roll case expects 2029-06-20',
      );
      expect(
        details(
          notYetProblems({
            rollCase: { ...NOT_YET.rollCase, unrolled: '2029-06-12', expected: '2029-06-12' },
          }),
        ),
      ).toContain(
        'rule zz.nonpartisan declared not yet rolled expects 2029-06-12, the unrolled date: it does not move',
      );
    });
  });

  it('a module that does not roll the roll case fails', async () => {
    await eachZone(() => {
      expect(details(notYetProblems({}, juneRules(false)))).toEqual([
        'rule zz.nonpartisan declared not yet rolled gives closesOn 2029-06-19 in 2029; the roll case expects 2029-06-20',
      ]);
    });
  });

  it('a roll case that is not the first year a holiday meets the field fails', async () => {
    await eachZone(() => {
      const later = {
        year: 2035,
        field: 'closesOn',
        unrolled: '2035-06-19',
        expected: '2035-06-20',
      } as const;
      expect(details(notYetProblems({ rollCase: later }))).toEqual([
        'rule zz.nonpartisan declared not yet rolled gives closesOn 2029-06-20 in 2029, before the roll case: the roll case is not the first year a holiday or weekend meets it',
      ]);
    });
  });

  it('a module that throws for a searched year, or gives no date in the roll year, fails', async () => {
    await eachZone(() => {
      const base = juneRules();
      const throwing: StateRules = {
        ...base,
        contests: (args) => {
          if (args.year === 2025) {
            throw new RangeError('Fixture rule: no version is in force for 2025');
          }
          return base.contests(args);
        },
      };
      expect(details(notYetProblems({}, throwing))).toEqual([
        'rule zz.nonpartisan declared not yet rolled cannot be proved: the module throws for 2025: Fixture rule: no version is in force for 2025',
      ]);
      const silent: StateRules = {
        ...base,
        contests: (args) => (args.year === 2029 ? [] : base.contests(args)),
      };
      expect(details(notYetProblems({}, silent))).toEqual([
        'rule zz.nonpartisan declared not yet rolled gives no closesOn in the roll year 2029',
      ]);
    });
  });

  it('a rule declared not yet rolled still needs three years', async () => {
    await eachZone(() => {
      const twoYears = notYetInput(
        juneRules(),
        NOT_YET,
        juneFixtures.filter((fixture) => fixture.contests[0]?.year !== 2027),
      );
      expect(checkThreeYearsAndRoll(twoYears)).toEqual([
        expect.objectContaining({
          detail: expect.stringContaining('at least three are needed') as unknown,
        }),
      ]);
    });
  });
});

/** A statute that sets the new regime, on the fixture state's official host. */
const REGIME_STATUTE: Citation = {
  citation: 'Fixture Code zz-9-901',
  sourceUrl: 'https://example.test/fixture-code/zz-9-901',
  quote: 'Fixture rule: the filing rule first applies to the elections of 2026.',
  validFrom: '2026-01-01',
  validTo: null,
};

const NEW: NewRegime = {
  newRegime: true,
  since: '2026-01-01',
  statute: REGIME_STATUTE,
  fields: ['closesOn'],
  reason: 'Fixture rule: the filing rule first applies to the elections of 2026.',
};

const TODAY = '2026-11-27';

/** The 2026 fixture alone, under a rule declared new from 2026. */
function newRegimeInput(
  years: NewRegime = NEW,
  rules: StateRules = zzRules,
  fixtures: readonly RulesFixture[] = [zzFixture(2026)],
): StateSuiteInput {
  const [rule] = zzSuiteInput.declaredRules;
  if (rule === undefined) {
    return fail();
  }
  return { ...zzSuiteInput, rules, fixtures, declaredRules: [{ ...rule, years }] };
}

/** zzRules with contests in 2026 only. */
const only2026: StateRules = {
  ...zzRules,
  contests: (args) => (args.year === 2026 ? zzRules.contests(args) : []),
};

describe('the new-regime declaration of a rule', () => {
  it('a rule with one published year passes while its regime is new', async () => {
    await eachZone(() => {
      expect(checkThreeYearsAndRoll(newRegimeInput(), TODAY)).toEqual([]);
      const undeclared: StateSuiteInput = {
        ...newRegimeInput(),
        declaredRules: zzSuiteInput.declaredRules,
      };
      expect(details(checkThreeYearsAndRoll(undeclared, TODAY))).toEqual([
        expect.stringContaining('at least three are needed') as unknown,
      ]);
    });
  });

  it('it fails once since is more than six years before today', async () => {
    await eachZone(() => {
      const input = newRegimeInput(NEW, only2026);
      expect(checkThreeYearsAndRoll(input, '2032-01-01')).toEqual([]);
      expect(details(checkThreeYearsAndRoll(input, '2032-01-02'))).toEqual([
        'zz.nonpartisan declared a new regime since 2026-01-01, more than 6 years before today 2032-01-02: its third published year must be found',
      ]);
    });
  });

  it('since is a date no later than today', async () => {
    await eachZone(() => {
      expect(
        details(checkThreeYearsAndRoll(newRegimeInput({ ...NEW, since: '2026-13-01' }), TODAY)),
      ).toEqual([
        'zz.nonpartisan declared a new regime gives since "2026-13-01", which is not a date',
      ]);
      expect(
        details(
          checkThreeYearsAndRoll(newRegimeInput({ ...NEW, since: '2027-01-01' }, only2026), TODAY),
        ),
      ).toEqual([
        'zz.nonpartisan declared a new regime since 2027-01-01, after today 2026-11-27',
        'zz.nonpartisan declared a new regime since 2027-01-01 has a case in 2026, before its regime',
      ]);
    });
  });

  it('every published year from since to today is fixtured', async () => {
    await eachZone(() => {
      // 2027's filing closes on 2027-08-30: published once that day has passed.
      expect(checkThreeYearsAndRoll(newRegimeInput(), '2027-08-29')).toEqual([]);
      expect(details(checkThreeYearsAndRoll(newRegimeInput(), '2027-08-30'))).toEqual([
        'zz.nonpartisan declared a new regime has a published nonpartisan date in 2027 and no case in that year',
      ]);
      expect(
        checkThreeYearsAndRoll(
          newRegimeInput(NEW, zzRules, [zzFixture(2026), zzFixture(2027)]),
          '2027-11-27',
        ),
      ).toEqual([]);
    });
  });

  it('no case is dated before since', async () => {
    await eachZone(() => {
      expect(
        details(
          checkThreeYearsAndRoll(
            newRegimeInput(NEW, zzRules, [zzFixture(2024), zzFixture(2026)]),
            TODAY,
          ),
        ),
      ).toEqual([
        'zz.nonpartisan declared a new regime since 2026-01-01 has a case in 2024, before its regime',
      ]);
    });
  });

  it('the statute is cited with a quote over https on an official host', async () => {
    await eachZone(() => {
      for (const statute of [
        { ...REGIME_STATUTE, sourceUrl: 'http://example.test/fixture-code/zz-9-901' },
        { ...REGIME_STATUTE, sourceUrl: 'https://fixture-elsewhere.test/zz-9-901' },
        { ...REGIME_STATUTE, sourceUrl: 'not a link' },
        { ...REGIME_STATUTE, quote: ' ' },
        { ...REGIME_STATUTE, citation: '' },
      ]) {
        expect(details(checkThreeYearsAndRoll(newRegimeInput({ ...NEW, statute }), TODAY))).toEqual(
          [expect.stringContaining('without a quote or an https link on example.test') as unknown],
        );
      }
    });
  });

  it('it needs a reason and fields', async () => {
    await eachZone(() => {
      for (const change of [{ reason: 'short' }, { fields: [] }] as const) {
        expect(
          details(checkThreeYearsAndRoll(newRegimeInput({ ...NEW, ...change }), TODAY)),
        ).toEqual([
          'zz.nonpartisan declared a new regime needs at least one field and a reason of 20 characters',
        ]);
      }
    });
  });

  it('a module that throws for a year of the regime fails', async () => {
    await eachZone(() => {
      const throwing: StateRules = {
        ...zzRules,
        contests: (args) => {
          if (args.year === 2027) {
            throw new RangeError('Fixture rule: no version is in force for 2027');
          }
          return zzRules.contests(args);
        },
      };
      expect(details(checkThreeYearsAndRoll(newRegimeInput(NEW, throwing), '2027-01-15'))).toEqual([
        'zz.nonpartisan declared a new regime cannot be proved: the module throws for 2027: Fixture rule: no version is in force for 2027',
      ]);
    });
  });

  it("the suite measures against the checker's own today", async () => {
    await eachZone(() => {
      expect(checkerToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const input = newRegimeInput(NEW, only2026);
      expect(checkThreeYearsAndRoll(input)).toEqual(checkThreeYearsAndRoll(input, checkerToday()));
    });
  });
});

const PARTISAN_COMMISSION: StateSuiteInput = {
  ...zzSuiteInput,
  partisanOfficeTypes: ['county-commission'],
};

function filers(years: NewRegime = NEW, officeTypeId = 'county-commission'): FilerDeclaration[] {
  return [
    { officeTypeId, track: 'party_primary', years },
    { officeTypeId, track: 'independent', years },
  ];
}

describe('the new-regime declaration of a filer case', () => {
  it('a partisan office type whose filer cases the regime cannot have yet passes', async () => {
    await eachZone(() => {
      expect(
        checkPartyAndIndependent({ ...PARTISAN_COMMISSION, newRegimeFilers: filers() }, TODAY),
      ).toEqual([]);
      expect(checkPartyAndIndependent(PARTISAN_COMMISSION, TODAY)).toHaveLength(2);
    });
  });

  it('it fails once since is more than six years before today', async () => {
    await eachZone(() => {
      const input = { ...PARTISAN_COMMISSION, newRegimeFilers: filers() };
      expect(details(checkPartyAndIndependent(input, '2032-01-02'))).toEqual([
        'county-commission party_primary declared a new regime since 2026-01-01, more than 6 years before today 2032-01-02: its third published year must be found',
        'county-commission independent declared a new regime since 2026-01-01, more than 6 years before today 2032-01-02: its third published year must be found',
      ]);
    });
  });

  it('a published filer year with no case fails', async () => {
    await eachZone(() => {
      const independents = withTracks((track) => ({ ...track, track: 'independent' }));
      const input = {
        ...PARTISAN_COMMISSION,
        rules: independents,
        newRegimeFilers: filers().filter((filer) => filer.track === 'independent'),
      };
      const problems = checkPartyAndIndependent(input, TODAY);
      expect(details(problems)).toContain(
        'county-commission independent declared a new regime has a published independent date in 2026 and no case in that year',
      );
      expect(problems.every((problem) => problem.check === 'party_and_independent')).toBe(true);
    });
  });

  it('an unofficial statute fails', async () => {
    await eachZone(() => {
      const statute = { ...REGIME_STATUTE, sourceUrl: 'https://fixture-elsewhere.test/zz-9-901' };
      const input = { ...PARTISAN_COMMISSION, newRegimeFilers: filers({ ...NEW, statute }) };
      expect(checkPartyAndIndependent(input, TODAY)).toHaveLength(2);
    });
  });

  it('a declared office type that the state does not pass, or that no case states, fails', async () => {
    await eachZone(() => {
      expect(
        details(
          checkPartyAndIndependent(
            { ...PARTISAN_COMMISSION, newRegimeFilers: filers(NEW, 'zz-board') },
            TODAY,
          ),
        ),
      ).toEqual([
        'zz-board party_primary declared a new regime for an office type the state does not pass as partisan',
        'zz-board independent declared a new regime for an office type the state does not pass as partisan',
        'no case expects a party_primary track',
        'no case expects a independent track',
      ]);
      const board = {
        ...PARTISAN_COMMISSION,
        partisanOfficeTypes: ['county-commission', 'zz-board'],
        newRegimeFilers: [...filers(), ...filers(NEW, 'zz-board')],
      };
      expect(details(checkPartyAndIndependent(board, TODAY))).toEqual([
        'zz-board party_primary declared a new regime has no fixture case whose office the module can be run on',
        'zz-board independent declared a new regime has no fixture case whose office the module can be run on',
      ]);
    });
  });
});
