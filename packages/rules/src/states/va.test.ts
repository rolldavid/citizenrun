import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { VA_FIXTURES } from '../__fixtures__/va/index.ts';
import { TUESDAY, isBusinessDay, novemberElectionDay, nthWeekdayOfMonth, roll } from '../dates.ts';
import { runStateRulesSuite } from '../testing/check-fixtures.ts';
import type { NotYetRolled, RuleDeclaration } from '../testing/check-fixtures.ts';
import type { ContestRef, OfficeRef } from '../types.ts';
import { vaRules } from './va.ts';

/**
 * The § 24.2-507 deadline, 7:00 p.m. on the third Tuesday in June, of the va_partisan independent
 * track and the va_nonpartisan track: June 19 is a legal holiday that first meets that Tuesday in
 * 2029, after every searched calendar (2022 to 2026), and the Department of Elections points a
 * deadline on a holiday to the next day that is not a Saturday, Sunday or legal holiday (§ 1-210(C),
 * D-889). The roll case is worked by hand: the third Tuesday in June 2029 is June 19, Juneteenth,
 * and the next business day is Wednesday, June 20, 2029. It is never a fixture (D-380).
 */
const JUNE_DEADLINE_NOT_YET_ROLLED: NotYetRolled = {
  published: false,
  fields: [{ field: 'closesOn', weekday: TUESDAY }],
  direction: 'next_business_day',
  searchedYears: [2022, 2023, 2024, 2025, 2026],
  rollCase: { year: 2029, field: 'closesOn', unrolled: '2029-06-19', expected: '2029-06-20' },
  reason:
    'The third Tuesday in June is June 19, a legal holiday, first in 2029; no bulletin of 2022 to 2026 shows the deadline moved',
};

/** The rules the fixtures exercise. */
const DECLARED_RULES: readonly RuleDeclaration[] = [
  {
    id: 'va.va_partisan.party_primary',
    trackSet: 'va_partisan',
    track: 'party_primary',
    // HB 29 (2026) gave the 2026 House primary a closing day on Memorial Day; the Department of
    // Elections extended it to the next day.
    rolled: {
      caseId: 'va-2026-us-house-primary',
      field: 'closesOn',
      unrolled: '2026-05-25',
      direction: 'next_business_day',
    },
  },
  {
    id: 'va.va_partisan.independent',
    trackSet: 'va_partisan',
    track: 'independent',
    rolled: JUNE_DEADLINE_NOT_YET_ROLLED,
  },
  {
    id: 'va.va_nonpartisan.nonpartisan',
    trackSet: 'va_nonpartisan',
    track: 'nonpartisan',
    rolled: JUNE_DEADLINE_NOT_YET_ROLLED,
  },
];

const PARTISAN_OFFICE_TYPES = [
  'us-senate',
  'us-house',
  'governor',
  'statewide-executive-other',
  'attorney-general',
  'state-senate',
  'state-house',
  'sheriff',
  'district-attorney',
  'county-treasurer',
  'county-assessor',
  'county-row-other',
  'county-commission',
  'city-council',
  'mayor',
];

runStateRulesSuite({
  state: 'VA',
  rules: vaRules,
  fixtures: VA_FIXTURES,
  declaredRules: DECLARED_RULES,
  officialHosts: ['elections.virginia.gov', 'law.lis.virginia.gov'],
  partisanOfficeTypes: PARTISAN_OFFICE_TYPES,
  partyPrimaryExempt: false,
});

function office(overrides: Partial<OfficeRef>): OfficeRef {
  return {
    state: 'VA',
    templateKey: 'county-commission',
    officeTypeId: 'county-commission',
    jurisdictionKind: 'county',
    countyGeoid: '51087',
    partisan: true,
    schedule: 'va_june_primary',
    trackSet: 'va_partisan',
    staggerGroup: null,
    termYears: 4,
    payAnnualCents: null,
    population: null,
    ...overrides,
  };
}

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  const [item] = items;
  if (item === undefined) {
    throw new Error('expected one item');
  }
  return item;
}

