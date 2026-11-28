import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { WA_FIXTURES } from '../__fixtures__/wa/index.ts';
import { roll } from '../dates.ts';
import { runStateRulesSuite } from '../testing/check-fixtures.ts';
import type { RuleDeclaration } from '../testing/check-fixtures.ts';
import type { ContestRef, OfficeRef, TrackOut } from '../types.ts';
import { waRules } from './wa.ts';

/**
 * The filing week is RCW 29A.24.050's Monday to Friday in early May, a week no legal holiday of
 * RCW 1.16.050 can reach (Memorial Day is the last Monday of May), so no published year shows a roll.
 */
const DECLARED_RULES: readonly RuleDeclaration[] = [
  {
    id: 'wa.wa_filing_week.nonpartisan',
    trackSet: 'wa_filing_week',
    track: 'nonpartisan',
    rolled: {
      never: true,
      fields: ['opensOn', 'closesOn'],
      reason:
        'RCW 29A.24.050 fixes the first Monday in May and the following Friday, and RCW 1.16.050 names no holiday in that week.',
    },
  },
];

// Top-two primary: every candidate files on the one nonpartisan track, so the suite gets no
// partisan office type and no party-primary case (PIPE-rules-fixtures rule 2).
runStateRulesSuite({
  state: 'WA',
  rules: waRules,
  fixtures: WA_FIXTURES,
  declaredRules: DECLARED_RULES,
  officialHosts: ['sos.wa.gov', 'app.leg.wa.gov'],
  partisanOfficeTypes: [],
  partyPrimaryExempt: true,
});

