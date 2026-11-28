// Virginia's deadline rules (PIPE-rules-api, PIPE-rules-helpers; D-330). The June party primary,
// its filing window and the third-Tuesday-in-June deadline for every other filer, the odd-year
// statewide and General Assembly cycles, the legal holidays of Va. Code § 2.2-3300, and the
// canvass and State Board certification days.
import {
  MONDAY,
  SATURDAY,
  SUNDAY,
  THURSDAY,
  TUESDAY,
  addDays,
  daysBefore,
  novemberElectionDay,
  nthWeekdayOfMonth,
  roll,
  selectVersion,
  weekdayOf,
} from '../dates.ts';
import type { Holiday, HolidayCalendar, Versioned } from '../dates.ts';
import type {
  Citation,
  Computed,
  ContestOut,
  ContestRef,
  IsoDate,
  LocalTime,
  OfficeRef,
  StateRules,
  TrackOut,
} from '../types.ts';

const STATE = 'VA';

const ELECT = 'https://www.elections.virginia.gov';
const LIS = 'https://legacylis.virginia.gov/cgi-bin/legp604.exe';
const CHANGES_2021 = `${ELECT}/media/electionadministration/electionlaw/2021-Changes-to-Virginia-Election-Laws_FINAL.updated.pdf`;
const CHANGES_2022 = `${ELECT}/media/electionadministration/electionlaw/2022-Changes-to-Virginia-Election-Laws_UPDATED-FINAL.pdf`;
const CHANGES_2024 = `${ELECT}/media/electionadministration/electionlaw/2024-Changes-to-Virginia-Election-Laws.pdf`;
const PRIMARY_MOVED_2026 = `${ELECT}/news-releases/primary-election-moved-to-august-4.html`;
const BULLETINS = `${ELECT}/media/candidatesandpacs`;
const LOCAL_2022 = `${BULLETINS}/2022-candidate-bulletins/2022-11-08-Local-and-Constitutional-Bulletin-rev-1.5.pdf`;
const LOCAL_2023 = `${BULLETINS}/2023-candidate-bulletins/2023-11-07_Gen_Bulletin_Local_Offices.pdf`;
const LOCAL_2024 = `${BULLETINS}/2024-candidate-bulletins/2024-11-05-Gen-Bulletin-Local-Offices-(3-8-24).pdf`;
const LOCAL_2025 = `${BULLETINS}/2025-candidate-bulletins/2025-11-04_Gen_Bulletin_Local_rev_12-5-2024.pdf`;
const LOCAL_2026 = `${BULLETINS}/2026-candidate-bulletins/2026-11-03_Local_Gen_Bulletin_(2-23-26).pdf`;
const US_HOUSE_2026 = `${BULLETINS}/2026-candidate-bulletins/2026-11-03_US_House_Gen_Bulletin_(2-23-26).pdf`;
const HANDBOOK_2026 = `${ELECT}/media/grebhandbook/2026-updates/1_General_Registrar_FINAL_Rev.09.26.pdf`;
const HOLIDAYS_2020 = `${LIS}?201+ful+CHAP0417`;
const HOLIDAYS_2021 = `${LIS}?202+ful+CHAP0004`;
const CANVASS_2022 = `${LIS}?221+ful+CHAP0444`;

function cite(
  citation: string,
  sourceUrl: string,
  quote: string,
  validFrom: IsoDate,
  validTo: IsoDate | null = null,
): Citation {
  return { citation, sourceUrl, quote, validFrom, validTo };
}

function computed<T>(value: T, citation: Citation): Computed<T> {
  return { value, citation };
}

// ---------------------------------------------------------------------------------------------
// Schedules and track sets (the rules interface).

const NOVEMBER_GENERAL = 'va_november_general';
const JUNE_PRIMARY = 'va_june_primary';
const MAY_GENERAL = 'va_may_general';
const NO_PUBLIC_ELECTION = 'va_no_public_election';
const PARTISAN = 'va_partisan';
const NONPARTISAN = 'va_nonpartisan';
const MAY = 'va_may';

/** The parties that hold state-run primaries: the two that meet the statute's 10 percent test. */
const PRIMARY_PARTIES = ['democratic', 'republican'] as const;

/** The first and last years the module serves: its earliest published cycle, and the helpers' end. */
const FIRST_SERVED_YEAR = 2022;
const LAST_SERVED_YEAR = 2100;

// ---------------------------------------------------------------------------------------------
// Election dates.

/** Election Day, from the holiday statute that names it (Va. Code § 2.2-3300). */
const ELECTION_DAY = cite(
  'Va. Code § 2.2-3300',
  HOLIDAYS_2021,
  'The Tuesday following the first Monday in November — Election Day for the right of citizens of a free society to exercise the right to vote.',
  '2021-03-01',
);

const PRIMARY_THIRD_TUESDAY = cite(
  'Va. Code § 24.2-515',
  CHANGES_2021,
  'This bill changes the date for primary elections from the second Tuesday in June to the third Tuesday in June.',
  '2022-01-01',
);

