import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { daysBefore, roll } from '../dates.ts';
import type { Citation, RulesFixture, StateRules, TrackOut } from '../types.ts';
import {
  checkCitesStatute,
  checkCyclesPresent,
  checkMatchesCalendar,
  checkNeverRolls,
  checkOfficialSource,
  checkPartyAndIndependent,
  checkThreeYearsAndRoll,
  checkValidFrom,
  checkZoneProof,
  fixtureOffice,
  runStateRulesSuite,
} from './check-fixtures.ts';
import type {
  NeverRolls,
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
