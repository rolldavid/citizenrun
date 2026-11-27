import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { VA_FIXTURES } from '../__fixtures__/va/index.ts';
import { TUESDAY, isBusinessDay, novemberElectionDay, nthWeekdayOfMonth, roll } from '../dates.ts';
import { runStateRulesSuite } from '../testing/check-fixtures.ts';
import type { RuleDeclaration } from '../testing/check-fixtures.ts';
import type { ContestRef, OfficeRef } from '../types.ts';
import { vaRules } from './va.ts';

/**
 * The rules the fixtures exercise. The § 24.2-507 deadline (the third Tuesday in June) of the
 * va_partisan independent track and the va_nonpartisan track is not declared: June 19 is a legal
 * holiday and meets that Tuesday in 2029, no published calendar shows the deadline moved, and the
 * statute's own text on a deadline that falls on a holiday was not retrieved (PIPE-rules-fixtures
 * rule 5: such a rule fits no declared form).
 */
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

  it('the third Tuesday in June meets Juneteenth in 2029', async () => {
    await eachZone(() => {
      const contest: ContestRef = { date: '2029-11-06', kind: 'general', party: null };
      const track = only(vaRules.filingTracks({ office: office({}), contest }));
      expect(track.closesOn.value).toBe('2029-06-19');
      expect(isBusinessDay('2029-06-19', vaRules.holidays(2029))).toBe(false);
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
