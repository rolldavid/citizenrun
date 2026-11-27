// Washington's deadline rules (PIPE-rules-api, PIPE-rules-helpers; D-330). One filing week for
// every office (RCW 29A.24.050), the August top-two primary and the November general, the
// precinct committee officers on the even-year primary, the legal holidays of RCW 1.16.050, and
// the county canvass and Secretary of State certification days.
import {
  FRIDAY,
  MONDAY,
  SATURDAY,
  SUNDAY,
  THURSDAY,
  TUESDAY,
  addDays,
  daysBefore,
  novemberElectionDay,
  nthWeekdayOfMonth,
  weekdayOf,
} from '../dates.ts';
import type { Holiday, HolidayCalendar } from '../dates.ts';
import type {
  Citation,
  Computed,
  ContestOut,
  ContestRef,
  FeeRule,
  IsoDate,
  OfficeRef,
  StateRules,
  TrackOut,
} from '../types.ts';

const STATE = 'WA';

const RCW = 'https://app.leg.wa.gov/RCW/default.aspx?cite=';

/**
 * The opening day of the earliest filing week the fixtures reproduce (2024), the basis of every
 * citation whose official page states no effective date for its current text (PIPE-rules-api).
 */
const EARLIEST_PUBLISHED_APPLICATION = '2024-05-06';

function cite(citation: string, quote: string, validFrom: IsoDate): Citation {
  return {
    citation: `RCW ${citation}`,
    sourceUrl: `${RCW}${citation}`,
    quote,
    validFrom,
    validTo: null,
  };
}

function computed<T>(value: T, citation: Citation): Computed<T> {
  return { value, citation };
}

// ---------------------------------------------------------------------------------------------
// Schedules and track sets (the rules interface).

const STATE_GENERAL = 'wa_state_general';
const COUNTY_GENERAL = 'wa_county_general';
const CHARTER_COUNTY_ODD_YEAR = 'wa_charter_county_odd_year';
const LOCAL_ODD_YEAR = 'wa_local_odd_year';
const STATE_PRIMARY = 'wa_state_primary';
const CONSERVATION_DISTRICT = 'wa_conservation_district';
const NO_PUBLIC_ELECTION = 'wa_no_public_election';
const FILING_WEEK = 'wa_filing_week';
const NO_FILING = 'wa_no_filing';

/** The first and last years the module serves: two years before its earliest fixture, and the helpers' end. */
const FIRST_SERVED_YEAR = 2022;
const LAST_SERVED_YEAR = 2100;