const PRIMARY_2026 = cite(
  'HB 29 (2026)',
  PRIMARY_MOVED_2026,
  'Primary elections for all offices appearing on the 2026 November General Election ballot will be held on Aug. 4, 2026. There will be no primary elections held on June 16, 2026.',
  '2026-02-20',
  '2026-12-31',
);

/** The day a June primary is held under § 24.2-515, and the day its filing deadlines count from. */
function thirdTuesdayInJune(year: number): IsoDate {
  return nthWeekdayOfMonth(year, 6, TUESDAY, 3);
}

type PrimaryDate = { readonly date: (year: number) => IsoDate; readonly citation: Citation };

/** HB 29 (2026) moved the 2026 primary only (D-330: a dated version, so past years still pass). */
const PRIMARY_DATES: readonly Versioned<PrimaryDate>[] = [
  {
    validFrom: '2022-01-01',
    validTo: '2025-12-31',
    rule: { date: thirdTuesdayInJune, citation: PRIMARY_THIRD_TUESDAY },
  },
  {
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    rule: { date: () => '2026-08-04', citation: PRIMARY_2026 },
  },
  {
    validFrom: '2027-01-01',
    validTo: null,
    rule: { date: thirdTuesdayInJune, citation: PRIMARY_THIRD_TUESDAY },
  },
];

function primaryDate(year: number): { date: IsoDate; citation: Citation } {
  const rule = selectVersion(PRIMARY_DATES, `${String(year)}-01-01`);
  return { date: rule.date(year), citation: rule.citation };
}

// ---------------------------------------------------------------------------------------------
// Which years an office is elected (the Department of Elections' schedule of general elections).

/** Offices with a statewide cycle, by office type: elected in years `y` with `y % every === at`. */
const STATE_CYCLES: Readonly<Record<string, { readonly every: number; readonly at: number }>> = {
  governor: { every: 4, at: 1 },
  'statewide-executive-other': { every: 4, at: 1 },
  'attorney-general': { every: 4, at: 1 },
  'state-senate': { every: 4, at: 3 },
  'state-house': { every: 2, at: 1 },
  'us-house': { every: 2, at: 0 },
  'us-senate': { every: 2, at: 0 },
  'soil-water-conservation-board': { every: 4, at: 3 },
};

/** Constitutional officers on four-year terms: counties elect them in one cycle, cities in the other. */
const CONSTITUTIONAL_FOUR_YEAR: ReadonlySet<string> = new Set([
  'sheriff',
  'district-attorney',
  'county-treasurer',
  'county-assessor',
]);

// ---------------------------------------------------------------------------------------------
// By-district offices, by template key (D-894). A `by_district` office carries no stagger group, so
// its election years come from the Department of Elections' schedules of local elections, keyed by
// the template entry that makes the office. Each schedule is a table: one row per district, one
// column per year. The text layer runs each row's cells together; the column a cell sits in (by its
// position on the page) gives the year. Every seat in these rows has a four-year term, so each key
// is elected every fourth year, and the years before the schedule's first column follow the same
// cycle. A key not in the table keeps the office type's years.

const CALENDARS = `${ELECT}/media/boardpapers/calendar`;
const CITY_COUNCIL_SCHEDULE = `${CALENDARS}/CityCncl26-31-November.pdf`;
const COUNTY_BOARD_SCHEDULE = `${CALENDARS}/2027_2031CountyBOS.pdf`;
const COUNTY_SCHOOL_SCHEDULE = `${CALENDARS}/2027_2031CountySchoolBoard.pdf`;
const CITY_SCHOOL_SCHEDULE = `${CALENDARS}/CITY-SCHOOL-BOARD-ELECTIONS.pdf`;

const CITY_COUNCIL_EVEN =
  'Department of Elections, City Council Elections, November Even-Numbered Years';
const CITY_SCHOOL_EVEN =
  'Department of Elections, City School Board Elections, November Even-Numbered Years';

