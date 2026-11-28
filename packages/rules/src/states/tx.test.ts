import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { TX_FIXTURES } from '../__fixtures__/tx/index.ts';
import { fixture as primary2026 } from '../__fixtures__/tx/2026-primary.fixtures.ts';
import { daysBefore, FRIDAY, isBusinessDay, MONDAY, roll, SATURDAY, weekdayOf } from '../dates.ts';
import { runStateRulesSuite } from '../testing/check-fixtures.ts';
import type { RuleDeclaration } from '../testing/check-fixtures.ts';
import type { ContestRef, OfficeRef } from '../types.ts';
import { txRules } from './tx.ts';

const declaredRules: readonly RuleDeclaration[] = [
  {
    id: 'tx.tx_partisan.party_primary',
    trackSet: 'tx_partisan',
    track: 'party_primary',
    rolled: {
      never: true,
      fields: ['closesOn'],
      reason:
        'Election Code § 172.023(a) closes the filing on the second Monday in December (8 to 14 December), a day no holiday of § 1.006 reaches',
    },
  },
  {
    id: 'tx.tx_partisan.independent',
    trackSet: 'tx_partisan',
    track: 'independent',
    rolled: {
      never: true,
      fields: ['closesOn', 'petitionDue'],
      reason:
        'the declaration closes on the second Monday in December (§§ 142.002, 172.023) and the petition is due the 30th day after the fourth Tuesday in May, a Thursday from 21 to 27 June (§ 142.006): no holiday of § 1.006 falls on either',
    },
  },
  {
    id: 'tx.tx_local.nonpartisan',
    trackSet: 'tx_local',
    track: 'nonpartisan',
    rolled: {
      never: true,
      fields: ['closesOn'],
      reason:
        'the 78th day before a uniform election day (§§ 143.007(c), 144.005(d)) is a Friday from 12 to 18 February for the May Saturday and a Monday from 16 to 22 August for the November Tuesday, days no holiday of § 1.006 reaches',
    },
  },
  {
    id: 'tx.tx_party_office.party_primary',
    trackSet: 'tx_party_office',
    track: 'party_primary',
    rolled: {
      never: true,
      fields: ['closesOn'],
      reason:
        'county and precinct chairs file by the primary deadline of § 172.023(a), the second Monday in December, a day no holiday of § 1.006 reaches',
    },
  },
];

/** The office types Texas nominates at party primaries (§ 172.001); the two party office types are left out. */
const partisanOfficeTypes = [
  'us-senate',
  'us-house',
  'governor',
  'statewide-executive-other',
  'attorney-general',
  'state-treasurer',
  'oil-gas-land-commission',
  'state-education-board',
  'state-appellate-judge',
  'state-senate',
  'state-house',
  'district-attorney',
  'trial-judge',
  'county-executive',
  'county-commission',
  'county-clerk',
  'county-treasurer',
  'county-assessor',
  'sheriff',
  'county-row-other',
];

runStateRulesSuite({
  state: 'TX',
  rules: txRules,
  fixtures: TX_FIXTURES,
  declaredRules,
  officialHosts: ['sos.texas.gov', 'statutes.capitol.texas.gov'],
  partisanOfficeTypes,
  partyPrimaryExempt: false,
});

function office(
  overrides: Partial<OfficeRef> & Pick<OfficeRef, 'schedule' | 'trackSet'>,
): OfficeRef {
  return {
    state: 'TX',
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
  schedule: 'tx_state_general',
  trackSet: 'tx_partisan',
});
const SHERIFF = office({
  officeTypeId: 'sheriff',
  jurisdictionKind: 'county',
  partisan: true,
  population: 250_000,
  schedule: 'tx_county_general',
  trackSet: 'tx_partisan',
});
const PRECINCT_CHAIR = office({
  officeTypeId: 'party-precinct-committee',
  jurisdictionKind: 'party',
  schedule: 'tx_party_primary',
  trackSet: 'tx_party_office',
});
const COUNTY_CHAIR = office({
  officeTypeId: 'party-committee',
  jurisdictionKind: 'party',
  schedule: 'tx_party_primary',
  trackSet: 'tx_party_office',
});
const CITY_MAY = office({ schedule: 'tx_uniform_may', trackSet: 'tx_local' });
const CITY_NOVEMBER = office({
  schedule: 'tx_uniform_november',
  trackSet: 'tx_local',
});