describe('VA rules module', () => {
  it('the primary window is the 92nd to the 75th day', async () => {
    // The rule's arithmetic for the 2027-06-15 primary, worked by hand; no calendar publishes it yet.
    await eachZone(() => {
      const contest: ContestRef = { date: '2027-06-15', kind: 'primary', party: 'democratic' };
      const track = only(vaRules.filingTracks({ office: office({}), contest }));
      expect(track.track).toBe('party_primary');
      expect(track.opensOn?.value).toBe('2027-03-15');
      expect(track.closesOn.value).toBe('2027-04-01');
      expect(track.closesTime?.value).toBe('17:00');
      expect(track.closesTime?.citation.quote).toContain('5:00 p.m.');
    });
  });

  it('independents file by 7 p.m. on the third Tuesday in June', async () => {
    await eachZone(() => {
      for (const year of [2026, 2027, 2028]) {
        const contest: ContestRef = {
          date: novemberElectionDay(year),
          kind: 'general',
          party: null,
        };
        const track = only(vaRules.filingTracks({ office: office({}), contest }));
        expect(track.track).toBe('independent');
        expect(track.opensOn).toBeNull();
        expect(track.closesOn.value).toBe(nthWeekdayOfMonth(year, 6, TUESDAY, 3));
        expect(track.closesTime?.value).toBe('19:00');
        expect(track.closesTime?.citation.quote).toMatch(/7:00 p\.?m/);
      }
    });
  });

  it('the statewide cycle is in odd years', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2032; year++) {
        const generals = vaRules
          .contests({
            office: office({ officeTypeId: 'governor', jurisdictionKind: 'state' }),
            year,
          })
          .filter((c) => c.kind === 'general');
        expect(generals.length).toBe(year === 2025 || year === 2029 ? 1 : 0);
      }
    });
  });

  it('Election Day is a Virginia holiday when the statute lists it', async () => {
    await eachZone(() => {
      const holiday = vaRules.holidays(2026).holidays.find((h) => h.date === '2026-11-03');
      expect(holiday?.name).toBe('Election Day');
      expect(holiday?.citation.citation).toBe('Va. Code § 2.2-3300');
      expect(holiday?.citation.quote).toContain('Election Day');
    });
  });

  it('holidays are cited', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year++) {
        const { holidays } = vaRules.holidays(year);
        expect(holidays.length).toBeGreaterThanOrEqual(13);
        for (const holiday of holidays) {
          expect(new URL(holiday.citation.sourceUrl).protocol).toBe('https:');
          expect(holiday.citation.quote.trim()).not.toBe('');
          expect(holiday.date.startsWith(`${String(year)}-`)).toBe(true);
        }
      }
    });
  });

  it('each holiday the rules can meet rolls', async () => {
    await eachZone(() => {
      // Memorial Day 2026, the closing day of the 2026 House primary window before it moved.
      const cal2026 = vaRules.holidays(2026);
      expect(roll('2026-05-25', 'next_business_day', cal2026)).toBe('2026-05-26');
      expect(roll('2026-05-24', 'previous_business_day', cal2026)).toBe('2026-05-22');
      // Juneteenth 2029, the third Tuesday in June of that year.
      const cal2029 = vaRules.holidays(2029);
      expect(roll('2029-06-19', 'next_business_day', cal2029)).toBe('2029-06-20');
      expect(roll('2029-06-17', 'previous_business_day', cal2029)).toBe('2029-06-15');
    });
  });

  it('the third Tuesday in June meets Juneteenth in 2029 and moves to the next day', async () => {
    await eachZone(() => {
      const contest: ContestRef = { date: '2029-11-06', kind: 'general', party: null };
      const track = only(vaRules.filingTracks({ office: office({}), contest }));
      expect(isBusinessDay('2029-06-19', vaRules.holidays(2029))).toBe(false);
      expect(track.closesOn.value).toBe('2029-06-20');
      expect(track.closesOn.citation.citation).toBe('Va. Code § 1-210(C)');
      expect(track.closesTime?.value).toBe('19:00');
      const unmoved = only(
        vaRules.filingTracks({
          office: office({}),
          contest: { date: '2028-11-07', kind: 'general', party: null },
        }),
      );
      expect(unmoved.closesOn.value).toBe('2028-06-20');
      expect(unmoved.closesOn.citation.citation).toBe('Va. Code § 24.2-507');
    });
  });

  it('every schedule and track set answers', async () => {
    await eachZone(() => {
      for (const year of [2026, 2027]) {
        for (const schedule of vaRules.schedules) {
          expect(() => vaRules.contests({ office: office({ schedule }), year })).not.toThrow();
        }
        for (const trackSet of vaRules.trackSets) {
          for (const contest of [
            { date: `${String(year)}-06-15`, kind: 'primary', party: 'republican' },
            { date: `${String(year)}-11-02`, kind: 'general', party: null },
          ] satisfies ContestRef[]) {
            expect(() =>
              vaRules.filingTracks({ office: office({ trackSet }), contest }),
            ).not.toThrow();
          }
        }
      }
    });
  });

  it('an unknown schedule throws', async () => {
    await eachZone(() => {
      expect(() =>
        vaRules.contests({ office: office({ schedule: 'va_unknown' }), year: 2027 }),
      ).toThrow(RangeError);
      expect(() =>
        vaRules.filingTracks({
          office: office({ trackSet: 'va_unknown' }),
          contest: { date: '2027-11-02', kind: 'general', party: null },
        }),
      ).toThrow(RangeError);
    });
  });

  it('the ids with no output by statute return nothing', async () => {
    await eachZone(() => {
      for (let year = 2023; year <= 2030; year++) {
        expect(vaRules.contests({ office: office({ schedule: 'va_may_general' }), year })).toEqual(
          [],
        );
        expect(
          vaRules.contests({ office: office({ schedule: 'va_no_public_election' }), year }),
        ).toEqual([]);
        expect(
          vaRules.filingTracks({
            office: office({ trackSet: 'va_may' }),
            contest: { date: `${String(year)}-05-04`, kind: 'general', party: null },
          }),
        ).toEqual([]);
      }
    });
  });

  it('the 2026 primary moved to August 4 and the window stayed in March', async () => {
    await eachZone(() => {
      const contests = vaRules.contests({
        office: office({ officeTypeId: 'state-house' }),
        year: 2027,
      });
      expect(contests.map((c) => c.date)).toEqual(['2027-06-15', '2027-06-15', '2027-11-02']);
      const senate = vaRules.contests({
        office: office({ officeTypeId: 'us-senate', jurisdictionKind: 'state' }),
        year: 2026,
      });
      expect(senate.filter((c) => c.kind === 'primary').map((c) => c.date)).toEqual([
        '2026-08-04',
        '2026-08-04',
      ]);
      const track = only(
        vaRules.filingTracks({
          office: office({ officeTypeId: 'us-senate' }),
          contest: { date: '2026-08-04', kind: 'primary', party: 'republican' },
        }),
      );
      expect([track.opensOn?.value, track.closesOn.value]).toEqual(['2026-03-16', '2026-04-02']);
    });
  });

  it('runoffs and nonpartisan primaries have no filing track', async () => {
    await eachZone(() => {
      for (const kind of ['primary_runoff', 'general_runoff', 'special'] as const) {
        const contest: ContestRef = { date: '2027-07-13', kind, party: null };
        expect(vaRules.filingTracks({ office: office({}), contest })).toEqual([]);
      }
      expect(
        vaRules.filingTracks({
          office: office({ trackSet: 'va_nonpartisan' }),
          contest: { date: '2027-06-15', kind: 'primary', party: 'democratic' },
        }),
      ).toEqual([]);
    });
  });

  it('certification follows the canvass statutes', async () => {
    await eachZone(() => {
      const general: ContestRef = { date: '2027-11-02', kind: 'general', party: null };
      expect(
        vaRules.certificationDate({
          office: office({ officeTypeId: 'state-senate' }),
          contest: general,
        })?.value,
      ).toBe('2027-12-06');
      expect(vaRules.certificationDate({ office: office({}), contest: general })?.value).toBe(
        '2027-11-12',
      );
      expect(
        vaRules.certificationDate({
          office: office({}),
          contest: { date: '2023-11-07', kind: 'general', party: null },
        })?.value,
      ).toBe('2023-11-14');
      expect(
        vaRules.certificationDate({
          office: office({}),
          contest: { date: '2027-06-15', kind: 'primary', party: 'democratic' },
        }),
      ).toBeNull();
    });
  });

  it('county pay is not known yet', async () => {
    await eachZone(() => {
      expect(
        vaRules.countyPay({ office: office({ officeTypeId: 'sheriff' }), year: 2027 }),
      ).toBeNull();
    });
  });

  it('holidays are served from 2021 to 2100', async () => {
    await eachZone(() => {
      expect(() => vaRules.holidays(2020)).toThrow(RangeError);
      expect(() => vaRules.holidays(2101)).toThrow(RangeError);
      expect(vaRules.holidays(2100).year).toBe(2100);
      // Juneteenth is in the list from March 1, 2021; New Year's Day 2022, a Saturday, is
      // observed on Friday, December 31, 2021.
      const dates2021 = vaRules.holidays(2021).holidays.map((h) => h.date);
      expect(dates2021).toContain('2021-06-18');
      expect(dates2021).toContain('2021-12-31');
    });
  });
});