function office(overrides: Partial<OfficeRef>): OfficeRef {
  return {
    state: 'WA',
    templateKey: 'county-commissioner',
    officeTypeId: 'county-commission',
    jurisdictionKind: 'county',
    countyGeoid: '53067',
    partisan: true,
    schedule: 'wa_county_general',
    trackSet: 'wa_filing_week',
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

const SCHEDULE_OFFICES: Readonly<Record<string, Partial<OfficeRef>>> = {
  wa_state_general: {
    templateKey: 'state-house',
    officeTypeId: 'state-house',
    jurisdictionKind: 'state',
  },
  wa_county_general: {},
  wa_charter_county_odd_year: { templateKey: 'county-executive', officeTypeId: 'county-executive' },
  wa_local_odd_year: {
    templateKey: 'city-council',
    officeTypeId: 'city-council',
    jurisdictionKind: 'city',
  },
  wa_state_primary: {
    templateKey: 'precinct-committee-officer',
    officeTypeId: 'party-precinct-committee',
    jurisdictionKind: 'party',
  },
  wa_conservation_district: {
    templateKey: 'conservation-supervisor',
    officeTypeId: 'soil-water-conservation-board',
    jurisdictionKind: 'special_district',
    trackSet: 'wa_no_filing',
  },
  wa_no_public_election: { trackSet: 'wa_no_filing' },
};

function allTracks(year: number): readonly TrackOut[] {
  return waRules.schedules.flatMap((schedule) => {
    const ref = office({ ...SCHEDULE_OFFICES[schedule], schedule });
    return waRules
      .contests({ office: ref, year })
      .flatMap((contest) => waRules.filingTracks({ office: ref, contest }));
  });
}

describe('WA rules module', () => {
  it('filing week 2027 is 3 to 7 May with withdrawal on 10 May', async () => {
    await eachZone(() => {
      const contest: ContestRef = { date: '2027-11-02', kind: 'general', party: null };
      const track = only(waRules.filingTracks({ office: office({}), contest }));
      expect(track.track).toBe('nonpartisan');
      expect(track.opensOn?.value).toBe('2027-05-03');
      expect(track.closesOn.value).toBe('2027-05-07');
      expect(track.withdrawalDeadline?.value).toBe('2027-05-10');
      expect(track.closesTime?.value).toBe('17:00');
      expect(track.closesTime?.citation.quote).toContain('5:00 p.m.');
      expect(track.closesTime?.citation.citation).toBe('RCW 29A.24.050');
    });
  });

  it('every office files in the same week', async () => {
    await eachZone(() => {
      const contest: ContestRef = { date: '2026-11-03', kind: 'general', party: null };
      const offices = [
        office({
          templateKey: 'governor',
          officeTypeId: 'governor',
          jurisdictionKind: 'state',
          schedule: 'wa_state_general',
        }),
        office({
          templateKey: 'state-senate',
          officeTypeId: 'state-senate',
          jurisdictionKind: 'state',
          schedule: 'wa_state_general',
        }),
        office({}),
        office({
          templateKey: 'fire-commissioner',
          officeTypeId: 'fire-district-board',
          jurisdictionKind: 'special_district',
          schedule: 'wa_local_odd_year',
        }),
      ];
      for (const ref of offices) {
        const track = only(waRules.filingTracks({ office: ref, contest }));
        expect(track.opensOn?.value).toBe('2026-05-04');
        expect(track.closesOn.value).toBe('2026-05-08');
      }
    });
  });

  it('certification follows the canvass statute', async () => {
    await eachZone(() => {
      const county = office({});
      const statewide = office({
        templateKey: 'governor',
        officeTypeId: 'governor',
        jurisdictionKind: 'state',
        schedule: 'wa_state_general',
      });
      const primary: ContestRef = { date: '2027-08-03', kind: 'primary', party: null };
      const general: ContestRef = { date: '2027-11-02', kind: 'general', party: null };
      const cases: readonly [OfficeRef, ContestRef, string, string][] = [
        [county, primary, '2027-08-17', 'RCW 29A.60.190'],
        [county, general, '2027-11-23', 'RCW 29A.60.190'],
        [statewide, primary, '2027-08-20', 'RCW 29A.60.240'],
        [statewide, general, '2027-12-02', 'RCW 29A.60.250'],
      ];
      for (const [ref, contest, date, citation] of cases) {
        const certified = waRules.certificationDate({ office: ref, contest });
        expect(certified?.value).toBe(date);
        expect(certified?.citation.citation).toBe(citation);
      }
    });
  });

  it('no track is a party primary', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year++) {
        const tracks = allTracks(year);
        expect(tracks.length).toBeGreaterThan(0);
        expect(tracks.filter((track) => track.track === 'party_primary')).toEqual([]);
      }
    });
  });

  it('every primary is top-two', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year++) {
        for (const schedule of waRules.schedules) {
          const ref = office({ ...SCHEDULE_OFFICES[schedule], schedule });
          for (const contest of waRules.contests({ office: ref, year })) {
            expect(contest.party).toBeNull();
            expect(contest.electsOutright).toBe(false);
          }
        }
      }
    });
  });

  it('5 p.m. is the closing hour only where the citation says so', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year++) {
        for (const track of allTracks(year)) {
          expect(track.closesTime?.value).toBe('17:00');
          expect(track.closesTime?.citation.quote).toContain('5:00 p.m.');
        }
      }
    });
  });

  it('holidays are cited', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year++) {
        const calendar = waRules.holidays(year);
        expect(calendar.state).toBe('WA');
        // Eleven, less New Year's Day in a year whose 1 January is a Saturday (the Friday before is in the year before).
        expect(calendar.holidays.length).toBeGreaterThanOrEqual(10);
        for (const holiday of calendar.holidays) {
          expect(holiday.citation.sourceUrl.startsWith('https://')).toBe(true);
          expect(holiday.citation.citation).toBe('RCW 1.16.050');
          expect(holiday.citation.quote.trim()).not.toBe('');
          expect(holiday.date.startsWith(`${String(year)}-`)).toBe(true);
        }
      }
    });
  });

  it('a holiday on a weekend moves to the weekday the statute names', async () => {
    await eachZone(() => {
      const dates = (year: number): readonly string[] =>
        waRules.holidays(year).holidays.map((holiday) => holiday.date);
      // Juneteenth 2027 is a Saturday: the Friday before. Independence Day 2027 is a Sunday: the Monday after.
      expect(dates(2027)).toContain('2027-06-18');
      expect(dates(2027)).toContain('2027-07-05');
      // Christmas 2027 is a Saturday: Friday 24 December. New Year's Day 2028 is a Saturday: Friday 31 December 2027.
      expect(dates(2027)).toContain('2027-12-24');
      expect(dates(2027)).toContain('2027-12-31');
      expect(dates(2028)).not.toContain('2028-01-01');
      // Native American Heritage Day is the Friday after Thanksgiving; Columbus Day is not a legal holiday.
      expect(dates(2026)).toContain('2026-11-27');
      expect(dates(2026)).not.toContain('2026-10-12');
    });
  });

  it('each holiday the rules can meet rolls', async () => {
    await eachZone(() => {
      // The filing week can meet no holiday (the never-roll proof); these are the calendar's own rolls.
      const cal2026 = waRules.holidays(2026);
      expect(roll('2026-05-25', 'next_business_day', cal2026)).toBe('2026-05-26');
      expect(roll('2026-05-23', 'previous_business_day', cal2026)).toBe('2026-05-22');
      expect(roll('2026-11-26', 'next_business_day', cal2026)).toBe('2026-11-30');
      expect(roll('2026-09-07', 'next_business_day', cal2026)).toBe('2026-09-08');
      const cal2027 = waRules.holidays(2027);
      expect(roll('2027-06-18', 'next_business_day', cal2027)).toBe('2027-06-21');
      expect(roll('2027-07-05', 'previous_business_day', cal2027)).toBe('2027-07-02');
    });
  });

  it('every schedule and track set answers', async () => {
    await eachZone(() => {
      for (const year of [2026, 2027]) {
        for (const schedule of waRules.schedules) {
          const ref = office({ ...SCHEDULE_OFFICES[schedule], schedule });
          expect(() => waRules.contests({ office: ref, year })).not.toThrow();
        }
        for (const trackSet of waRules.trackSets) {
          const contest: ContestRef = {
            date: year % 2 === 0 ? '2026-11-03' : '2027-11-02',
            kind: 'general',
            party: null,
          };
          expect(() =>
            waRules.filingTracks({ office: office({ trackSet }), contest }),
          ).not.toThrow();
        }
      }
    });
  });

  it('an unknown schedule throws', async () => {
    await eachZone(() => {
      expect(() =>
        waRules.contests({ office: office({ schedule: 'wa_nonexistent' }), year: 2026 }),
      ).toThrow(new RangeError('wa: unknown schedule wa_nonexistent'));
      expect(() =>
        waRules.filingTracks({
          office: office({ trackSet: 'wa_nonexistent' }),
          contest: { date: '2026-11-03', kind: 'general', party: null },
        }),
      ).toThrow(RangeError);
    });
  });

  it('schedules and track sets with no election by statute return nothing', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year++) {
        for (const schedule of ['wa_conservation_district', 'wa_no_public_election']) {
          const ref = office({ ...SCHEDULE_OFFICES[schedule], schedule });
          expect(waRules.contests({ office: ref, year })).toEqual([]);
        }
      }
      expect(
        waRules.filingTracks({
          office: office({ trackSet: 'wa_no_filing' }),
          contest: { date: '2026-11-03', kind: 'general', party: null },
        }),
      ).toEqual([]);
    });
  });

  it('the state and county schedules are even-year, the local ones odd-year', async () => {
    await eachZone(() => {
      const years = (schedule: string): readonly number[] =>
        [2026, 2027, 2028, 2029].filter(
          (year) =>
            waRules.contests({ office: office({ ...SCHEDULE_OFFICES[schedule], schedule }), year })
              .length > 0,
        );
      expect(years('wa_state_general')).toEqual([2026, 2028]);
      expect(years('wa_county_general')).toEqual([2026, 2028]);
      expect(years('wa_state_primary')).toEqual([2026, 2028]);
      expect(years('wa_local_odd_year')).toEqual([2027, 2029]);
      expect(years('wa_charter_county_odd_year')).toEqual([2027, 2029]);
    });
  });

  it('precinct committee officers file without a fee, with the county auditor', async () => {
    await eachZone(() => {
      const ref = office({
        ...SCHEDULE_OFFICES.wa_state_primary,
        schedule: 'wa_state_primary',
      });
      const [contest] = waRules.contests({ office: ref, year: 2026 });
      expect(contest).toBeDefined();
      if (contest === undefined) {
        return;
      }
      const track = only(waRules.filingTracks({ office: ref, contest }));
      expect(track.fee?.value).toEqual({ kind: 'none' });
      expect(track.whereToFile?.value).toBe('the county auditor');
      expect(track.closesOn.value).toBe('2026-05-08');
    });
  });

  it('the filing officer and fee follow the statute', async () => {
    await eachZone(() => {
      const contest: ContestRef = { date: '2026-11-03', kind: 'general', party: null };
      const superior = only(
        waRules.filingTracks({
          office: office({ templateKey: 'superior-court-judge', officeTypeId: 'trial-judge' }),
          contest,
        }),
      );
      expect(superior.whereToFile?.value).toBe('the secretary of state');
      expect(superior.fee?.value).toEqual({ kind: 'percent_of_annual_pay', percent: 1 });
      const district = only(
        waRules.filingTracks({
          office: office({ templateKey: 'district-court-judge', officeTypeId: 'trial-judge' }),
          contest,
        }),
      );
      expect(district.whereToFile?.value).toBe('the county auditor');
      const council = only(
        waRules.filingTracks({
          office: office({ templateKey: 'city-council', officeTypeId: 'city-council' }),
          contest,
        }),
      );
      expect(council.fee).toBeNull();
    });
  });

  it('county pay is left to each county', async () => {
    await eachZone(() => {
      expect(waRules.countyPay({ office: office({ population: 300_000 }), year: 2026 })).toBeNull();
    });
  });

  it('holidays outside the served years throw', () => {
    expect(() => waRules.holidays(2021)).toThrow(RangeError);
    expect(() => waRules.holidays(2101)).toThrow(RangeError);
    expect(waRules.holidays(2100).holidays.length).toBeGreaterThan(0);
  });
});

