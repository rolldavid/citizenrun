import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { NC_FIXTURES } from '../__fixtures__/nc/index.ts';
import {
  daysBefore,
  FRIDAY,
  isBusinessDay,
  MONDAY,
  roll,
  SATURDAY,
  SUNDAY,
  weekdayOf,
} from '../dates.ts';
import { runStateRulesSuite } from '../testing/check-fixtures.ts';
import type { RuleDeclaration } from '../testing/check-fixtures.ts';
import type { ContestOut, OfficeRef } from '../types.ts';
import { ncRules } from './nc.ts';

const declaredRules: readonly RuleDeclaration[] = [
  {
    id: 'nc.nc_partisan.party_primary',
    trackSet: 'nc_partisan',
    track: 'party_primary',
    rolled: {
      never: true,
      fields: ['opensOn', 'closesOn'],
      reason:
        'G.S. 163-106.2 opens filing on the first Monday in December (1 to 7 December) and closes it on the third Friday (15 to 21 December), days no holiday of G.S. 103-4 reaches',
    },
  },
  {
    id: 'nc.nc_partisan.independent',
    trackSet: 'nc_partisan',
    track: 'independent',
    rolled: {
      never: true,
      fields: ['closesOn', 'petitionDue'],
      reason:
        'G.S. 163-122(a) makes unaffiliated petitions due at noon on primary day, the Tuesday after the first Monday in March (2 to 8 March), a day no holiday of G.S. 103-4 reaches',
    },
  },
  {
    id: 'nc.nc_nonpartisan.nonpartisan',
    trackSet: 'nc_nonpartisan',
    track: 'nonpartisan',
    rolled: {
      never: true,
      fields: ['opensOn', 'closesOn'],
      reason:
        'boards of education file in the December window of G.S. 163-106.2 (first Monday to third Friday in December), days no holiday of G.S. 103-4 reaches',
    },
  },
  {
    id: 'nc.nc_municipal.nonpartisan',
    trackSet: 'nc_municipal',
    track: 'nonpartisan',
    rolled: {
      caseId: 'nc-2026-city-council',
      field: 'opensOn',
      unrolled: '2026-07-03',
      direction: 'next_business_day',
    },
  },
  {
    id: 'nc.nc_soil_water.nonpartisan',
    trackSet: 'nc_soil_water',
    track: 'nonpartisan',
    rolled: {
      caseId: 'nc-2026-soil-water-supervisor',
      field: 'closesOn',
      unrolled: '2026-07-03',
      direction: 'next_business_day',
    },
  },
];

/** The office types Chapter 163 nominates at party primaries (G.S. 163-1, 163-106.2). */
const partisanOfficeTypes = [
  'us-senate',
  'us-house',
  'governor',
  'statewide-executive-other',
  'attorney-general',
  'secretary-of-state',
  'state-treasurer',
  'insurance-commissioner',
  'labor-commissioner',
  'state-appellate-judge',
  'trial-judge',
  'district-attorney',
  'state-senate',
  'state-house',
  'county-commission',
  'sheriff',
  'county-treasurer',
  'county-row-other',
];

runStateRulesSuite({
  state: 'NC',
  rules: ncRules,
  fixtures: NC_FIXTURES,
  declaredRules,
  officialHosts: ['ncsbe.gov', 'ncleg.gov'],
  partisanOfficeTypes,
  partyPrimaryExempt: false,
});

function office(
  overrides: Partial<OfficeRef> & Pick<OfficeRef, 'schedule' | 'trackSet'>,
): OfficeRef {
  return {
    state: 'NC',
    templateKey: 'fixture-office',
    officeTypeId: 'city-council',
    jurisdictionKind: 'city',
    countyGeoid: null,
    partisan: false,
    staggerGroup: null,
    termYears: null,
    payAnnualCents: null,
    population: null,
    ...overrides,
  };
}