/** Virginia Beach: Districts 1, 3, 5 and 7 in the 2028 column; 2, 4, 6, 8, 9 and 10 in 2026 and 2030. */
const VIRGINIA_BEACH_COUNCIL = cite(
  CITY_COUNCIL_EVEN,
  CITY_COUNCIL_SCHEDULE,
  'Virginia Beach Mayor 4 District 1 1 4 District 2 1 4 1 4 District 3 1 4 District 4 1 4 1 4 District 5 1 4 District 6 1 4 1 4 District 7 1 4 District 8 1 4 1 4 District 9 1 4 1 4 District 10 1 4 1 4',
  '2026-01-20',
);
/** Richmond: Districts 1 to 9 in the 2028 column. */
const RICHMOND_COUNCIL = cite(
  CITY_COUNCIL_EVEN,
  CITY_COUNCIL_SCHEDULE,
  'Richmond Mayor 4 District 1 1 4 District 2 1 4 District 3 1 4 District 4 1 4 District 5 1 4 District 6 1 4 District 7 1 4 District 8 1 4 District 9 1 4',
  '2026-01-20',
);
/** Norfolk: Wards 1 to 5 in the 2026 and 2030 columns; Superwards 6 and 7 in 2028. */
const NORFOLK_COUNCIL = cite(
  CITY_COUNCIL_EVEN,
  CITY_COUNCIL_SCHEDULE,
  'Norfolk Mayor 4 Ward 1 1 4 1 4 Ward 2 1 4 1 4 Ward 3 1 4 1 4 Ward 4 1 4 1 4 Ward 5 1 4 1 4 Superward 6 1 4 Superward 7 1 4',
  '2026-01-20',
);
/** Virginia Beach: the at-large seat and Districts 1, 3, 5 and 7 in 2028; the others in 2026 and 2030. */
const VIRGINIA_BEACH_SCHOOL = cite(
  CITY_SCHOOL_EVEN,
  CITY_SCHOOL_SCHEDULE,
  'Virginia Beach At Large 1 4 District 1 1 4 District 2 1 4 1 4 District 3 1 4 District 4 1 4 1 4 District 5 1 4 District 6 1 4 1 4 District 7 1 4 District 8 1 4 1 4 District 9 1 4 1 4 District 10 1 4 1 4',
  '2026-01-20',
);
/** Richmond: Districts 1 to 9 in the 2028 column. */
const RICHMOND_SCHOOL = cite(
  CITY_SCHOOL_EVEN,
  CITY_SCHOOL_SCHEDULE,
  'Richmond District 1 1 4 District 2 1 4 District 3 1 4 District 4 1 4 District 5 1 4 District 6 1 4 District 7 1 4 District 8 1 4 District 9 1 4',
  '2026-01-20',
);
/** Norfolk: Wards 1 to 5 in the 2026 and 2030 columns; Superwards 6 and 7 in 2028. */
const NORFOLK_SCHOOL = cite(
  CITY_SCHOOL_EVEN,
  CITY_SCHOOL_SCHEDULE,
  'Norfolk Ward 1 1 4 1 4 Ward 2 1 4 1 4 Ward 3 1 4 1 4 Ward 4 1 4 1 4 Ward 5 1 4 1 4 Superward 6 1 4 Superward 7 1 4',
  '2026-01-20',
);
/** Henrico: each of the five magisterial districts in the 2027 and 2031 columns. */
const HENRICO_SUPERVISORS = cite(
  'Department of Elections, County Board of Supervisors (2027, 2029, 2031)',
  COUNTY_BOARD_SCHEDULE,
  'Henrico Brookland 1 1 Fairfield 1 1 Three Chopt 1 1 Tuckahoe 1 1 Varina 1 1',
  '2026-04-20',
);
/** Henrico: each of the five magisterial districts in the 2027 and 2031 columns. */
const HENRICO_SCHOOL = cite(
  'Department of Elections, County School Board (2027, 2029, 2031)',
  COUNTY_SCHOOL_SCHEDULE,
  'Henrico Brookland 1 1 Fairfield 1 1 Three Chopt 1 1 Tuckahoe 1 1 Varina 1 1',
  '2026-01-21',
);

/** Elected in the years `first + k × every`, k any integer: `first` is the schedule's first column. */
type KeyCycle = { readonly first: number; readonly every: number; readonly citation: Citation };

function keyCycles(
  keys: readonly string[],
  first: number,
  citation: Citation,
): readonly (readonly [string, KeyCycle])[] {
  return keys.map((key) => [key, { first, every: 4, citation }] as const);
}

const HENRICO_DISTRICTS = ['brookland', 'fairfield', 'three-chopt', 'tuckahoe', 'varina'];
const VIRGINIA_BEACH_ODD = [1, 3, 5, 7].map(String);
const VIRGINIA_BEACH_EVEN = [2, 4, 6, 8, 9, 10].map(String);
const prefixed = (prefix: string, names: readonly string[]): string[] =>
  names.map((name) => `${prefix}-${name}`);

/** Template key to election years. */
const KEY_CYCLES: ReadonlyMap<string, KeyCycle> = new Map([
  ...keyCycles(
    prefixed('virginia-beach-city-council-district', VIRGINIA_BEACH_ODD),
    2028,
    VIRGINIA_BEACH_COUNCIL,
  ),
  ...keyCycles(
    prefixed('virginia-beach-city-council-district', VIRGINIA_BEACH_EVEN),
    2026,
    VIRGINIA_BEACH_COUNCIL,
  ),
  ...keyCycles(['richmond-city-council'], 2028, RICHMOND_COUNCIL),
  ...keyCycles(['norfolk-city-council-ward'], 2026, NORFOLK_COUNCIL),
  ...keyCycles(
    ['norfolk-city-council-superward-6', 'norfolk-city-council-superward-7'],
    2028,
    NORFOLK_COUNCIL,
  ),
  ...keyCycles(
    prefixed('virginia-beach-school-board-district', VIRGINIA_BEACH_ODD),
    2028,
    VIRGINIA_BEACH_SCHOOL,
  ),
  ...keyCycles(
    prefixed('virginia-beach-school-board-district', VIRGINIA_BEACH_EVEN),
    2026,
    VIRGINIA_BEACH_SCHOOL,
  ),
  ...keyCycles(['richmond-school-board'], 2028, RICHMOND_SCHOOL),
  ...keyCycles(['norfolk-school-board-ward'], 2026, NORFOLK_SCHOOL),
  ...keyCycles(
    ['norfolk-school-board-superward-6', 'norfolk-school-board-superward-7'],
    2028,
    NORFOLK_SCHOOL,
  ),
  ...keyCycles(
    prefixed('henrico-board-of-supervisors', HENRICO_DISTRICTS),
    2027,
    HENRICO_SUPERVISORS,
  ),
  ...keyCycles(prefixed('henrico-school-board', HENRICO_DISTRICTS), 2027, HENRICO_SCHOOL),
]);