const NO_ELECTION = office({
  officeTypeId: 'pension-board',
  jurisdictionKind: 'state',
  schedule: 'tx_no_public_election',
  trackSet: 'tx_local',
});

/** A fixture office of each schedule's kind, with the track sets that serve it. */
const SCHEDULE_OFFICES: Readonly<
  Record<string, { office: OfficeRef; trackSets: readonly string[] }>
> = {
  tx_state_general: { office: STATE_REP, trackSets: ['tx_partisan'] },
  tx_county_general: { office: SHERIFF, trackSets: ['tx_partisan'] },
  tx_uniform_may: { office: CITY_MAY, trackSets: ['tx_local'] },
  tx_uniform_november: { office: CITY_NOVEMBER, trackSets: ['tx_local'] },
  tx_party_primary: { office: PRECINCT_CHAIR, trackSets: ['tx_party_office'] },
  tx_no_public_election: { office: NO_ELECTION, trackSets: [] },
};

function entryFor(schedule: string): { office: OfficeRef; trackSets: readonly string[] } {
  const entry = SCHEDULE_OFFICES[schedule];
  if (entry === undefined) {
    throw new Error(`no fixture office for ${schedule}`);
  }
  return entry;
}

/** The one item of a list; fails the case when there is none or more than one. */
function only<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined || items.length !== 1) {
    throw new Error(`expected one item, got ${String(items.length)}`);
  }
  return item;
}

const PARTIES = ['democratic', 'republican'];
/** The 2026 runoff primary date of 2026-primary.fixtures.ts's contests entry, copied by hand. */
const RUNOFF_2026 = '2026-05-26';