const STATE_REP = office({
  officeTypeId: 'state-house',
  jurisdictionKind: 'state',
  partisan: true,
  schedule: 'nc_state_general',
  trackSet: 'nc_partisan',
});
const SHERIFF = office({
  officeTypeId: 'sheriff',
  jurisdictionKind: 'county',
  partisan: true,
  schedule: 'nc_state_general',
  trackSet: 'nc_partisan',
});
const GOVERNOR = office({
  officeTypeId: 'governor',
  jurisdictionKind: 'state',
  partisan: true,
  schedule: 'nc_state_general_quadrennial',
  trackSet: 'nc_partisan',
});
const SCHOOL = office({
  officeTypeId: 'school-board',
  jurisdictionKind: 'school_district',
  schedule: 'nc_school',
  trackSet: 'nc_nonpartisan',
});
const SOIL_WATER = office({
  officeTypeId: 'soil-water-conservation-board',
  jurisdictionKind: 'special_district',
  schedule: 'nc_soil_water',
  trackSet: 'nc_soil_water',
});
const COUNCIL = office({ schedule: 'nc_municipal', trackSet: 'nc_municipal' });
const PARTISAN_COUNCIL = office({
  partisan: true,
  schedule: 'nc_municipal_partisan',
  trackSet: 'nc_municipal',
});
const PRIMARY_COUNCIL = office({ schedule: 'nc_municipal_primary', trackSet: 'nc_municipal' });
const RUNOFF_COUNCIL = office({ schedule: 'nc_municipal_runoff', trackSet: 'nc_municipal' });
const PRECINCT_OFFICER = office({
  officeTypeId: 'party-precinct-committee',
  jurisdictionKind: 'party',
  schedule: 'nc_no_public_election',
  trackSet: 'nc_partisan',
});

/** A fixture office of each schedule's kind, with the track sets that serve it. */
const SCHEDULE_OFFICES: Readonly<
  Record<string, { office: OfficeRef; trackSets: readonly string[] }>
> = {
  nc_state_general: { office: STATE_REP, trackSets: ['nc_partisan'] },
  nc_state_general_quadrennial: { office: GOVERNOR, trackSets: ['nc_partisan'] },
  nc_municipal: { office: COUNCIL, trackSets: ['nc_municipal'] },
  nc_municipal_partisan: { office: PARTISAN_COUNCIL, trackSets: ['nc_municipal'] },
  nc_municipal_primary: { office: PRIMARY_COUNCIL, trackSets: ['nc_municipal'] },
  nc_municipal_runoff: { office: RUNOFF_COUNCIL, trackSets: ['nc_municipal'] },
  nc_school: { office: SCHOOL, trackSets: ['nc_nonpartisan'] },
  nc_soil_water: { office: SOIL_WATER, trackSets: ['nc_soil_water'] },
  nc_no_public_election: { office: PRECINCT_OFFICER, trackSets: [] },
};

function entryFor(schedule: string): { office: OfficeRef; trackSets: readonly string[] } {
  const entry = SCHEDULE_OFFICES[schedule];
  if (entry === undefined) {
    throw new Error(`no fixture office for ${schedule}`);
  }
  return entry;
}

function only<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined || items.length !== 1) {
    throw new Error(`expected one item, got ${String(items.length)}`);
  }
  return item;
}

const PARTIES = ['democratic', 'green', 'libertarian', 'republican'];
const GENERAL_2026 = { date: '2026-11-03', kind: 'general', party: null } as const;

