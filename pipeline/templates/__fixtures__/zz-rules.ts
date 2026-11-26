// The rules module of the fixture state ZZ, built only from the helpers of the rules package. Every
// citation is visibly fake.
import {
  TUESDAY,
  addDays,
  daysBefore,
  federalHolidays,
  novemberElectionDay,
  nthWeekdayOfMonth,
  roll,
} from '@citizenrun/rules';
import type { Citation, ContestOut, HolidayCalendar, StateRules, TrackOut } from '@citizenrun/rules';

function cite(n: number, rule: string): Citation {
  return {
    citation: `ZZ Fixture Code ${String(n)}`,
    sourceUrl: 'https://example.test/zz/code',
    quote: `Fixture text: ${rule}`,
    validFrom: '2000-01-01',
    validTo: null,
  };
}

const COUNTY_GENERAL = cite(101, 'the county general election is held on the November election day of each even year.');
const STATE_GENERAL = cite(102, 'the state general election is held on the November election day of each even year.');
const LOCAL_ODD = cite(103, 'city and district elections are held on the November election day of each odd year.');
const PRIMARY = cite(104, 'the primary election is held on the first Tuesday in May of each even year.');
const PARTY_FILING = cite(105, 'a party candidate files from the 90th day to the 60th day before the primary.');
const PRIMARY_FEE = cite(106, 'a party candidate pays a filing fee of one percent of the annual salary of the office.');
const WHERE_TO_FILE = cite(107, 'candidates file with the county board of elections.');
const INDEPENDENT_FILING = cite(108, 'an independent candidate files from the 120th day to the 75th day before the general election.');
const INDEPENDENT_NOON = cite(109, 'an independent candidate files by noon on the last day of filing.');
const INDEPENDENT_FEE = cite(110, 'an independent candidate pays a filing fee of 100 dollars.');
const INDEPENDENT_SIGNATURES = cite(111, 'an independent candidate files a petition of 200 voters.');
const NO_SIGNATURES = cite(112, 'a party or nonpartisan candidate files no petition.');
const NONPARTISAN_FILING = cite(113, 'a nonpartisan candidate files from the 120th day to the 90th day before the election.');
const NONPARTISAN_FEE = cite(114, 'a nonpartisan candidate pays a filing fee of 50 dollars.');
const PARTY_OFFICE_FILING = cite(115, 'a precinct committee candidate files by the 60th day before the primary.');
const PARTY_OFFICE_FEE = cite(116, 'a precinct committee candidate pays no filing fee.');
const CERTIFICATION = cite(117, 'the results are certified on the 10th day after the election.');
const COUNTY_PAY = cite(118, 'each county commissioner receives an annual salary of 45,000 dollars.');

const PARTIES = ['democratic', 'republican'] as const;
const WHERE: TrackOut['whereToFile'] = { value: 'Fixture County Board of Elections', citation: WHERE_TO_FILE };

function calendar(year: number): HolidayCalendar {
  return { state: 'ZZ', year, holidays: federalHolidays(year) };
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

function general(year: number, citation: Citation): ContestOut {
  return { date: novemberElectionDay(year), kind: 'general', party: null, dateCitation: citation, electsOutright: false };
}

function primaryDate(year: number): string {
  return nthWeekdayOfMonth(year, 5, TUESDAY, 1);
}

function track(fields: Partial<TrackOut> & Pick<TrackOut, 'track' | 'closesOn'>): TrackOut {
  return {
    opensOn: null,
    closesTime: null,
    petitionOpens: null,
    petitionDue: null,
    fee: null,
    signatures: null,
    alternatives: [],
    whereToFile: null,
    withdrawalDeadline: null,
    ...fields,
  };
}

export const ZZ_RULES: StateRules = {
  state: 'ZZ',
  schedules: ['zz_county_general', 'zz_state_general', 'zz_local_odd', 'zz_state_primary'],
  trackSets: ['zz_partisan', 'zz_nonpartisan', 'zz_party'],
  holidays: calendar,
  contests({ office, year }) {
    switch (office.schedule) {
      case 'zz_county_general':
      case 'zz_state_general': {
        if (year % 2 !== 0) {
          return [];
        }
        const out: ContestOut[] = [general(year, office.schedule === 'zz_county_general' ? COUNTY_GENERAL : STATE_GENERAL)];
        if (office.partisan === true) {
          for (const party of PARTIES) {
            out.push({ date: primaryDate(year), kind: 'primary', party, dateCitation: PRIMARY, electsOutright: false });
          }
        }
        return out;
      }
      case 'zz_local_odd':
        return year % 2 === 1 ? [general(year, LOCAL_ODD)] : [];
      case 'zz_state_primary':
        return year % 2 === 0
          ? [{ date: primaryDate(year), kind: 'primary', party: null, dateCitation: PRIMARY, electsOutright: false }]
          : [];
      default:
        return [];
    }
  },
  filingTracks({ office, contest }) {
    const cal = calendar(yearOf(contest.date));
    switch (office.trackSet) {
      case 'zz_partisan':
        if (contest.kind === 'primary') {
          return [
            track({
              track: 'party_primary',
              opensOn: { value: daysBefore(contest.date, 90), citation: PARTY_FILING },
              closesOn: { value: roll(daysBefore(contest.date, 60), 'next_business_day', cal), citation: PARTY_FILING },
              fee: { value: { kind: 'percent_of_annual_pay', percent: 1 }, citation: PRIMARY_FEE },
              signatures: { value: { kind: 'none' }, citation: NO_SIGNATURES },
              whereToFile: WHERE,
            }),
          ];
        }
        if (contest.kind === 'general') {
          return [
            track({
              track: 'independent',
              opensOn: { value: daysBefore(contest.date, 120), citation: INDEPENDENT_FILING },
              closesOn: {
                value: roll(daysBefore(contest.date, 75), 'next_business_day', cal),
                citation: INDEPENDENT_FILING,
              },
              closesTime: { value: '12:00', citation: INDEPENDENT_NOON },
              fee: { value: { kind: 'fixed', cents: 10_000 }, citation: INDEPENDENT_FEE },
              signatures: { value: { kind: 'fixed', count: 200 }, citation: INDEPENDENT_SIGNATURES },
            }),
          ];
        }
        return [];
      case 'zz_nonpartisan':
        return contest.kind === 'general'
          ? [
              track({
                track: 'nonpartisan',
                opensOn: { value: daysBefore(contest.date, 120), citation: NONPARTISAN_FILING },
                closesOn: { value: daysBefore(contest.date, 90), citation: NONPARTISAN_FILING },
                fee: { value: { kind: 'fixed', cents: 5_000 }, citation: NONPARTISAN_FEE },
                signatures: { value: { kind: 'none' }, citation: NO_SIGNATURES },
              }),
            ]
          : [];
      case 'zz_party':
        return contest.kind === 'primary'
          ? [
              track({
                track: 'party_primary',
                closesOn: { value: daysBefore(contest.date, 60), citation: PARTY_OFFICE_FILING },
                fee: { value: { kind: 'none' }, citation: PARTY_OFFICE_FEE },
              }),
            ]
          : [];
      default:
        return [];
    }
  },
  certificationDate({ contest }) {
    return { value: addDays(contest.date, 10), citation: CERTIFICATION };
  },
  countyPay({ office }) {
    return office.officeTypeId === 'county-commission'
      ? { value: { amountCents: 4_500_000, period: 'year' }, citation: COUNTY_PAY }
      : null;
  },
};