/**
 * The election years of each by-district template key from 2026 to 2031, read by hand from the
 * Department of Elections' schedules (the column each district's cells sit in): the city council
 * and city school board schedules of November in even years (2026, 2028, 2030) and the county board
 * of supervisors and county school board schedules (2027, 2029, 2031).
 */
const VA_KEY_YEARS: readonly {
  readonly keys: readonly string[];
  readonly officeTypeId: string;
  readonly jurisdictionKind: OfficeRef['jurisdictionKind'];
  readonly years: readonly number[];
}[] = [
  {
    keys: [1, 3, 5, 7].flatMap((n) => [
      `virginia-beach-city-council-district-${String(n)}`,
      `virginia-beach-school-board-district-${String(n)}`,
    ]),
    officeTypeId: 'city-council',
    jurisdictionKind: 'city',
    years: [2028],
  },
  {
    keys: [2, 4, 6, 8, 9, 10].flatMap((n) => [
      `virginia-beach-city-council-district-${String(n)}`,
      `virginia-beach-school-board-district-${String(n)}`,
    ]),
    officeTypeId: 'city-council',
    jurisdictionKind: 'city',
    years: [2026, 2030],
  },
  {
    keys: ['richmond-city-council', 'richmond-school-board'],
    officeTypeId: 'city-council',
    jurisdictionKind: 'city',
    years: [2028],
  },
  {
    keys: ['norfolk-city-council-ward', 'norfolk-school-board-ward'],
    officeTypeId: 'city-council',
    jurisdictionKind: 'city',
    years: [2026, 2030],
  },
  {
    keys: [
      'norfolk-city-council-superward-6',
      'norfolk-city-council-superward-7',
      'norfolk-school-board-superward-6',
      'norfolk-school-board-superward-7',
    ],
    officeTypeId: 'city-council',
    jurisdictionKind: 'city',
    years: [2028],
  },
  {
    keys: ['brookland', 'fairfield', 'three-chopt', 'tuckahoe', 'varina'].flatMap((d) => [
      `henrico-board-of-supervisors-${d}`,
      `henrico-school-board-${d}`,
    ]),
    officeTypeId: 'county-commission',
    jurisdictionKind: 'county',
    years: [2027, 2031],
  },
];