describe('WA public utility district commissioners', () => {
  const COMMISSIONER = office({
    templateKey: 'pud-commissioner',
    officeTypeId: 'public-power-board',
    jurisdictionKind: 'special_district',
    countyGeoid: null,
    partisan: false,
    schedule: 'wa_public_utility_district',
    termYears: 6,
  });

  it('get no contest when their template key has no cited year', async () => {
    // Each commissioner district is elected once in six years, in a year no statute names, so an
    // unkeyed commissioner has no contest in any year and its next election is not known yet.
    await eachZone(() => {
      for (let year = 2022; year <= 2040; year++) {
        expect(waRules.contests({ office: COMMISSIONER, year })).toEqual([]);
        expect(
          waRules.contests({
            office: { ...COMMISSIONER, templateKey: 'mason-pud-1-commissioner-district-1' },
            year,
          }),
        ).toEqual([]);
      }
    });
  });

  it('file in the filing week of the election year when a contest is asked', async () => {
    await eachZone(() => {
      const contest: ContestRef = { date: '2026-11-03', kind: 'general', party: null };
      const track = only(waRules.filingTracks({ office: COMMISSIONER, contest }));
      expect(track.opensOn?.value).toBe('2026-05-04');
      expect(track.closesOn.value).toBe('2026-05-08');
    });
  });

  it('leave every other schedule as it was', async () => {
    await eachZone(() => {
      const county = office({});
      expect(waRules.contests({ office: county, year: 2026 }).map((c) => c.kind)).toEqual([
        'primary',
        'general',
      ]);
    });
  });
});
