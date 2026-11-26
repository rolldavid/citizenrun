// The fixture state ZZ: a made-up rules module and calendar that prove the suite checker.
// Nothing here is a real state, statute or calendar; every link is on example.test.
import {
  addDays,
  daysBefore,
  federalHolidays,
  novemberElectionDay,
  roll,
  selectVersion,
} from '../dates.ts';
import type { HolidayCalendar, Versioned } from '../dates.ts';
import type {
  Citation,
  ContestRef,
  IsoDate,
  RulesFixture,
  StateRules,
  TrackOut,
} from '../types.ts';
import type { StateSuiteInput } from './check-fixtures.ts';

const SCHEDULE = 'zz_county_general';
const TRACK_SET = 'zz_filing';

function fixtureCitation(
  section: string,
  quote: string,
  validFrom: IsoDate = '2000-01-01',
  validTo: IsoDate | null = null,
): Citation {
  return {
    citation: `Fixture Code ${section}`,
    sourceUrl: `https://example.test/fixture-code/${section}`,
    quote: `Fixture rule: ${quote}`,
    validFrom,
    validTo,
  };
}

const ELECTION_DAY = fixtureCitation(
  'zz-1-101',
  'the county general election is held on the first Tuesday after the first Monday in November.',
);
const FILING_OPENS = fixtureCitation(
  'zz-2-201',
  'the filing period opens on the 74th day before the election.',
);
const FILING_FEE = fixtureCitation('zz-2-205', 'the filing fee is fifty dollars.');
const CERTIFICATION = fixtureCitation(
  'zz-3-301',
  'the county board certifies the results on the 14th day after the election.',
);

/** The closing day's two versions: the law changed for contests from 2027. */
const FILING_CLOSES: readonly Versioned<{ readonly days: number; readonly citation: Citation }>[] =
  [
    {
      validFrom: '2000-01-01',
      validTo: '2026-12-31',
      rule: {
        days: 57,
        citation: fixtureCitation(
          'zz-2-202',
          'the filing period closes on the 57th day before the election; a closing day that is not a business day moves to the next business day.',
          '2000-01-01',
          '2026-12-31',
        ),
      },
    },
    {
      validFrom: '2027-01-01',
      validTo: null,
      rule: {
        days: 64,
        citation: fixtureCitation(
          'zz-2-202a',
          'the filing period closes on the 64th day before the election; a closing day that is not a business day moves to the next business day.',
          '2027-01-01',
        ),
      },
    },
  ];

function zzHolidays(year: number): HolidayCalendar {
  return { state: 'ZZ', year, holidays: federalHolidays(year) };
}

function zzFilingTrack(contest: ContestRef): TrackOut {
  const year = Number(contest.date.slice(0, 4));
  const closes = selectVersion(FILING_CLOSES, contest.date);
  return {
    track: 'nonpartisan',
    opensOn: { value: daysBefore(contest.date, 74), citation: FILING_OPENS },
    closesOn: {
      value: roll(daysBefore(contest.date, closes.days), 'next_business_day', zzHolidays(year)),
      citation: closes.citation,
    },
    closesTime: null,
    petitionOpens: null,
    petitionDue: null,
    fee: { value: { kind: 'fixed', cents: 5_000 }, citation: FILING_FEE },
    signatures: null,
    alternatives: [],
    whereToFile: null,
    withdrawalDeadline: null,
  };
}

export const zzRules: StateRules = {
  state: 'ZZ',
  schedules: [SCHEDULE],
  trackSets: [TRACK_SET],
  holidays: zzHolidays,
  contests: ({ office, year }) =>
    office.schedule === SCHEDULE
      ? [
          {
            date: novemberElectionDay(year),
            kind: 'general',
            party: null,
            dateCitation: ELECTION_DAY,
            electsOutright: false,
          },
        ]
      : [],
  filingTracks: ({ office, contest }) =>
    office.trackSet === TRACK_SET && contest.kind === 'general' ? [zzFilingTrack(contest)] : [],
  certificationDate: ({ contest }) => ({
    value: addDays(contest.date, 14),
    citation: CERTIFICATION,
  }),
  countyPay: () => null,
};

const OFFICE = {
  templateKey: 'county-commission',
  officeTypeId: 'county-commission',
  schedule: SCHEDULE,
  trackSet: TRACK_SET,
} as const;

function zzFixture(year: number, date: IsoDate, opensOn: IsoDate, closesOn: IsoDate): RulesFixture {
  return {
    state: 'ZZ',
    source: {
      title: `Fixture County election calendar ${String(year)}`,
      url: `https://example.test/fixture-calendar/${String(year)}`,
      retrievedOn: '2026-11-20',
      sha256: '0'.repeat(64),
    },
    contests: [
      {
        id: `zz-${String(year)}-general`,
        office: OFFICE,
        year,
        expect: [{ date, kind: 'general', party: null }],
        quote: `Fixture calendar: county general election, ${date}.`,
      },
    ],
    cases: [
      {
        id: `zz-${String(year)}-filing`,
        office: OFFICE,
        contest: { date, kind: 'general', party: null },
        expect: [{ track: 'nonpartisan', opensOn, closesOn, closesTime: null }],
        quote: `Fixture calendar: candidate filing opens ${opensOn} and closes ${closesOn}.`,
      },
    ],
  };
}

export const zzFixtures: readonly RulesFixture[] = [
  // 57 days before, a Monday, no roll.
  zzFixture(2024, '2024-11-05', '2024-08-23', '2024-09-09'),
  // 57 days before is Labor Day, 2026-09-07; rolled to the Tuesday.
  zzFixture(2026, '2026-11-03', '2026-08-21', '2026-09-08'),
  // The 2027 version, 64 days before.
  zzFixture(2027, '2027-11-02', '2027-08-20', '2027-08-30'),
];

export const zzSuiteInput: StateSuiteInput = {
  state: 'ZZ',
  rules: zzRules,
  fixtures: zzFixtures,
  declaredRules: [
    {
      id: 'zz.nonpartisan',
      trackSet: TRACK_SET,
      track: 'nonpartisan',
      rolled: {
        caseId: 'zz-2026-filing',
        field: 'closesOn',
        unrolled: '2026-09-07',
        direction: 'next_business_day',
      },
    },
  ],
  officialHosts: ['example.test'],
  partisanOfficeTypes: [],
  partyPrimaryExempt: false,
};