describe('TX deadline rules: the cases of the state', () => {
  it('holidays are cited', async () => {
    await eachZone(() => {
      for (let year = 2024; year <= 2028; year++) {
        const cal = txRules.holidays(year);
        expect(cal.holidays.length).toBeGreaterThan(0);
        for (const holiday of cal.holidays) {
          expect(new URL(holiday.citation.sourceUrl).protocol).toBe('https:');
          expect(holiday.citation.quote.trim()).not.toBe('');
          expect(holiday.date.startsWith(String(year))).toBe(true);
        }
      }
    });
  });

  it('each holiday the rules can meet rolls', async () => {
    await eachZone(() => {
      // Dates the Secretary of State's calendars move under § 1.006.
      expect(roll('2027-09-06', 'next_business_day', txRules.holidays(2027))).toBe('2027-09-07'); // Labor Day
      expect(roll('2028-10-09', 'next_business_day', txRules.holidays(2028))).toBe('2028-10-10'); // Columbus Day
      expect(roll('2026-04-21', 'previous_business_day', txRules.holidays(2026))).toBe(
        '2026-04-20',
      ); // San Jacinto Day
      expect(roll('2026-02-14', 'next_business_day', txRules.holidays(2026))).toBe('2026-02-17'); // Presidents' Day weekend
      // Every holiday of the calendar moves a date to the next business day, and the weekend
      // before a Monday holiday back to the Friday.
      for (let year = 2024; year <= 2028; year++) {
        const cal = {
          ...txRules.holidays(year),
          holidays: [year - 1, year, year + 1].flatMap((y) => txRules.holidays(y).holidays),
        };
        for (const holiday of txRules.holidays(year).holidays) {
          const next = roll(holiday.date, 'next_business_day', cal);
          expect(next > holiday.date).toBe(true);
          expect(isBusinessDay(next, cal)).toBe(true);
          if (weekdayOf(holiday.date) === MONDAY) {
            const saturday = daysBefore(holiday.date, 2);
            expect(roll(saturday, 'previous_business_day', cal)).toBe(daysBefore(holiday.date, 3));
            expect(weekdayOf(daysBefore(holiday.date, 3))).toBe(FRIDAY);
          }
        }
      }
    });
  });

  it('December 24 and 26 and the optional holidays are not Election Code holidays', async () => {
    await eachZone(() => {
      const dates = txRules.holidays(2026).holidays.map((h) => h.date);
      expect(dates).not.toContain('2026-12-24');
      expect(dates).not.toContain('2026-12-28'); // not an observed December 26
      expect(dates).not.toContain('2026-04-03'); // Good Friday
      expect(dates).toContain('2026-11-27'); // the Friday after Thanksgiving
      expect(dates).toContain('2026-01-19'); // Confederate Heroes Day, a Monday in 2026
    });
  });

  it('every schedule and track set answers', async () => {
    await eachZone(() => {
      for (const schedule of txRules.schedules) {
        const entry = entryFor(schedule);
        for (const year of [2026, 2027]) {
          const contests = txRules.contests({ office: entry.office, year });
          for (const trackSet of entry.trackSets) {
            for (const c of contests) {
              txRules.filingTracks({ office: { ...entry.office, trackSet }, contest: c });
              txRules.certificationDate({ office: entry.office, contest: c });
            }
          }
        }
      }
      for (const trackSet of txRules.trackSets) {
        expect(Object.values(SCHEDULE_OFFICES).some((e) => e.trackSets.includes(trackSet))).toBe(
          true,
        );
      }
      expect(txRules.contests({ office: NO_ELECTION, year: 2026 })).toEqual([]);
    });
  });

  it('an unknown schedule throws', async () => {
    await eachZone(() => {
      expect(() =>
        txRules.contests({
          office: office({ schedule: 'tx_nothing', trackSet: 'tx_local' }),
          year: 2026,
        }),
      ).toThrow(new RangeError('tx: unknown schedule tx_nothing'));
    });
  });

  it('the 78th day at 5 p.m.', async () => {
    await eachZone(() => {
      const [track] = txRules.filingTracks({
        office: CITY_MAY,
        contest: { date: '2027-05-01', kind: 'general', party: null },
      });
      expect(track?.closesOn.value).toBe('2027-02-12');
      expect(track?.closesTime?.value).toBe('17:00');
      expect(track?.closesTime?.citation.quote).toContain('5 p.m.');
      expect(track?.opensOn?.value).toBe('2027-01-13');
    });
  });

  it('the first day does not move for a weekend', async () => {
    await eachZone(() => {
      const [track] = txRules.filingTracks({
        office: CITY_NOVEMBER,
        contest: { date: '2027-11-02', kind: 'general', party: null },
      });
      expect(track?.opensOn?.value).toBe('2027-07-17');
      expect(weekdayOf('2027-07-17')).toBe(SATURDAY);
      expect(track?.closesOn.value).toBe('2027-08-16');
    });
  });

  it('the primary closes at 6 p.m. on the second Monday in December', async () => {
    await eachZone(() => {
      const [track] = txRules.filingTracks({
        office: STATE_REP,
        contest: { date: '2028-03-07', kind: 'primary', party: 'republican' },
      });
      expect(track?.track).toBe('party_primary');
      expect(track?.opensOn?.value).toBe('2027-11-13');
      expect(track?.closesOn.value).toBe('2027-12-13');
      expect(weekdayOf('2027-12-13')).toBe(MONDAY);
      expect(track?.closesTime?.value).toBe('18:00');
      expect(track?.closesTime?.citation.quote).toContain('6 p.m.');
    });
  });

  it('the uniform May date is a Saturday', async () => {
    await eachZone(() => {
      for (let year = 2026; year <= 2030; year++) {
        const contests = txRules.contests({ office: CITY_MAY, year });
        expect(weekdayOf(only(contests).date)).toBe(SATURDAY);
      }
      // A county holds no election on the May date of an even-numbered year (§ 41.001(a)(2)).
      const county = office({
        jurisdictionKind: 'county',
        schedule: 'tx_uniform_may',
        trackSet: 'tx_local',
      });
      expect(txRules.contests({ office: county, year: 2026 })).toEqual([]);
      expect(txRules.contests({ office: county, year: 2027 })).toHaveLength(1);
    });
  });

  it('a runoff follows the primary', async () => {
    await eachZone(() => {
      for (const partisanOffice of [STATE_REP, SHERIFF]) {
        for (const year of [2026, 2028]) {
          const contests = txRules.contests({ office: partisanOffice, year });
          const general = only(contests.filter((c) => c.kind === 'general'));
          for (const party of PARTIES) {
            const primary = only(contests.filter((c) => c.kind === 'primary' && c.party === party));
            const runoff = only(
              contests.filter((c) => c.kind === 'primary_runoff' && c.party === party),
            );
            expect(runoff.date > primary.date).toBe(true);
            expect(runoff.date < general.date).toBe(true);
            expect(runoff.electsOutright).toBe(false);
            expect(runoff.dateCitation.citation).toBe('Tex. Elec. Code § 41.007(b)');
            expect(contests.indexOf(runoff)).toBeGreaterThan(contests.indexOf(primary));
          }
          if (year === 2026) {
            // 2026-primary.fixtures.ts publishes the runoff primary on 26 May 2026.
            expect(contests.filter((c) => c.kind === 'primary_runoff').map((c) => c.date)).toEqual([
              RUNOFF_2026,
              RUNOFF_2026,
            ]);
          }
        }
      }
    });
  });

  it('runoffs have no filing tracks', async () => {
    await eachZone(() => {
      for (const schedule of ['tx_state_general', 'tx_county_general', 'tx_party_primary']) {
        const base = entryFor(schedule).office;
        for (let year = 2024; year <= 2028; year++) {
          const runoffs = txRules
            .contests({ office: base, year })
            .filter((c) => c.kind === 'primary_runoff' || c.kind === 'general_runoff');
          if (year % 2 === 0) {
            expect(runoffs.length).toBe(2);
          }
          for (const runoff of runoffs) {
            for (const trackSet of ['tx_partisan', 'tx_party_office']) {
              expect(
                txRules.filingTracks({
                  office: { ...base, trackSet },
                  contest: runoff,
                }),
              ).toEqual([]);
            }
          }
        }
      }
    });
  });

  it('party offices file in the party primary only', async () => {
    await eachZone(() => {
      const contest: ContestRef = {
        date: '2026-03-03',
        kind: 'primary',
        party: 'democratic',
      };
      const quotes = primary2026.cases
        .filter((c) => c.office.trackSet === 'tx_party_office')
        .map((c) => c.quote);
      expect(quotes).toHaveLength(2);
      for (const party of [PRECINCT_CHAIR, COUNTY_CHAIR]) {
        const tracks = txRules.filingTracks({ office: party, contest });
        expect(tracks.map((t) => t.track)).toEqual(['party_primary']);
        const citation = only(tracks).closesOn.citation.citation;
        expect(citation).toBe('Tex. Elec. Code § 172.023(a)');
        for (const quote of quotes) {
          expect(quote).toContain('[Sec. 172.023(a)]');
        }
        const general: ContestRef = {
          date: '2026-11-03',
          kind: 'general',
          party: null,
        };
        expect(txRules.filingTracks({ office: party, contest: general })).toEqual([]);
      }
      // The two party office types are not partisan office types for the suite (PIPE-rules-fixtures rule 2).
      expect(partisanOfficeTypes).not.toContain('party-precinct-committee');
      expect(partisanOfficeTypes).not.toContain('party-committee');
    });
  });

  it('the filing fee follows the county population tier of § 172.024', async () => {
    await eachZone(() => {
      const contest: ContestRef = {
        date: '2026-03-03',
        kind: 'primary',
        party: 'republican',
      };
      const [large] = txRules.filingTracks({ office: SHERIFF, contest });
      expect(large?.fee?.value).toEqual({ kind: 'fixed', cents: 125_000 });
      const [small] = txRules.filingTracks({
        office: { ...SHERIFF, population: 199_999 },
        contest,
      });
      expect(small?.fee?.value).toEqual({ kind: 'fixed', cents: 75_000 });
      const [unknown] = txRules.filingTracks({
        office: { ...SHERIFF, population: null },
        contest,
      });
      expect(unknown?.fee).toBeNull();
      const [judge] = txRules.filingTracks({
        office: { ...STATE_REP, officeTypeId: 'trial-judge' },
        contest,
      });
      expect(judge?.fee).toBeNull();
    });
  });

  it('canvass days follow the Election Code', async () => {
    await eachZone(() => {
      const cert = (o: OfficeRef, c: ContestRef) =>
        txRules.certificationDate({ office: o, contest: c })?.value ?? null;
      // The Secretary of State's 2026 calendar: local canvass 12 March and 4 June, state runoff canvass 13 June.
      expect(
        cert(SHERIFF, {
          date: '2026-03-03',
          kind: 'primary',
          party: 'republican',
        }),
      ).toBe('2026-03-12');
      expect(
        cert(SHERIFF, {
          date: '2026-05-26',
          kind: 'primary_runoff',
          party: 'republican',
        }),
      ).toBe('2026-06-04');
      expect(
        cert(STATE_REP, {
          date: '2026-05-26',
          kind: 'primary_runoff',
          party: 'republican',
        }),
      ).toBe('2026-06-13');
      expect(
        cert(STATE_REP, {
          date: '2026-03-03',
          kind: 'primary',
          party: 'republican',
        }),
      ).toBe('2026-03-25');
      expect(
        cert(PRECINCT_CHAIR, {
          date: '2024-03-05',
          kind: 'primary',
          party: 'democratic',
        }),
      ).toBe('2024-03-14');
      expect(
        cert(NO_ELECTION, {
          date: '2026-11-03',
          kind: 'general',
          party: null,
        }),
      ).toBeNull();
    });
  });

  it('county pay is set locally', async () => {
    await eachZone(() => {
      expect(txRules.countyPay({ office: SHERIFF, year: 2026 })).toBeNull();
    });
  });
});