/** The office types the table keys; no other office reads the key. */
const KEYED_TYPES: ReadonlySet<string> = new Set([
  'city-council',
  'school-board',
  'county-commission',
]);

/** The cycle of the office's template key when `year` is one of its election years, else null. */
function keyCycleIn(office: OfficeRef, year: number): KeyCycle | null {
  const cycle = KEYED_TYPES.has(office.officeTypeId)
    ? KEY_CYCLES.get(office.templateKey)
    : undefined;
  return cycle !== undefined && mod(year - cycle.first, cycle.every) === 0 ? cycle : null;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Whether the office is elected in `year`; an office whose years each locality sets is asked every year. */
function electedIn(office: OfficeRef, year: number): boolean {
  if (KEYED_TYPES.has(office.officeTypeId) && KEY_CYCLES.has(office.templateKey)) {
    return keyCycleIn(office, year) !== null;
  }
  const cycle = STATE_CYCLES[office.officeTypeId];
  if (cycle !== undefined) {
    return year % cycle.every === cycle.at;
  }
  if (CONSTITUTIONAL_FOUR_YEAR.has(office.officeTypeId)) {
    if (office.jurisdictionKind === 'county') {
      return year % 4 === 3;
    }
    if (office.jurisdictionKind === 'city') {
      return year % 4 === 1;
    }
  }
  return true;
}

function assertServed(year: number): void {
  if (!Number.isInteger(year) || year < FIRST_SERVED_YEAR || year > LAST_SERVED_YEAR) {
    throw new RangeError(`va: no rules for ${String(year)}`);
  }
}

/** The November general; a keyed office's general cites the schedule that puts it in this year. */
function generalContest(office: OfficeRef, year: number): ContestOut {
  return {
    date: novemberElectionDay(year),
    kind: 'general',
    party: null,
    dateCitation: keyCycleIn(office, year)?.citation ?? ELECTION_DAY,
    electsOutright: false,
  };
}

function contests(office: OfficeRef, year: number): readonly ContestOut[] {
  assertServed(year);
  switch (office.schedule) {
    case NOVEMBER_GENERAL:
      return electedIn(office, year) ? [generalContest(office, year)] : [];
    case JUNE_PRIMARY: {
      if (!electedIn(office, year)) {
        return [];
      }
      const general = generalContest(office, year);
      if (office.partisan !== true) {
        return [general];
      }
      const primary = primaryDate(year);
      return [
        ...PRIMARY_PARTIES.map((party): ContestOut => ({
          date: primary.date,
          kind: 'primary',
          party,
          dateCitation: primary.citation,
          electsOutright: false,
        })),
        general,
      ];
    }
    case MAY_GENERAL:
      // § 15.2-1400 E: from 2022 every local election is held at the November general election.
      return [];
    case NO_PUBLIC_ELECTION:
      return [];
    default:
      throw new RangeError(`va: unknown schedule ${office.schedule}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Filing deadlines. The statute pages themselves refused the fetcher, so the deadlines are cited
// to the Department of Elections' bulletins, which state each cycle's dates and hours.

type CycleSources = {
  readonly opens: Citation; // noon of the 92nd day before the primary
  readonly closes: Citation; // 5:00 p.m. of the 75th day before the primary
  readonly independentHour: Citation; // 7:00 p.m. on the third Tuesday in June
};

function bulletin(
  url: string,
  year: number,
  opens: string,
  closes: string,
  independent: string,
): CycleSources {
  const from = `${String(year)}-01-01`;
  const to = `${String(year)}-12-31`;
  return {
    opens: cite('Va. Code § 24.2-522', url, opens, from, to),
    closes: cite('Va. Code § 24.2-522', url, closes, from, to),
    independentHour: cite('Va. Code § 24.2-507', url, independent, from, to),
  };
}

const CYCLE_2025 = {
  opens: 'Monday, March 17, 2025, Noon (12:00 p.m.)',
  closes: 'Primary Tuesday, June 17, 2025 Thursday, April 3, 2025, 5:00 p.m.',
  independent: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
};

/** The published cycles, then the rule as last applied in a regular cycle for the years after. */
const CYCLE_SOURCES: readonly Versioned<CycleSources>[] = [
  {
    validFrom: '2022-01-01',
    validTo: '2022-12-31',
    rule: bulletin(
      LOCAL_2022,
      2022,
      'Monday March 21, 2022 at 12 p.m.',
      'Primary Tuesday, June 21, 2022 Thursday April 7, 2022 5:00 p.m.',
      'General Tuesday, November 8, 2022 Tuesday June 21, 2022 7:00 p.m.',
    ),
  },
  {
    validFrom: '2023-01-01',
    validTo: '2023-12-31',
    rule: bulletin(
      LOCAL_2023,
      2023,
      'File starting March 20, 2023 at 12 pm.',
      'Primary Tuesday, June 20, 2023 Thursday, April 6, 2023 at 5:00 p.m.',
      'General Tuesday, November 7, 2023 Tuesday, June 20, 2023 at 7:00 p.m.',
    ),
  },
  {
    validFrom: '2024-01-01',
    validTo: '2024-12-31',
    rule: bulletin(
      LOCAL_2024,
      2024,
      'File starting March 18, 2024 at 12 pm.',
      'Primary Tuesday, June 18, 2024 Thursday, April 4, 2024 at 5:00 pm',
      'General Tuesday, November 5, 2024 Tuesday, June 18, 2024 at 7:00 pm',
    ),
  },
  {
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    rule: bulletin(LOCAL_2025, 2025, CYCLE_2025.opens, CYCLE_2025.closes, CYCLE_2025.independent),
  },
  {
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    rule: bulletin(
      LOCAL_2026,
      2026,
      'Monday, March 16, 2026, Noon (12:00 pm)',
      'Primary Tuesday, August 4, 2026 Thursday, April 2, 2026, 5:00 pm',
      'General Tuesday, November 3, 2026 Tuesday, June 16, 2026, 7:00 pm',
    ),
  },
  {
    validFrom: '2027-01-01',
    validTo: null,
    rule: {
      opens: cite('Va. Code § 24.2-522', LOCAL_2025, CYCLE_2025.opens, '2023-03-20'),
      closes: cite('Va. Code § 24.2-522', LOCAL_2025, CYCLE_2025.closes, '2023-03-20'),
      independentHour: cite(
        'Va. Code § 24.2-507',
        LOCAL_2025,
        CYCLE_2025.independent,
        '2023-03-20',
      ),
    },
  },
];

/** § 24.2-507 as amended by 2021 Sp. Sess. I c. 239, in force from 2022. */
const INDEPENDENT_DEADLINE = cite(
  'Va. Code § 24.2-507',
  CHANGES_2021,
  'This bill also changes the deadline for filing nomination and candidacy papers for an office determined by a November general election from the 2nd Tuesday to the 3rd Tuesday in June.',
  '2022-01-01',
);

/**
 * How a deadline that falls on a holiday moves: the Department of Elections points to § 1-210(C),
 * the next day that is not a Saturday, Sunday or legal holiday (D-889).
 */
const DEADLINE_ON_HOLIDAY = cite(
  'Va. Code § 1-210(C)',
  HANDBOOK_2026,
  'Q: What happens when a major election deadline falls on a state holiday? A: Outside of §24.2, ELECT may reference §1-210 Computation of time in Virginia subparagraph C to provide localities with direction. C states that "when an act of the General Assembly specifies a maximum period of time in which a legal action may be brought and the last day or part of a day on which the clerk\'s office is closed as authorized by an act of the General Assembly, the act may be performed on the next day that is not a Saturday, Sunday, legal holiday, or day or part of a day on which the clerk\'s office is closed as authorized by an act of the General Assembly."',
  '2022-01-01', // the § 24.2-507 deadline it moves applies from 2022
);

/** HB 29 (2026) set the 2026 deadlines of United States House candidates apart from every other office. */
const US_HOUSE_2026_DEADLINES = cite(
  'HB 29 (2026)',
  PRIMARY_MOVED_2026,
  'Candidate filing deadlines for U.S. House of Representative candidates have moved to May 26 (deadline extended due to holiday) for party candidates and August 4 for independent candidates.',
  '2026-02-20',
  '2026-12-31',
);
const US_HOUSE_2026_OPENS = cite(
  'HB 29 (2026)',
  US_HOUSE_2026,
  'Friday, May 1, 2026, Noon (12:00 pm) Tuesday, May 26, 2026',
  '2026-02-20',
  '2026-12-31',
);
const US_HOUSE_2026_CLOSES = cite(
  'HB 29 (2026)',
  US_HOUSE_2026,
  'Primary Tuesday, August 4, 2026 Tuesday, May 26, 2026, 5:00 pm',
  '2026-02-20',
  '2026-12-31',
);
const US_HOUSE_2026_INDEPENDENT = cite(
  'HB 29 (2026)',
  US_HOUSE_2026,
  'General Tuesday, November 3, 2026 Tuesday, August 4, 2026, 7:00 pm',
  '2026-02-20',
  '2026-12-31',
);

/** A filing rule a session law set for one office type and one cycle, in place of the statute's. */
type SessionLawWindow = {
  readonly opensOn: Computed<IsoDate>;
  /** The closing day the law gives, before a weekend or holiday moves it to the next business day. */
  readonly closesUnrolled: IsoDate;
  readonly closesCitation: Citation;
  readonly closesTime: Citation;
  readonly independentDay: Computed<IsoDate>;
  readonly independentTime: Citation;
};

const SESSION_LAW_WINDOWS: readonly Versioned<
  Readonly<Partial<Record<string, SessionLawWindow>>>
>[] = [
  {
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    rule: {
      'us-house': {
        opensOn: computed('2026-05-01', US_HOUSE_2026_OPENS),
        closesUnrolled: '2026-05-25',
        closesCitation: US_HOUSE_2026_DEADLINES,
        closesTime: US_HOUSE_2026_CLOSES,
        independentDay: computed('2026-08-04', US_HOUSE_2026_DEADLINES),
        independentTime: US_HOUSE_2026_INDEPENDENT,
      },
    },
  },
];

function sessionLawWindow(office: OfficeRef, contestDate: IsoDate): SessionLawWindow | null {
  const version = SESSION_LAW_WINDOWS.find(
    (v) => v.validFrom <= contestDate && (v.validTo === null || contestDate <= v.validTo),
  );
  return version?.rule[office.officeTypeId] ?? null;
}

const PRIMARY_CLOSES_AT: LocalTime = '17:00';
const INDEPENDENT_CLOSES_AT: LocalTime = '19:00';

/** Noon of the 92nd day opens the window; `TrackOut` has no opening hour, so the noon is not carried. */
const OPENS_DAYS_BEFORE = 92;
const CLOSES_DAYS_BEFORE = 75;

function yearOf(d: IsoDate): number {
  return Number(d.slice(0, 4));
}

function emptyTrack(): Omit<TrackOut, 'track' | 'opensOn' | 'closesOn' | 'closesTime'> {
  return {
    petitionOpens: null,
    petitionDue: null,
    fee: null,
    signatures: null,
    alternatives: [],
    whereToFile: null,
    withdrawalDeadline: null,
  };
}

function primaryTrack(office: OfficeRef, contest: ContestRef): TrackOut {
  const year = yearOf(contest.date);
  const special = sessionLawWindow(office, contest.date);
  if (special !== null) {
    return {
      track: 'party_primary',
      opensOn: special.opensOn,
      closesOn: computed(
        roll(special.closesUnrolled, 'next_business_day', vaHolidays(year)),
        special.closesCitation,
      ),
      closesTime: computed(PRIMARY_CLOSES_AT, special.closesTime),
      ...emptyTrack(),
    };
  }
  const sources = selectVersion(CYCLE_SOURCES, contest.date);
  // The window counts from the June date § 24.2-515 sets: the primary itself, except in 2026,
  // when HB 29 moved the primary to August and left every other office's window where it was.
  const anchor = thirdTuesdayInJune(year);
  return {
    track: 'party_primary',
    opensOn: computed(daysBefore(anchor, OPENS_DAYS_BEFORE), sources.opens),
    closesOn: computed(daysBefore(anchor, CLOSES_DAYS_BEFORE), sources.closes),
    closesTime: computed(PRIMARY_CLOSES_AT, sources.closes),
    ...emptyTrack(),
  };
}

/** The filer who seeks no party's primary: an independent, or any candidate for a nonpartisan office. */
function generalFilerTrack(
  office: OfficeRef,
  contest: ContestRef,
  track: 'independent' | 'nonpartisan',
): TrackOut {
  const year = yearOf(contest.date);
  const special = sessionLawWindow(office, contest.date);
  if (special !== null) {
    return {
      track,
      opensOn: null,
      closesOn: special.independentDay,
      closesTime: computed(INDEPENDENT_CLOSES_AT, special.independentTime),
      ...emptyTrack(),
    };
  }
  const sources = selectVersion(CYCLE_SOURCES, contest.date);
  const unrolled = thirdTuesdayInJune(year);
  const closes = roll(unrolled, 'next_business_day', vaHolidays(year));
  return {
    track,
    opensOn: null,
    closesOn: computed(closes, closes === unrolled ? INDEPENDENT_DEADLINE : DEADLINE_ON_HOLIDAY),
    closesTime: computed(INDEPENDENT_CLOSES_AT, sources.independentHour),
    ...emptyTrack(),
  };
}

function filingTracks(office: OfficeRef, contest: ContestRef): readonly TrackOut[] {
  switch (office.trackSet) {
    case PARTISAN:
      if (contest.kind === 'primary' && contest.party !== null) {
        return [primaryTrack(office, contest)];
      }
      if (contest.kind === 'general') {
        return [generalFilerTrack(office, contest, 'independent')];
      }
      return [];
    case NONPARTISAN:
      return contest.kind === 'general' ? [generalFilerTrack(office, contest, 'nonpartisan')] : [];
    case MAY:
      // No May general election is held from 2022 (§ 15.2-1400 E), so no May deadline applies.
      return [];
    default:
      throw new RangeError(`va: unknown track set ${office.trackSet}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Certification.

/** The offices whose November results the State Board ascertains (Va. Code § 24.2-679). */
const STATE_BOARD_OFFICES: ReadonlySet<string> = new Set([
  'us-senate',
  'us-house',
  'governor',
  'statewide-executive-other',
  'attorney-general',
  'state-senate',
  'state-house',
]);

const STATE_BOARD_DECEMBER: readonly Versioned<Citation>[] = [
  {
    validFrom: '2022-07-01',
    validTo: null,
    rule: cite(
      'Va. Code § 24.2-679',
      CHANGES_2022,
      'The bills also extend the certification of the November election by the State Board from the third Monday in November to the first Monday in December.',
      '2022-07-01',
    ),
  },
];

const LOCAL_CANVASS: readonly Versioned<{ readonly days: number; readonly citation: Citation }>[] =
  [
    {
      validFrom: '2022-07-01',
      validTo: '2024-06-30',
      rule: {
        days: 7,
        citation: cite(
          'Va. Code § 24.2-671',
          CANVASS_2022,
          'The board may adjourn to another room of sufficient size in a public building to ascertain the results, and may adjourn as needed, not to exceed seven calendar days from the date of the election',
          '2022-07-01',
          '2024-06-30',
        ),
      },
    },
    {
      validFrom: '2024-07-01',
      validTo: null,
      rule: {
        days: 10,
        citation: cite(
          'Va. Code § 24.2-671',
          CHANGES_2024,
          'This bill extends the deadline for local electoral boards to meet after a general election for the purpose of certifying the election results and submitting the abstract of results to the State Board of Elections from 7 days after the date of the general election to 10 days after such date.',
          '2024-07-01',
        ),
      },
    },
  ];

function certificationDate(office: OfficeRef, contest: ContestRef): Computed<IsoDate> | null {
  if (contest.kind !== 'general') {
    // A primary's canvass (§ 24.2-532) is not served: its text refused the fetcher.
    return null;
  }
  if (STATE_BOARD_OFFICES.has(office.officeTypeId)) {
    return computed(
      nthWeekdayOfMonth(yearOf(contest.date), 12, MONDAY, 1),
      selectVersion(STATE_BOARD_DECEMBER, contest.date),
    );
  }
  const canvass = selectVersion(LOCAL_CANVASS, contest.date);
  return computed(addDays(contest.date, canvass.days), canvass.citation);
}

// ---------------------------------------------------------------------------------------------
// Legal holidays (Va. Code § 2.2-3300).

type HolidayRule = {
  readonly name: string;
  readonly date: (year: number) => IsoDate;
  readonly quote: string;
};

function fixed(month: number, day: number): (year: number) => IsoDate {
  return (year) =>
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The list as 2020 c. 417 left it (Lee-Jackson Day removed, Election Day added), in force from July 1, 2020. */
const LIST_2020: readonly HolidayRule[] = [
  {
    name: 'New Year’s Day',
    date: fixed(1, 1),
    quote:
      "In each year, the following days are designated as legal holidays: January 1 -- New Year's Day.",
  },
  {
    name: 'Martin Luther King, Jr., Day',
    date: (y) => nthWeekdayOfMonth(y, 1, MONDAY, 3),
    quote:
      'The third Monday in January -- Martin Luther King, Jr., Day to honor Martin Luther King, Jr., (1929-1968), defender of causes.',
  },
  {
    name: 'George Washington Day',
    date: (y) => nthWeekdayOfMonth(y, 2, MONDAY, 3),
    quote:
      'The third Monday in February -- George Washington Day to honor George Washington (1732-1799), the first President of the United States.',
  },
];

/** The list as 2020 Sp. Sess. I c. 4 left it (Juneteenth added), in force from March 1, 2021. */
const LIST_2021: readonly HolidayRule[] = [
  {
    name: 'New Year’s Day',
    date: fixed(1, 1),
    quote:
      "In each year, the following days are designated as legal holidays: January 1 — New Year's Day.",
  },
  {
    name: 'Martin Luther King, Jr., Day',
    date: (y) => nthWeekdayOfMonth(y, 1, MONDAY, 3),
    quote:
      'The third Monday in January — Martin Luther King, Jr., Day to honor Martin Luther King, Jr., (1929-1968), defender of causes.',
  },
  {
    name: 'George Washington Day',
    date: (y) => nthWeekdayOfMonth(y, 2, MONDAY, 3),
    quote:
      'The third Monday in February — George Washington Day to honor George Washington (1732-1799), the first President of the United States.',
  },
  {
    name: 'Memorial Day',
    date: (y) => nthWeekdayOfMonth(y, 5, MONDAY, -1),
    quote:
      'The last Monday in May — Memorial Day to honor all persons who made the supreme sacrifice in giving their lives in defense of Virginia and the United States',
  },
  {
    name: 'Juneteenth',
    date: fixed(6, 19),
    quote:
      'June 19 — Juneteenth to commemorate the announcement of the abolition of slavery in Texas',
  },
  {
    name: 'Independence Day',
    date: fixed(7, 4),
    quote: 'July 4 — Independence Day to honor the signing of the Declaration of Independence.',
  },
  {
    name: 'Labor Day',
    date: (y) => nthWeekdayOfMonth(y, 9, MONDAY, 1),
    quote: 'The first Monday in September — Labor Day to honor all people who work in Virginia.',
  },
  {
    name: 'Columbus Day and Yorktown Victory Day',
    date: (y) => nthWeekdayOfMonth(y, 10, MONDAY, 2),
    quote:
      'The second Monday in October — Columbus Day and Yorktown Victory Day to honor Christopher Columbus (1451-1506), a discoverer of the Americas',
  },
  {
    name: 'Election Day',
    date: novemberElectionDay,
    quote:
      'The Tuesday following the first Monday in November — Election Day for the right of citizens of a free society to exercise the right to vote.',
  },
  {
    name: 'Veterans Day',
    date: fixed(11, 11),
    quote:
      'November 11 — Veterans Day to honor all persons who served in the Armed Forces of Virginia and the United States',
  },
  {
    name: 'Thanksgiving Day',
    date: (y) => nthWeekdayOfMonth(y, 11, THURSDAY, 4),
    quote:
      "The fourth Thursday in November and the Friday next following — Thanksgiving Day to honor and give thanks in each person's own manner for the blessings bestowed upon the people of Virginia",
  },
  {
    name: 'Thanksgiving Day (the Friday next following)',
    date: (y) => addDays(nthWeekdayOfMonth(y, 11, THURSDAY, 4), 1),
    quote:
      "The fourth Thursday in November and the Friday next following — Thanksgiving Day to honor and give thanks in each person's own manner for the blessings bestowed upon the people of Virginia",
  },
  {
    name: 'Christmas Day',
    date: fixed(12, 25),
    quote: 'December 25 — Christmas Day.',
  },
];

/** The 2020 list's later days are those of the 2021 list less Juneteenth; their text is unchanged. */
const LIST_2020_FULL: readonly HolidayRule[] = [
  ...LIST_2020,
  ...LIST_2021.slice(3)
    .filter((rule) => rule.name !== 'Juneteenth')
    .map((rule) => ({ ...rule, quote: rule.quote.replace(' — ', ' -- ') })),
];

type HolidayList = { readonly rules: readonly HolidayRule[]; readonly sourceUrl: string };

const HOLIDAY_LISTS: readonly Versioned<HolidayList>[] = [
  {
    validFrom: '2020-07-01',
    validTo: '2021-02-28',
    rule: { rules: LIST_2020_FULL, sourceUrl: HOLIDAYS_2020 },
  },
  { validFrom: '2021-03-01', validTo: null, rule: { rules: LIST_2021, sourceUrl: HOLIDAYS_2021 } },
];

const WEEKEND_QUOTE =
  'Whenever any of such days falls on Saturday, the Friday next preceding such day, or whenever any of such days falls on Sunday, the Monday next following such day';

const FIRST_HOLIDAY_YEAR = 2021;
const LAST_HOLIDAY_YEAR = 2100;

function listOn(date: IsoDate): Versioned<HolidayList> | null {
  return (
    HOLIDAY_LISTS.find(
      (list) => list.validFrom <= date && (list.validTo === null || date <= list.validTo),
    ) ?? null
  );
}

/**
 * The legal holidays whose date falls in `year`: each day of the list in force on that day, and the
 * Friday before or the Monday after one that falls on a weekend, as the statute's last paragraph
 * provides (so New Year's Day of the next year can fall in this year's list).
 */
function vaHolidays(year: number): HolidayCalendar {
  if (!Number.isInteger(year) || year < FIRST_HOLIDAY_YEAR || year > LAST_HOLIDAY_YEAR) {
    throw new RangeError(`va: no holiday list for ${String(year)}`);
  }
  const prefix = `${String(year)}-`;
  const holidays: Holiday[] = [];
  for (const y of [year, year + 1]) {
    if (y > LAST_HOLIDAY_YEAR) {
      continue;
    }
    for (const candidate of LIST_2021) {
      const date = candidate.date(y);
      const list = listOn(date);
      const rule = list?.rule.rules.find((r) => r.name === candidate.name);
      if (list === null || rule === undefined) {
        continue;
      }
      const citation = cite(
        'Va. Code § 2.2-3300',
        list.rule.sourceUrl,
        rule.quote,
        list.validFrom,
        list.validTo,
      );
      if (date.startsWith(prefix)) {
        holidays.push({ date, name: rule.name, citation });
      }
      const weekday = weekdayOf(date);
      const moved =
        weekday === SATURDAY ? daysBefore(date, 1) : weekday === SUNDAY ? addDays(date, 1) : null;
      if (moved !== null && moved.startsWith(prefix)) {
        holidays.push({
          date: moved,
          name: `${rule.name} (observed)`,
          citation: cite(
            'Va. Code § 2.2-3300',
            list.rule.sourceUrl,
            WEEKEND_QUOTE,
            list.validFrom,
            list.validTo,
          ),
        });
      }
    }
  }
  holidays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { state: STATE, year, holidays };
}

// ---------------------------------------------------------------------------------------------

export const vaRules: StateRules = {
  state: STATE,
  schedules: [NOVEMBER_GENERAL, JUNE_PRIMARY, MAY_GENERAL, NO_PUBLIC_ELECTION],
  trackSets: [PARTISAN, NONPARTISAN, MAY],
  holidays: vaHolidays,
  contests: ({ office, year }) => contests(office, year),
  filingTracks: ({ office, contest }) => filingTracks(office, contest),
  certificationDate: ({ office, contest }) => certificationDate(office, contest),
  // Constitutional officers' salaries are set by the Commonwealth's schedules by population; the
  // amounts were not retrieved, so every pay reads "not known yet" (D-317).
  countyPay: () => null,
};