describe('VA by-district offices by template key (D-894)', () => {
  it('each key has a contest only in its schedule years', async () => {
    await eachZone(() => {
      for (const group of VA_KEY_YEARS) {
        for (const templateKey of group.keys) {
          for (const [schedule, trackSet] of [
            ['va_november_general', 'va_nonpartisan'],
            ['va_june_primary', 'va_partisan'],
          ] as const) {
            const keyed = office({
              templateKey,
              officeTypeId: group.officeTypeId,
              jurisdictionKind: group.jurisdictionKind,
              schedule,
              trackSet,
            });
            const years: number[] = [];
            for (let year = 2026; year <= 2031; year++) {
              const generals = vaRules
                .contests({ office: keyed, year })
                .filter((c) => c.kind === 'general');
              expect(generals.length).toBeLessThanOrEqual(1);
              if (generals.length === 1) {
                years.push(year);
                expect(generals[0]?.date).toBe(novemberElectionDay(year));
              }
              // A partisan keyed office has its primaries in the same years only.
              const primaries = vaRules
                .contests({ office: keyed, year })
                .filter((c) => c.kind === 'primary');
              expect(primaries.length).toBe(
                schedule === 'va_june_primary' && generals.length === 1 ? 2 : 0,
              );
            }
            expect(years).toEqual(group.years);
          }
        }
      }
    });
  });

  it('the four-year cycle runs on after the schedules', async () => {
    await eachZone(() => {
      const keyed = (templateKey: string) =>
        office({ templateKey, schedule: 'va_november_general', trackSet: 'va_nonpartisan' });
      const years = (templateKey: string) =>
        [2032, 2033, 2034, 2035].filter(
          (year) => vaRules.contests({ office: keyed(templateKey), year }).length > 0,
        );
      expect(years('virginia-beach-city-council-district-1')).toEqual([2032]);
      expect(years('virginia-beach-city-council-district-2')).toEqual([2034]);
      expect(years('henrico-board-of-supervisors-varina')).toEqual([2035]);
    });
  });

  it('a key with no cycle keeps the office type years', async () => {
    await eachZone(() => {
      for (let year = 2026; year <= 2031; year++) {
        const unkeyed = office({
          templateKey: 'chesapeake-city-council',
          officeTypeId: 'city-council',
          jurisdictionKind: 'city',
          schedule: 'va_november_general',
          trackSet: 'va_nonpartisan',
        });
        const [general] = vaRules.contests({ office: unkeyed, year });
        expect(general?.date).toBe(novemberElectionDay(year));
        expect(general?.dateCitation.citation).toBe('Va. Code § 2.2-3300');
        // A keyed office's type alone does not move a statewide or constitutional cycle.
        const sheriff = office({
          templateKey: 'sheriff',
          officeTypeId: 'sheriff',
          jurisdictionKind: 'county',
          schedule: 'va_november_general',
        });
        expect(vaRules.contests({ office: sheriff, year }).length).toBe(year % 4 === 3 ? 1 : 0);
      }
    });
  });

  it('each keyed general cites its schedule with an https link and a quote', async () => {
    await eachZone(() => {
      for (const group of VA_KEY_YEARS) {
        for (const templateKey of group.keys) {
          for (const year of group.years) {
            const [general] = vaRules.contests({
              office: office({
                templateKey,
                officeTypeId: group.officeTypeId,
                jurisdictionKind: group.jurisdictionKind,
                schedule: 'va_november_general',
                trackSet: 'va_nonpartisan',
              }),
              year,
            });
            const citation = general?.dateCitation;
            expect(citation?.sourceUrl).toMatch(
              /^https:\/\/www\.elections\.virginia\.gov\/media\/boardpapers\/calendar\/[^/]+\.pdf$/,
            );
            expect(citation?.citation).toMatch(/^Department of Elections, /);
            expect(citation?.quote.length).toBeGreaterThan(40);
            expect(citation?.validTo).toBeNull();
          }
        }
      }
    });
  });

  it('a keyed office files on the same deadline as any other', async () => {
    await eachZone(() => {
      const contest: ContestRef = { date: '2028-11-07', kind: 'general', party: null };
      const keyed = only(
        vaRules.filingTracks({
          office: office({
            templateKey: 'richmond-city-council',
            officeTypeId: 'city-council',
            jurisdictionKind: 'city',
            schedule: 'va_november_general',
            trackSet: 'va_nonpartisan',
          }),
          contest,
        }),
      );
      const plain = only(
        vaRules.filingTracks({
          office: office({
            officeTypeId: 'city-council',
            jurisdictionKind: 'city',
            schedule: 'va_november_general',
            trackSet: 'va_nonpartisan',
          }),
          contest,
        }),
      );
      expect(keyed).toEqual(plain);
    });
  });
});