type KeyGroup = {
  readonly keys: readonly string[];
  readonly office: Pick<
    OfficeRef,
    'officeTypeId' | 'jurisdictionKind' | 'partisan' | 'schedule' | 'trackSet'
  >;
  readonly years: readonly number[];
  readonly citation: string;
};

const COUNCIL_MAY = {
  officeTypeId: 'city-council',
  jurisdictionKind: 'city',
  partisan: false,
  schedule: 'tx_uniform_may',
  trackSet: 'tx_local',
} as const;
const COUNCIL_NOVEMBER = { ...COUNCIL_MAY, schedule: 'tx_uniform_november' } as const;
const COMMISSIONER = {
  officeTypeId: 'county-commission',
  jurisdictionKind: 'county',
  partisan: true,
  schedule: 'tx_county_general',
  trackSet: 'tx_partisan',
} as const;

/**
 * The election years of each by-district template key from 2026 to 2031, read by hand: the
 * Secretary of State's 2026 and 2024 lists of offices up for election (commissioners), Dallas City
 * Charter ch. IV § 3 (each odd-numbered year), Austin's November 2026 election page and charter
 * art. III § 2(A) (the other half two years later), El Paso City Charter § 2.1.
 */
const TX_KEY_YEARS: readonly KeyGroup[] = [
  {
    keys: ['county-commissioner-precinct-2', 'county-commissioner-precinct-4'],
    office: COMMISSIONER,
    years: [2026, 2030],
    citation: 'Texas Secretary of State, Offices up for election in 2026',
  },
  {
    keys: ['county-commissioner-precinct-1', 'county-commissioner-precinct-3'],
    office: COMMISSIONER,
    years: [2028],
    citation: 'Texas Secretary of State, Offices up for election in 2024',
  },
  {
    keys: ['dallas-council'],
    office: COUNCIL_MAY,
    years: [2027, 2029, 2031],
    citation: 'Dallas City Charter ch. IV, § 3',
  },
  {
    keys: [1, 3, 5, 8, 9].map((n) => `austin-council-district-${String(n)}`),
    office: COUNCIL_NOVEMBER,
    years: [2026, 2030],
    citation: 'City of Austin, City Clerk, November 2026 Election',
  },
  {
    keys: [2, 4, 6, 7, 10].map((n) => `austin-council-district-${String(n)}`),
    office: COUNCIL_NOVEMBER,
    years: [2028],
    citation: 'Austin City Charter art. III, § 2(A)',
  },
  {
    keys: [1, 5, 6, 8].map((n) => `el-paso-council-district-${String(n)}`),
    office: COUNCIL_NOVEMBER,
    years: [2026, 2030],
    citation: 'El Paso City Charter § 2.1',
  },
  {
    keys: [2, 3, 4, 7].map((n) => `el-paso-council-district-${String(n)}`),
    office: COUNCIL_NOVEMBER,
    years: [2028],
    citation: 'El Paso City Charter § 2.1',
  },
];