function assertServed(year: number): void {
  if (!Number.isInteger(year) || year < FIRST_SERVED_YEAR || year > LAST_SERVED_YEAR) {
    throw new RangeError(`${STATE}: no rules for ${String(year)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Election dates.

const PRIMARY_DAY = cite(
  '29A.04.311',
  'Primaries for general elections to be held in November, and the election of precinct committee officers, must be held on the first Tuesday of the preceding August.',
  // 2011 c 349 s 2, which takes effect January 1, 2012 (the note following RCW 29A.04.255).
  '2012-01-01',
);

const STATE_GENERAL_DAY = cite(
  '29A.04.321',
  'All state, county, city, town, and district general elections for the election of federal, state, legislative, judicial, county, city, town, and district officers, and for the submission to the voters of the state, county, city, town, or district of any measure for their adoption and approval or rejection, shall be held on the first Tuesday after the first Monday of November, in the year in which they may be called.',
  EARLIEST_PUBLISHED_APPLICATION,
);

const CHARTER_COUNTY_GENERAL_DAY = cite(
  '29A.04.321',
  '(d) the election of county officers in any county governed by a charter containing provisions calling for general county elections at this time;',
  EARLIEST_PUBLISHED_APPLICATION,
);

const LOCAL_GENERAL_DAY = cite(
  '29A.04.330',
  'All city, town, and district general elections shall be held throughout the state of Washington on the first Tuesday following the first Monday in November in the odd-numbered years.',
  EARLIEST_PUBLISHED_APPLICATION,
);

const PRECINCT_COMMITTEE_PRIMARY = cite(
  '29A.80.051',
  'The office must be voted upon at the primaries, and the names of all candidates in contested races must appear under the proper party and office designations on the ballot for the primary for each even-numbered year.',
  // 2012 c 89 s 5, which took effect immediately, March 29, 2012 (the note following RCW 29A.24.311).
  '2012-03-29',
);

/** The first Tuesday of August (RCW 29A.04.311). */
function primaryDay(year: number): IsoDate {
  return nthWeekdayOfMonth(year, 8, TUESDAY, 1);
}

/** The August primary (top-two: party null, never electing outright, R-016) and the November general. */
function primaryAndGeneral(year: number, generalCitation: Citation): readonly ContestOut[] {
  return [
    {
      date: primaryDay(year),
      kind: 'primary',
      party: null,
      dateCitation: PRIMARY_DAY,
      electsOutright: false,
    },
    {
      date: novemberElectionDay(year),
      kind: 'general',
      party: null,
      dateCitation: generalCitation,
      electsOutright: false,
    },
  ];
}

const isEven = (year: number): boolean => year % 2 === 0;

function contests(office: OfficeRef, year: number): readonly ContestOut[] {
  assertServed(year);
  switch (office.schedule) {
    case STATE_GENERAL:
    case COUNTY_GENERAL:
      return isEven(year) ? primaryAndGeneral(year, STATE_GENERAL_DAY) : [];
    case CHARTER_COUNTY_ODD_YEAR:
      return isEven(year) ? [] : primaryAndGeneral(year, CHARTER_COUNTY_GENERAL_DAY);
    case LOCAL_ODD_YEAR:
      return isEven(year) ? [] : primaryAndGeneral(year, LOCAL_GENERAL_DAY);
    case STATE_PRIMARY:
      return isEven(year)
        ? [
            {
              date: primaryDay(year),
              kind: 'primary',
              party: null,
              dateCitation: PRECINCT_COMMITTEE_PRIMARY,
              electsOutright: false,
            },
          ]
        : [];
    // RCW 89.08.190: each board sets its own date in the first quarter; nothing is generated.
    case CONSERVATION_DISTRICT:
    case NO_PUBLIC_ELECTION:
      return [];
    default:
      throw new RangeError(`wa: unknown schedule ${office.schedule}`);
  }
}

// ---------------------------------------------------------------------------------------------
// The filing week (RCW 29A.24.050), withdrawal (RCW 29A.24.131), filing officer and fee.

const FILING_WEEK_RULE = cite(
  '29A.24.050',
  'Except where otherwise provided by this title, declarations of candidacy for the following offices shall be filed between 8:00 a.m. and 5:00 p.m. with the filing officer beginning the first Monday in May and ending the following Friday in the year in which the office is scheduled to be voted upon:',
  EARLIEST_PUBLISHED_APPLICATION,
);

const WITHDRAWAL = cite(
  '29A.24.131',
  "A candidate may withdraw the candidate's declaration of candidacy at any time before 5:00 p.m. on the Monday following the last day for candidates to file under RCW 29A.24.050",
  EARLIEST_PUBLISHED_APPLICATION,
);

const FILE_WITH_SECRETARY = cite(
  '29A.24.070',
  '(a) The secretary of state for declarations of candidacy for statewide offices, United States senate, United States house of representatives, Washington state legislature, court of appeals, and superior court.',
  EARLIEST_PUBLISHED_APPLICATION,
);

const FILE_WITH_AUDITOR = cite(
  '29A.24.070',
  '(b) The county auditor for all other offices.',
  EARLIEST_PUBLISHED_APPLICATION,
);

const FEE_ONE_PERCENT = cite(
  '29A.24.091',
  'A filing fee equal to one percent of the annual salary of the office at the time of filing shall accompany the declaration of candidacy for any office with a fixed annual salary of more than one thousand dollars per annum.',
  EARLIEST_PUBLISHED_APPLICATION,
);

const FEE_NONE_PRECINCT_COMMITTEE = cite(
  '29A.24.091',
  'No filing fee need accompany a declaration of candidacy for precinct committee officer',
  EARLIEST_PUBLISHED_APPLICATION,
);

/** Office types RCW 29A.24.070(1)(a) sends to the Secretary of State (superior court: by template key). */
const FILED_WITH_SECRETARY: ReadonlySet<string> = new Set([
  'us-senate',
  'us-house',
  'governor',
  'statewide-executive-other',
  'attorney-general',
  'secretary-of-state',
  'state-treasurer',
  'insurance-commissioner',
  'oil-gas-land-commission',
  'state-education-board',
  'state-senate',
  'state-house',
  'state-appellate-judge',
]);
const SUPERIOR_COURT_TEMPLATE_KEY = 'superior-court-judge';

/**
 * Office types with a fixed annual salary of more than one thousand dollars, so RCW 29A.24.091's
 * one percent applies: the offices the Secretary of State files, the judges, and the county officers
 * whose least salary RCW 36.17.020 sets above it.
 */
const ONE_PERCENT_FEE: ReadonlySet<string> = new Set([
  ...FILED_WITH_SECRETARY,
  'trial-judge',
  'county-commission',
  'sheriff',
  'district-attorney',
  'county-clerk',
  'county-treasurer',
  'county-assessor',
  'county-row-other',
]);
const PRECINCT_COMMITTEE = 'party-precinct-committee';

function filedWithSecretary(office: OfficeRef): boolean {
  if (office.officeTypeId === 'trial-judge') {
    return office.templateKey === SUPERIOR_COURT_TEMPLATE_KEY;
  }
  return FILED_WITH_SECRETARY.has(office.officeTypeId);
}

function fee(office: OfficeRef): Computed<FeeRule> | null {
  if (office.officeTypeId === PRECINCT_COMMITTEE) {
    return computed({ kind: 'none' }, FEE_NONE_PRECINCT_COMMITTEE);
  }
  if (ONE_PERCENT_FEE.has(office.officeTypeId)) {
    return computed({ kind: 'percent_of_annual_pay', percent: 1 }, FEE_ONE_PERCENT);
  }
  // A salary of $1,000 or less ($10), or pay per diem or per meeting (no fee): not placed here.
  return null;
}

/** One declaration in the filing week of the contest's year: Monday to the following Friday, 5 p.m. */
function filingWeekTrack(office: OfficeRef, contest: ContestRef): TrackOut {
  const year = Number(contest.date.slice(0, 4));
  assertServed(year);
  const opensOn = nthWeekdayOfMonth(year, 5, MONDAY, 1);
  const closesOn = addDays(opensOn, FRIDAY - MONDAY);
  return {
    track: 'nonpartisan',
    opensOn: computed(opensOn, FILING_WEEK_RULE),
    closesOn: computed(closesOn, FILING_WEEK_RULE),
    closesTime: computed('17:00', FILING_WEEK_RULE),
    petitionOpens: null,
    petitionDue: null,
    fee: fee(office),
    signatures: null,
    alternatives: [],
    whereToFile: filedWithSecretary(office)
      ? computed('the secretary of state', FILE_WITH_SECRETARY)
      : computed('the county auditor', FILE_WITH_AUDITOR),
    withdrawalDeadline: computed(addDays(closesOn, MONDAY + 7 - FRIDAY), WITHDRAWAL),
  };
}

function filingTracks(office: OfficeRef, contest: ContestRef): readonly TrackOut[] {
  switch (office.trackSet) {
    case FILING_WEEK:
      return contest.kind === 'primary' || contest.kind === 'general'
        ? [filingWeekTrack(office, contest)]
        : [];
    case NO_FILING:
      return [];
    default:
      throw new RangeError(`wa: unknown track set ${office.trackSet}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Certification (D-322).

const COUNTY_CANVASS = cite(
  '29A.60.190',
  'Ten days after a special election held in February or April, ten days after a presidential primary held pursuant to chapter 29A.56 RCW, fourteen days after a primary, or twenty-one days after a general election, the county canvassing board shall complete the canvass and certify the results.',
  EARLIEST_PUBLISHED_APPLICATION,
);

const SECRETARY_PRIMARY = cite(
  '29A.60.240',
  'The secretary of state shall, as soon as possible but in any event not later than seventeen days following the primary, canvass and certify the returns of all primary elections as to candidates for statewide offices, United States senators and representatives in Congress, and all legislative and judicial candidates whose district extends beyond the limits of a single county.',
  EARLIEST_PUBLISHED_APPLICATION,
);

const SECRETARY_GENERAL = cite(
  '29A.60.250',
  'As soon as the returns have been received from all the counties of the state, but not later than the thirtieth day after the election, the secretary of state shall canvass and certify the returns of the general election as to candidates for statewide offices, the United States senate, congress, and all legislative and judicial candidates whose districts extend beyond the limits of a single county.',
  EARLIEST_PUBLISHED_APPLICATION,
);

/**
 * Offices whose returns the Secretary of State certifies: statewide, federal, legislative and
 * judicial. A legislative or judicial district inside one county is final at the county canvass,
 * which OfficeRef cannot tell apart, so those offices take the later state day.
 */
const CERTIFIED_BY_SECRETARY: ReadonlySet<string> = new Set([
  ...FILED_WITH_SECRETARY,
  'trial-judge',
]);

function certificationDate(office: OfficeRef, contest: ContestRef): Computed<IsoDate> | null {
  const bySecretary = CERTIFIED_BY_SECRETARY.has(office.officeTypeId);
  switch (contest.kind) {
    case 'primary':
      return bySecretary
        ? computed(addDays(contest.date, 17), SECRETARY_PRIMARY)
        : computed(addDays(contest.date, 14), COUNTY_CANVASS);
    case 'general':
      return bySecretary
        ? computed(addDays(contest.date, 30), SECRETARY_GENERAL)
        : computed(addDays(contest.date, 21), COUNTY_CANVASS);
    // No runoff is held, and special elections are never generated (P8-20).
    case 'primary_runoff':
    case 'general_runoff':
    case 'special':
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Holidays (RCW 1.16.050).

const HOLIDAY_SECTION = '1.16.050';

function holidayCitation(quote: string): Citation {
  return cite(HOLIDAY_SECTION, quote, EARLIEST_PUBLISHED_APPLICATION);
}

const NEW_YEAR = holidayCitation("(b) The first day of January, commonly called New Year's Day;");
const KING = holidayCitation(
  '(c) The third Monday of January, celebrated as the anniversary of the birth of Martin Luther King, Jr.;',
);
const PRESIDENTS = holidayCitation(
  "(d) The third Monday of February, to be known as Presidents' Day and celebrated as the anniversary of the births of Abraham Lincoln and George Washington;",
);
const MEMORIAL = holidayCitation('(e) The last Monday of May, commonly known as Memorial Day;');
const JUNETEENTH = holidayCitation(
  '(f) The nineteenth day of June, recognized as Juneteenth, a day of remembrance for the day the African slaves learned of their freedom;',
);
const INDEPENDENCE = holidayCitation(
  '(g) The fourth day of July, the anniversary of the Declaration of Independence;',
);
const LABOR = holidayCitation('(h) The first Monday in September, to be known as Labor Day;');
const VETERANS = holidayCitation('(i) The eleventh day of November, to be known as Veterans Day;');
const THANKSGIVING = holidayCitation(
  '(j) The fourth Thursday in November, to be known as Thanksgiving Day;',
);
const NATIVE_AMERICAN_HERITAGE = holidayCitation(
  '(k) The Friday immediately following the fourth Thursday in November, to be known as Native American Heritage Day; and',
);
const CHRISTMAS = holidayCitation(
  '(l) The twenty-fifth day of December, commonly called Christmas Day.',
);

function dateIn(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The holidays of RCW 1.16.050(1) in `year`, before the weekend rule of subsection (5). */
function statutoryHolidays(year: number): readonly Holiday[] {
  const thanksgiving = nthWeekdayOfMonth(year, 11, THURSDAY, 4);
  return [
    { date: dateIn(year, 1, 1), name: "New Year's Day", citation: NEW_YEAR },
    {
      date: nthWeekdayOfMonth(year, 1, MONDAY, 3),
      name: 'Martin Luther King, Jr. Day',
      citation: KING,
    },
    { date: nthWeekdayOfMonth(year, 2, MONDAY, 3), name: "Presidents' Day", citation: PRESIDENTS },
    { date: nthWeekdayOfMonth(year, 5, MONDAY, -1), name: 'Memorial Day', citation: MEMORIAL },
    { date: dateIn(year, 6, 19), name: 'Juneteenth', citation: JUNETEENTH },
    { date: dateIn(year, 7, 4), name: 'Independence Day', citation: INDEPENDENCE },
    { date: nthWeekdayOfMonth(year, 9, MONDAY, 1), name: 'Labor Day', citation: LABOR },
    { date: dateIn(year, 11, 11), name: 'Veterans Day', citation: VETERANS },
    { date: thanksgiving, name: 'Thanksgiving Day', citation: THANKSGIVING },
    {
      date: addDays(thanksgiving, 1),
      name: 'Native American Heritage Day',
      citation: NATIVE_AMERICAN_HERITAGE,
    },
    { date: dateIn(year, 12, 25), name: 'Christmas Day', citation: CHRISTMAS },
  ];
}

/** RCW 1.16.050(5): a holiday on a Sunday is the Monday after; on a Saturday, the Friday before. */
function legalDay(date: IsoDate): IsoDate {
  const weekday = weekdayOf(date);
  if (weekday === SUNDAY) {
    return addDays(date, 1);
  }
  if (weekday === SATURDAY) {
    return daysBefore(date, 1);
  }
  return date;
}

/** Every legal holiday whose day falls in `year`: New Year's Day on a Saturday is the Friday before. */
function holidays(year: number): HolidayCalendar {
  assertServed(year);
  const prefix = `${String(year)}-`;
  const list = [...statutoryHolidays(year), ...statutoryHolidays(year + 1)]
    .map((holiday) => ({ ...holiday, date: legalDay(holiday.date) }))
    .filter((holiday) => holiday.date.startsWith(prefix))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { state: STATE, year, holidays: list };
}

// ---------------------------------------------------------------------------------------------
// County pay (D-317): RCW 36.17.020 leaves the salaries to each county and sets only a least
// amount, so county_pay is local and countyPay answers null.

export const waRules: StateRules = {
  state: STATE,
  schedules: [
    STATE_GENERAL,
    COUNTY_GENERAL,
    CHARTER_COUNTY_ODD_YEAR,
    LOCAL_ODD_YEAR,
    STATE_PRIMARY,
    CONSERVATION_DISTRICT,
    NO_PUBLIC_ELECTION,
  ],
  trackSets: [FILING_WEEK, NO_FILING],
  holidays,
  contests: ({ office, year }) => contests(office, year),
  filingTracks: ({ office, contest }) => filingTracks(office, contest),
  certificationDate: ({ office, contest }) => certificationDate(office, contest),
  countyPay: () => null,
};