describe('NC deadline rules: the cases of the state', () => {
  it('holidays are cited', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year++) {
        const cal = ncRules.holidays(year);
        expect(cal.holidays.length).toBeGreaterThan(0);
        for (const holiday of cal.holidays) {
          expect(new URL(holiday.citation.sourceUrl).protocol).toBe('https:');
          expect(holiday.citation.quote.trim()).not.toBe('');
          expect(holiday.date.startsWith(String(year))).toBe(true);
        }
      }
      expect(() => ncRules.holidays(2017)).toThrow(RangeError);
      expect(() => ncRules.holidays(2101)).toThrow(RangeError);
    });
  });

  it('each holiday the rules can meet rolls', async () => {
    await eachZone(() => {
      // The first Friday in July opens municipal filing and closes soil and water filing.
      expect(roll('2025-07-04', 'next_business_day', ncRules.holidays(2025))).toBe('2025-07-07');
      expect(roll('2026-07-03', 'next_business_day', ncRules.holidays(2026))).toBe('2026-07-06');
      // The weekend before a Monday holiday goes back to the Friday.
      expect(roll('2027-07-04', 'previous_business_day', ncRules.holidays(2027))).toBe(
        '2027-07-02',
      );
      for (let year = 2024; year <= 2028; year++) {
        const cal = {
          ...ncRules.holidays(year),
          holidays: [year - 1, year, year + 1].flatMap((y) => ncRules.holidays(y).holidays),
        };
        for (const holiday of ncRules.holidays(year).holidays) {
          const next = roll(holiday.date, 'next_business_day', cal);
          expect(next > holiday.date).toBe(true);
          expect(isBusinessDay(next, cal)).toBe(true);
          if (weekdayOf(holiday.date) === MONDAY) {
            const saturday = daysBefore(holiday.date, 2);
            const friday = roll(saturday, 'previous_business_day', cal);
            expect(friday <= daysBefore(holiday.date, 3)).toBe(true);
          }
        }
      }
    });
  });

  it('3 July 2026 is a North Carolina holiday', async () => {
    await eachZone(() => {
      const dates = ncRules.holidays(2026).holidays.map((h) => h.date);
      expect(dates).toContain('2026-07-03');
      expect(roll('2026-07-03', 'next_business_day', ncRules.holidays(2026))).toBe('2026-07-06');
    });
  });

  it('the holiday list follows G.S. 103-4', async () => {
    await eachZone(() => {
      const dates = ncRules.holidays(2026).holidays.map((h) => h.date);
      expect(dates).toContain('2026-04-03'); // Good Friday
      expect(dates).toContain('2026-09-21'); // Yom Kippur
      expect(dates).toContain('2026-11-03'); // general election day
      expect(ncRules.holidays(2024).holidays.map((h) => h.date)).toContain('2024-10-12'); // Yom Kippur
      expect(ncRules.holidays(2025).holidays.map((h) => h.date)).toContain('2025-10-02'); // Yom Kippur
      expect(ncRules.holidays(2025).holidays.map((h) => h.date)).not.toContain('2025-11-04'); // no general election
      expect(ncRules.holidays(2027).holidays.map((h) => h.date)).toContain('2027-07-05'); // Sunday 4 July
      expect(ncRules.holidays(2027).holidays.map((h) => h.date)).not.toContain('2027-07-02');
    });
  });

  it('the 2026 municipal window opens on Monday 6 July', async () => {
    await eachZone(() => {
      const track = only(ncRules.filingTracks({ office: COUNCIL, contest: GENERAL_2026 }));
      expect(track.opensOn?.value).toBe('2026-07-06');
      expect(track.closesOn.value).toBe('2026-07-17');
      expect(track.closesTime?.value).toBe('12:00');
      expect(track.withdrawalDeadline?.value).toBe('2026-07-14');
    });
  });

  it('noon is the closing hour only where the citation says noon', async () => {
    await eachZone(() => {
      let noons = 0;
      for (let year = 2024; year <= 2028; year++) {
        for (const schedule of ncRules.schedules) {
          const entry = entryFor(schedule);
          const offices = schedule === 'nc_state_general' ? [STATE_REP, SHERIFF] : [entry.office];
          for (const base of offices) {
            for (const trackSet of entry.trackSets) {
              const subject = { ...base, trackSet };
              for (const c of ncRules.contests({ office: subject, year })) {
                for (const track of ncRules.filingTracks({ office: subject, contest: c })) {
                  const time = track.closesTime;
                  if (time === null) {
                    continue;
                  }
                  expect(time.value).toBe('12:00');
                  expect(time.citation.quote.toLowerCase()).toContain('noon');
                  noons += 1;
                }
              }
            }
          }
        }
      }
      expect(noons).toBeGreaterThan(0);
      // A soil and water closing moved off a holiday has no hour.
      const rolled = only(ncRules.filingTracks({ office: SOIL_WATER, contest: GENERAL_2026 }));
      expect(rolled.closesTime).toBeNull();
    });
  });

  it('the partisan window does not move', async () => {
    await eachZone(() => {
      for (const year of [2024, 2026, 2028]) {
        const primary = ncRules
          .contests({ office: STATE_REP, year })
          .find((c) => c.kind === 'primary');
        if (primary === undefined) {
          throw new Error(`no ${String(year)} primary`);
        }
        const track = only(ncRules.filingTracks({ office: STATE_REP, contest: primary }));
        const opens = track.opensOn?.value ?? '';
        expect(weekdayOf(opens)).toBe(MONDAY);
        expect(weekdayOf(track.closesOn.value)).toBe(FRIDAY);
        expect(opens.startsWith(`${String(year - 1)}-12-`)).toBe(true);
        expect(track.closesOn.value.startsWith(`${String(year - 1)}-12-`)).toBe(true);
      }
    });
  });

  it('a runoff follows the primary', async () => {
    await eachZone(() => {
      const check = (contests: readonly ContestOut[], citation: string): number => {
        let runoffs = 0;
        for (const runoff of contests) {
          if (runoff.kind !== 'primary_runoff' && runoff.kind !== 'general_runoff') {
            continue;
          }
          runoffs += 1;
          expect(runoff.electsOutright).toBe(false);
          expect(runoff.dateCitation.citation).toBe(citation);
          const before =
            runoff.kind === 'primary_runoff'
              ? contests.find((c) => c.kind === 'primary' && c.party === runoff.party)
              : contests.find((c) => c.kind === 'general');
          if (before === undefined) {
            throw new Error(`no contest before the runoff on ${runoff.date}`);
          }
          expect(before.date < runoff.date).toBe(true);
          if (runoff.kind === 'general_runoff') {
            expect(runoff.party).toBeNull();
          } else {
            expect(PARTIES).toContain(runoff.party);
          }
        }
        return runoffs;
      };
      for (const year of [2026, 2028]) {
        expect(check(ncRules.contests({ office: STATE_REP, year }), 'N.C.G.S. § 163-111(e)')).toBe(
          PARTIES.length,
        );
        expect(check(ncRules.contests({ office: SHERIFF, year }), 'N.C.G.S. § 163-111(e)')).toBe(
          PARTIES.length,
        );
      }
      expect(
        check(ncRules.contests({ office: GOVERNOR, year: 2028 }), 'N.C.G.S. § 163-111(e)'),
      ).toBe(PARTIES.length);
      for (const year of [2025, 2027]) {
        expect(
          check(ncRules.contests({ office: PARTISAN_COUNCIL, year }), 'N.C.G.S. § 163-279(a)(2)'),
        ).toBe(PARTIES.length);
        expect(
          check(ncRules.contests({ office: RUNOFF_COUNCIL, year }), 'N.C.G.S. § 163-279(a)(4)'),
        ).toBe(1);
      }
      // The 10-week second primary is generated only from the text in force from 2024.
      const contests2020 = ncRules.contests({ office: STATE_REP, year: 2020 });
      expect(contests2020.some((c) => c.kind === 'primary_runoff')).toBe(false);
    });
  });

  it('runoffs have no filing tracks', async () => {
    await eachZone(() => {
      let runoffs = 0;
      for (let year = 2024; year <= 2028; year++) {
        for (const schedule of ncRules.schedules) {
          const entry = entryFor(schedule);
          for (const c of ncRules.contests({ office: entry.office, year })) {
            if (c.kind !== 'primary_runoff' && c.kind !== 'general_runoff') {
              continue;
            }
            for (const trackSet of entry.trackSets) {
              runoffs += 1;
              expect(
                ncRules.filingTracks({ office: { ...entry.office, trackSet }, contest: c }),
              ).toEqual([]);
            }
          }
        }
      }
      expect(runoffs).toBeGreaterThan(0);
    });
  });

  it('every schedule and track set answers', async () => {
    await eachZone(() => {
      for (const schedule of ncRules.schedules) {
        const entry = entryFor(schedule);
        for (const year of [2026, 2027]) {
          const contests = ncRules.contests({ office: entry.office, year });
          for (const trackSet of entry.trackSets) {
            for (const c of contests) {
              ncRules.filingTracks({ office: { ...entry.office, trackSet }, contest: c });
              ncRules.certificationDate({ office: entry.office, contest: c });
            }
          }
        }
      }
      for (const trackSet of ncRules.trackSets) {
        expect(Object.values(SCHEDULE_OFFICES).some((e) => e.trackSets.includes(trackSet))).toBe(
          true,
        );
      }
    });
  });

  it('an unknown schedule throws', async () => {
    await eachZone(() => {
      expect(() =>
        ncRules.contests({
          office: office({ schedule: 'nc_nope', trackSet: 'nc_municipal' }),
          year: 2026,
        }),
      ).toThrow(new RangeError('nc: unknown schedule nc_nope'));
      expect(() =>
        ncRules.filingTracks({
          office: office({ schedule: 'nc_municipal', trackSet: 'nc_nope' }),
          contest: GENERAL_2026,
        }),
      ).toThrow(RangeError);
    });
  });

  it('party officers chosen at party meetings have no public election', async () => {
    await eachZone(() => {
      for (const year of [2024, 2025, 2026, 2027, 2028]) {
        expect(ncRules.contests({ office: PRECINCT_OFFICER, year })).toEqual([]);
        expect(
          ncRules.contests({
            office: { ...PRECINCT_OFFICER, officeTypeId: 'party-committee' },
            year,
          }),
        ).toEqual([]);
      }
      expect(partisanOfficeTypes).not.toContain('party-precinct-committee');
      expect(partisanOfficeTypes).not.toContain('party-committee');
    });
  });

  it('elections fall on the years and days the statutes give', async () => {
    await eachZone(() => {
      expect(ncRules.contests({ office: GOVERNOR, year: 2026 })).toEqual([]);
      expect(ncRules.contests({ office: STATE_REP, year: 2027 })).toEqual([]);
      expect(ncRules.contests({ office: COUNCIL, year: 2026 })).toEqual([]);
      expect(ncRules.contests({ office: COUNCIL, year: 2027 }).map((c) => c.date)).toEqual([
        '2027-11-02',
      ]);
      // The partisan municipal primary is the second Tuesday after Labor Day (6 September 2027).
      const partisan = ncRules.contests({ office: PARTISAN_COUNCIL, year: 2027 });
      expect(partisan.filter((c) => c.kind === 'primary').map((c) => c.date)).toEqual(
        PARTIES.map(() => '2027-09-14'),
      );
      expect(partisan.filter((c) => c.kind === 'primary_runoff').map((c) => c.date)).toEqual(
        PARTIES.map(() => '2027-10-05'),
      );
      expect(ncRules.contests({ office: RUNOFF_COUNCIL, year: 2027 }).map((c) => c.date)).toEqual([
        '2027-10-05',
        '2027-11-02',
      ]);
      // School boards are elected at the time of the primary (G.S. 115C-37(a)).
      expect(ncRules.contests({ office: SCHOOL, year: 2028 })).toMatchObject([
        { date: '2028-03-07', kind: 'general', party: null },
      ]);
      for (const c of ncRules.contests({ office: STATE_REP, year: 2028 })) {
        expect([SATURDAY, SUNDAY]).not.toContain(weekdayOf(c.date));
      }
    });
  });

  it('results are final on the canvass days of G.S. 163-182.5', async () => {
    await eachZone(() => {
      expect(ncRules.certificationDate({ office: SHERIFF, contest: GENERAL_2026 })?.value).toBe(
        '2026-11-13',
      );
      expect(ncRules.certificationDate({ office: STATE_REP, contest: GENERAL_2026 })?.value).toBe(
        '2026-11-24',
      );
      expect(
        ncRules.certificationDate({
          office: STATE_REP,
          contest: { date: '2026-03-03', kind: 'primary', party: 'democratic' },
        }),
      ).toBeNull();
      expect(
        ncRules.certificationDate({
          office: SHERIFF,
          contest: { date: '2026-03-03', kind: 'primary', party: 'democratic' },
        })?.value,
      ).toBe('2026-03-13');
    });
  });

  it('county officers are paid what the commissioners fix', async () => {
    await eachZone(() => {
      expect(ncRules.countyPay({ office: SHERIFF, year: 2026 })).toBeNull();
    });
  });
});