function generalYears(entry: OfficeRef, from: number, to: number): number[] {
  const years: number[] = [];
  for (let year = from; year <= to; year++) {
    if (txRules.contests({ office: entry, year }).some((c) => c.kind === 'general')) {
      years.push(year);
    }
  }
  return years;
}

describe('TX by-district offices by template key (D-894)', () => {
  it('each key has contests only in its cited years', async () => {
    await eachZone(() => {
      for (const group of TX_KEY_YEARS) {
        for (const templateKey of group.keys) {
          const entry = office({ ...group.office, templateKey });
          expect(generalYears(entry, 2026, 2031)).toEqual(group.years);
          for (let year = 2026; year <= 2031; year++) {
            const contests = txRules.contests({ office: entry, year });
            if (!group.years.includes(year)) {
              expect(contests).toEqual([]);
            }
          }
        }
      }
    });
  });

  it('a keyed commissioner keeps the primaries and runoffs of its years', async () => {
    await eachZone(() => {
      const entry = office({ ...COMMISSIONER, templateKey: 'county-commissioner-precinct-2' });
      const kinds = txRules.contests({ office: entry, year: 2026 }).map((c) => c.kind);
      expect(kinds).toEqual(['primary', 'primary', 'primary_runoff', 'primary_runoff', 'general']);
      // The primary keeps its statute's citation; the general cites the year's source.
      const contests = txRules.contests({ office: entry, year: 2026 });
      expect(contests[0]?.dateCitation.citation).toBe('Tex. Elec. Code § 41.007(a)');
      expect(contests[4]?.date).toBe('2026-11-03');
    });
  });

  it('a key with no cycle keeps the current behaviour', async () => {
    await eachZone(() => {
      expect(
        generalYears(office({ ...COUNCIL_NOVEMBER, templateKey: 'houston-council' }), 2026, 2031),
      ).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
      expect(
        generalYears(office({ ...COUNCIL_MAY, templateKey: 'fort-worth-council' }), 2026, 2031),
      ).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
      expect(
        generalYears(office({ ...COMMISSIONER, templateKey: 'county-commissioner' }), 2026, 2031),
      ).toEqual([2026, 2028, 2030]);
    });
  });

  it('each keyed general cites its source with an https link and a quote', async () => {
    await eachZone(() => {
      for (const group of TX_KEY_YEARS) {
        for (const templateKey of group.keys) {
          for (const year of group.years) {
            const general = txRules
              .contests({ office: office({ ...group.office, templateKey }), year })
              .find((c) => c.kind === 'general');
            expect(general?.dateCitation.citation).toBe(group.citation);
            expect(general?.dateCitation.sourceUrl).toMatch(/^https:\/\//);
            expect(general?.dateCitation.quote.length).toBeGreaterThan(20);
          }
        }
      }
    });
  });

  it('a keyed office files on the same deadline as any other', async () => {
    await eachZone(() => {
      const contest: ContestRef = { date: '2027-05-01', kind: 'general', party: null };
      expect(
        txRules.filingTracks({
          office: office({ ...COUNCIL_MAY, templateKey: 'dallas-council' }),
          contest,
        }),
      ).toEqual(txRules.filingTracks({ office: office({ ...COUNCIL_MAY }), contest }));
    });
  });
});
