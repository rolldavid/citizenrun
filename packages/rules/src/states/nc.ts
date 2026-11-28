// North Carolina deadline rules (PIPE-rules-api, D-330): the General Statutes' election dates,
// filing periods, second primaries and canvass days, with the legal public holidays of G.S. 103-4
// and the next-open-day rule of G.S. 103-5. Only the helpers of ../dates.ts and the tables below.
import {
  addDays,
  daysBefore,
  easterSunday,
  firstWeekdayAfter,
  fromDayNumber,
  FRIDAY,
  isBusinessDay,
  MONDAY,
  novemberElectionDay,
  nthWeekdayOfMonth,
  roll,
  SUNDAY,
  THURSDAY,
  TUESDAY,
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
  SignatureRule,
  StateRules,
  TrackOut,
} from '../types.ts';

const STATE = 'NC';

const GS = 'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection';
const GS_163_1 = `${GS}/Chapter_163/GS_163-1.html`;
const GS_163_106_2 = `${GS}/Chapter_163/GS_163-106.2.html`;
const GS_163_106_4 = `${GS}/Chapter_163/GS_163-106.4.html`;
const GS_163_107 = `${GS}/Chapter_163/GS_163-107.html`;
const GS_163_107_1 = `${GS}/Chapter_163/GS_163-107.1.html`;
const GS_163_111 = `${GS}/Chapter_163/GS_163-111.html`;
const GS_163_122 = `${GS}/Chapter_163/GS_163-122.html`;
const GS_163_182_5 = `${GS}/Chapter_163/GS_163-182.5.html`;
const GS_163_279 = `${GS}/Chapter_163/GS_163-279.html`;
const GS_163_291 = `${GS}/Chapter_163/GS_163-291.html`;
const GS_163_293 = `${GS}/Chapter_163/GS_163-293.html`;
const GS_163_294_2 = `${GS}/Chapter_163/GS_163-294.2.html`;
const GS_103_4 = `${GS}/Chapter_103/GS_103-4.html`;
const GS_103_5 = `${GS}/Chapter_103/GS_103-5.html`;
const GS_115C_37 = `${GS}/Chapter_115C/GS_115C-37.html`;
const GS_139_6 = `${GS}/Chapter_139/GS_139-6.html`;
const OSHR_HOLIDAYS = 'https://oshr.nc.gov/state-employee-resources/benefits/leave/holidays';

// The official pages state no effective date for these texts; each validFrom is the opening day of
// the earliest published filing period the fixtures reproduce under the text (PIPE-rules-api).
const FROM_2020_CYCLE = '2019-12-02';
const FROM_2023_MUNICIPAL = '2023-07-07';
const FROM_2022_SOIL_WATER = '2022-06-13';

function cite(citation: string, sourceUrl: string, quote: string, validFrom: IsoDate): Citation {
  return { citation, sourceUrl, quote, validFrom, validTo: null };
}

// --- election dates ---

const PRIMARY_DATE = cite(
  'N.C.G.S. § 163-1(b)',
  GS_163_1,
  '(b) On Tuesday next after the first Monday in March preceding each general election to be held in November for the officers referred to in subsection (a) of this section, there shall be held in all election precincts within the territory for which the officers are to be elected a primary election for the purpose of nominating candidates for each political party in the State for those offices.',
  FROM_2020_CYCLE,
);
const GENERAL_BIENNIAL = cite(
  'N.C.G.S. § 163-1(a)',
  GS_163_1,
  'State Senator Senatorial Tuesday next after the Two years district first Monday in November 1968 and every two years thereafter',
  FROM_2020_CYCLE,
);
const GENERAL_QUADRENNIAL = cite(
  'N.C.G.S. § 163-1(a)',
  GS_163_1,
  'Governor State Tuesday next after the Four years, from first Monday in November first day of January 1968 and every four years next after election thereafter',
  FROM_2020_CYCLE,
);
// The 10-week rule is the text the Board's 2024 guide applies from S.L. 2023-140, in force from
// 2024-01-01 as that guide states; no second primary is generated for an earlier primary.
const SECOND_PRIMARY_DATE = cite(
  'N.C.G.S. § 163-111(e)',
  GS_163_111,
  '(e) Date of Second Primary; Procedures. - If a second primary is required under the provisions of this section, the appropriate board of elections, State or county, shall order that it be held 10 weeks after the first primary.',
  '2024-01-01',
);
const SECOND_PRIMARY_WEEKS = 10;
const SCHOOL_BOARD_DATE = cite(
  'N.C.G.S. § 115C-37(a)',
  GS_115C_37,
  '(a) Method of Election. - The county boards of education shall be elected on a nonpartisan basis at the time of the primary election in 1970 and biennially thereafter.',
  FROM_2020_CYCLE,
);
const SOIL_WATER_DATE = cite(
  'N.C.G.S. § 139-6',
  GS_139_6,
  'All elections for members of the district board of supervisors shall be held at the same time as the regular election for county officers beginning in November 1974. The election shall be nonpartisan and no primary election shall be held.',
  FROM_2022_SOIL_WATER,
);
const MUNICIPAL_PLURALITY_DATE = cite(
  'N.C.G.S. § 163-279(a)(1)',
  GS_163_279,
  '(1) If the election is nonpartisan and decided by simple plurality, the election shall be held on Tuesday after the first Monday in November.',
  FROM_2023_MUNICIPAL,
);
const MUNICIPAL_PARTISAN_DATE = cite(
  'N.C.G.S. § 163-279(a)(2)',
  GS_163_279,
  '(2) If the election is partisan, the election shall be held on Tuesday after the first Monday in November, the first primary shall be held on the second Tuesday after Labor Day, and the second primary, if required, shall be held on the fourth Tuesday before the election.',
  FROM_2023_MUNICIPAL,
);
const MUNICIPAL_PRIMARY_DATE = cite(
  'N.C.G.S. § 163-279(a)(3)',
  GS_163_279,
  '(3) If the election is nonpartisan and the nonpartisan primary method of election is used, the election shall be held on Tuesday after the first Monday in November and the nonpartisan primary shall be held on the fourth Tuesday before the election.',
  FROM_2023_MUNICIPAL,
);
const MUNICIPAL_RUNOFF_DATE = cite(
  'N.C.G.S. § 163-279(a)(4)',
  GS_163_279,
  '(4) If the election is nonpartisan and the election and runoff election method of election is used, the election shall be held on the fourth Tuesday before the Tuesday after the first Monday in November, and the runoff election, if required, shall be held on Tuesday after the first Monday in November.',
  FROM_2023_MUNICIPAL,
);
const MUNICIPAL_FIRST_YEAR = 1973;

// --- partisan filing (G.S. 163-106.2, 163-106.4, 163-107, 163-107.1) ---

const FILING_STATE_BOARD = cite(
  'N.C.G.S. § 163-106.2(a)',
  GS_163_106_2,
  '(a) Candidates seeking party primary nominations for the following offices shall file their notice of candidacy with the State Board no earlier than 12:00 noon on the first Monday in December and no later than 12:00 noon on the third Friday in December preceding the primary:',
  FROM_2020_CYCLE,
);
const FILING_COUNTY_BOARD = cite(
  'N.C.G.S. § 163-106.2(b)',
  GS_163_106_2,
  '(b) Candidates seeking party primary nominations for the following offices shall file their notice of candidacy with the county board of elections no earlier than 12:00 noon on the first Monday in December and no later than 12:00 noon on the third Friday in December preceding the primary:',
  FROM_2020_CYCLE,
);
const SCHOOL_BOARD_FILING = cite(
  'N.C.G.S. § 115C-37(a); § 163-106.2(b)',
  GS_115C_37,
  'Except as otherwise provided herein, the election shall be conducted according to the provisions of Chapter 163 of the General Statutes then governing primary elections.',
  FROM_2020_CYCLE,
);
const WITHDRAWAL_PRIMARY = cite(
  'N.C.G.S. § 163-106.4',
  GS_163_106_4,
  'Any person who has filed notice of candidacy for an office shall have the right to withdraw it at any time prior to the close of business on the third business day prior to the date on which the right to file for that office expires under the terms of G.S. 163-106.2.',
  FROM_2020_CYCLE,
);
const PRIMARY_FEE = cite(
  'N.C.G.S. § 163-107(a)',
  GS_163_107,
  'The salary of any office that is the basis for calculating the filing fee is the starting salary for the office, rather than the salary received by the incumbent, if different.',
  FROM_2020_CYCLE,
);
const PETITION_IN_LIEU_STATEWIDE = cite(
  'N.C.G.S. § 163-107.1(b)',
  GS_163_107_1,
  '(b) If the candidate is seeking the office of United States Senator, Governor, Lieutenant Governor, any State executive officer, Justice of the Supreme Court, or Judge of the Court of Appeals, the petition must be signed by 10,000 registered voters who are members of the political party in whose primary the candidate desires to run,',
  FROM_2020_CYCLE,
);
const PETITION_IN_LIEU_LOCAL = cite(
  'N.C.G.S. § 163-107.1(c)',
  GS_163_107_1,
  "The petition shall be signed by five percent (5%) of the registered voters of the election area in which the office will be voted for, who are affiliated with the same political party in whose primary the candidate desires to run, or in the alternative, the petition shall be signed by no less than 200 registered voters regardless of said voter's political party affiliation, whichever requirement is greater.",
  FROM_2020_CYCLE,
);

// --- unaffiliated candidates (G.S. 163-122) ---

const UNAFFILIATED_STATEWIDE = cite(
  'N.C.G.S. § 163-122(a)(1)',
  GS_163_122,
  'These petitions must be filed with the State Board of Elections on or before 12:00 noon on the day of the primary election and must be signed by qualified voters of the State equal in number to one and a half percent (1.5%) of the total number of voters who voted in the most recent general election for Governor.',
  FROM_2020_CYCLE,
);
const UNAFFILIATED_DISTRICT = cite(
  'N.C.G.S. § 163-122(a)(2)',
  GS_163_122,
  'For district offices other than General Assembly seats, petitions must be filed with the State Board of Elections on or before 12:00 noon on the day of the primary election and must be signed by qualified voters of the district equal in number to one and a half percent (1.5%) of the total number of registered voters in the district',
  FROM_2020_CYCLE,
);
const UNAFFILIATED_ASSEMBLY = cite(
  'N.C.G.S. § 163-122(a)(2), (3)',
  GS_163_122,
  'For General Assembly seats in which the district lies in more than one county, petitions must be filed with the State Board of Elections on or before 12:00 noon on the day of the primary election and must be signed by qualified voters of the district equal in number to four percent (4%) of the total number of registered voters in the district',
  FROM_2020_CYCLE,
);
const UNAFFILIATED_COUNTY = cite(
  'N.C.G.S. § 163-122(a)(3)',
  GS_163_122,
  'These petitions must be filed with the county board of elections on or before 12:00 noon on the day of the primary election and must be signed by qualified voters of the county equal in number to four percent (4%) of the total number of registered voters in the county',
  FROM_2020_CYCLE,
);
const UNAFFILIATED_JUDGES = cite(
  'N.C.G.S. § 163-122(a)(5)',
  GS_163_122,
  'These petitions must be filed with the State Board of Elections on or before 12:00 noon on the day of the primary election and must be signed by qualified voters of the district equal in number to two percent (2%) of the total number of registered voters in the district',
  FROM_2020_CYCLE,
);
const UNAFFILIATED_FEE = cite(
  'N.C.G.S. § 163-122(e)',
  GS_163_122,
  "(e) Any candidate seeking to have that candidate's name printed on the general election ballot under this section shall pay a filing fee equal to that provided for candidates for the office in G.S. 163-107 or comply with the alternative available to candidates for the office in G.S. 163-107.1.",
  FROM_2020_CYCLE,
);

// --- municipal filing (G.S. 163-294.2, 163-291, 103-5) ---

const MUNICIPAL_FILING = cite(
  'N.C.G.S. § 163-294.2(c)',
  GS_163_294_2,
  '(c) Candidates seeking municipal office shall file their notices of candidacy with the board of elections no earlier than 12:00 noon on the first Friday in July and no later than 12:00 noon on the third Friday in July preceding the election, except:',
  FROM_2023_MUNICIPAL,
);
const MUNICIPAL_PARTY_FILING = cite(
  'N.C.G.S. § 163-291(2)',
  GS_163_291,
  '(2) A candidate seeking party nomination for municipal or district office shall file notice of candidacy with the board of elections no earlier than 12:00 noon on the first Friday in July and no later than 12:00 noon on the third Friday in July preceding the election, except:',
  FROM_2023_MUNICIPAL,
);
const MUNICIPAL_WITHDRAWAL = cite(
  'N.C.G.S. § 163-294.2(d)',
  GS_163_294_2,
  '(d) Any person may withdraw his notice of candidacy at any time prior to the close of business on the third business day prior to the filing deadline prescribed in subsection (c), and shall be entitled to a refund of his filing fee if he does so.',
  FROM_2023_MUNICIPAL,
);
const NEXT_OPEN_DAY = cite(
  'N.C.G.S. § 103-5(a)',
  GS_103_5,
  '(a) Except as otherwise provided by law, when the day or the last day for doing any act required or permitted by law to be performed in a public office or courthouse falls on a Saturday, Sunday, or legal holiday when the public office or courthouse is closed for transactions, the act may be performed on the next day that the public office or courthouse is open for transactions.',
  FROM_2020_CYCLE,
);

// --- soil and water conservation district supervisors (G.S. 139-6) ---

const SOIL_WATER_FILING = cite(
  'N.C.G.S. § 139-6',
  GS_139_6,
  'The notice of candidacy must be filed no earlier than noon on the second Monday in June and no later than noon on the first Friday in July preceding the election.',
  FROM_2022_SOIL_WATER,
);
const SOIL_WATER_FEE = cite(
  'N.C.G.S. § 139-6',
  GS_139_6,
  'The candidate shall pay a filing fee of five dollars ($5.00) at the time of filing the notice of candidacy.',
  FROM_2022_SOIL_WATER,
);
const SOIL_WATER_FILED_WITH = cite(
  'N.C.G.S. § 139-6',
  GS_139_6,
  'Candidates shall file their notice of candidacy on forms prescribed by the county board of elections.',
  FROM_2022_SOIL_WATER,
);

// --- canvass (D-322) ---

const COUNTY_CANVASS = cite(
  'N.C.G.S. § 163-182.5(b)',
  GS_163_182_5,
  '(b) Canvassing by County Board of Elections. - The county board of elections shall meet at 11:00 A.M. on the tenth day after every election to complete the canvass of votes cast and to authenticate the count in every ballot item in the county by determining that the votes have been counted and tabulated correctly.',
  FROM_2020_CYCLE,
);
const STATE_CANVASS = cite(
  'N.C.G.S. § 163-182.5(c)',
  GS_163_182_5,
  '(c) Canvassing by State Board of Elections. - After each general election, the State Board of Elections shall meet at 11:00 A.M. on the Tuesday three weeks after election day to complete the canvass of votes cast in all ballot items within the jurisdiction of the State Board of Elections',
  FROM_2020_CYCLE,
);
const MUNICIPAL_PRIMARY_CANVASS = cite(
  'N.C.G.S. § 163-291(5)',
  GS_163_291,
  '(5) The canvass of the primary and second primary shall be held on the seventh day following the primary or second primary.',
  FROM_2023_MUNICIPAL,
);
const MUNICIPAL_FIRST_ELECTION_CANVASS = cite(
  'N.C.G.S. § 163-293(c)',
  GS_163_293,
  '(c) The canvass of the first election shall be held on the seventh day after the election.',
  FROM_2023_MUNICIPAL,
);

// --- holidays (G.S. 103-4) ---

function legalHoliday(item: string, quote: string): Citation {
  return cite(`N.C.G.S. § 103-4(a)(${item})`, GS_103_4, quote, FROM_2020_CYCLE);
}
const SUNDAY_HOLIDAY = cite(
  'N.C.G.S. § 103-4(b)',
  GS_103_4,
  '(b) Whenever any public holiday shall fall upon Sunday, the Monday following shall be a public holiday.',
  FROM_2020_CYCLE,
);

const FIRST_HOLIDAY_YEAR = 2018;
const LAST_HOLIDAY_YEAR = 2100;

function dayOf(year: number, month: number, day: number): IsoDate {
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Hebrew calendar arithmetic for Yom Kippur, 10 Tishri (the molad of Tishri with the four
// postponements, as days from the calendar's epoch; integer arithmetic only).
const HEBREW_EPOCH_DAY_NUMBER = -1373427 - 719163; // R.D. -1,373,427 counted from 1970-01-01
function hebrewElapsedDays(hebrewYear: number): number {
  const monthsElapsed = Math.floor((235 * hebrewYear - 234) / 19);
  const partsElapsed = 12084 + 13753 * monthsElapsed;
  const days = 29 * monthsElapsed + Math.floor(partsElapsed / 25920);
  return (3 * (days + 1)) % 7 < 3 ? days + 1 : days;
}
function hebrewYearCorrection(hebrewYear: number): number {
  const before = hebrewElapsedDays(hebrewYear - 1);
  const start = hebrewElapsedDays(hebrewYear);
  const after = hebrewElapsedDays(hebrewYear + 1);
  if (after - start === 356) {
    return 2;
  }
  return start - before === 382 ? 1 : 0;
}
/** 10 Tishri of the Hebrew year that begins in the autumn of `year`. */
function yomKippur(year: number): IsoDate {
  const hebrewYear = year + 3761;
  const roshHashanah =
    HEBREW_EPOCH_DAY_NUMBER + hebrewElapsedDays(hebrewYear) + hebrewYearCorrection(hebrewYear);
  return fromDayNumber(roshHashanah + 9);
}

type HolidayRule = {
  readonly name: string;
  readonly date: (year: number) => IsoDate | null;
  readonly citation: Citation;
  readonly fixed: boolean; // a day of the month, which 103-4(b) can move from a Sunday
};

const LEGAL_HOLIDAYS: readonly HolidayRule[] = [
  {
    name: "New Year's Day",
    date: (y) => dayOf(y, 1, 1),
    citation: legalHoliday('1', "(1) New Year's Day, January 1."),
    fixed: true,
  },
  {
    name: "Martin Luther King, Jr.'s, Birthday",
    date: (y) => nthWeekdayOfMonth(y, 1, MONDAY, 3),
    citation: legalHoliday(
      '1a',
      "(1a) Martin Luther King, Jr.'s, Birthday, the third Monday in January.",
    ),
    fixed: false,
  },
  {
    name: "Robert E. Lee's Birthday",
    date: (y) => dayOf(y, 1, 19),
    citation: legalHoliday('2', "(2) Robert E. Lee's Birthday, January 19."),
    fixed: true,
  },
  {
    name: "Washington's Birthday",
    date: (y) => nthWeekdayOfMonth(y, 2, MONDAY, 3),
    citation: legalHoliday('3', "(3) Washington's Birthday, the third Monday in February."),
    fixed: false,
  },
  {
    name: 'Greek Independence Day',
    date: (y) => dayOf(y, 3, 25),
    citation: legalHoliday('3a', '(3a) Greek Independence Day, March 25.'),
    fixed: true,
  },
  {
    name: 'Anniversary of signing of Halifax Resolves',
    date: (y) => dayOf(y, 4, 12),
    citation: legalHoliday('4', '(4) Anniversary of signing of Halifax Resolves, April 12.'),
    fixed: true,
  },
  {
    name: 'Confederate Memorial Day',
    date: (y) => dayOf(y, 5, 10),
    citation: legalHoliday('5', '(5) Confederate Memorial Day, May 10.'),
    fixed: true,
  },
  {
    name: 'Anniversary of Mecklenburg Declaration of Independence',
    date: (y) => dayOf(y, 5, 20),
    citation: legalHoliday(
      '6',
      '(6) Anniversary of Mecklenburg Declaration of Independence, May 20.',
    ),
    fixed: true,
  },
  {
    name: 'Memorial Day',
    date: (y) => nthWeekdayOfMonth(y, 5, MONDAY, -1),
    citation: legalHoliday('7', '(7) Memorial Day, the last Monday in May.'),
    fixed: false,
  },
  {
    name: 'Good Friday',
    date: (y) => daysBefore(easterSunday(y), 2),
    citation: legalHoliday('8', '(8) Good Friday.'),
    fixed: false,
  },
  {
    name: 'Independence Day',
    date: (y) => dayOf(y, 7, 4),
    citation: legalHoliday('9', '(9) Independence Day, July 4.'),
    fixed: true,
  },
  {
    name: 'Labor Day',
    date: (y) => nthWeekdayOfMonth(y, 9, MONDAY, 1),
    citation: legalHoliday('10', '(10) Labor Day, the first Monday in September.'),
    fixed: false,
  },
  {
    name: 'First Responders Day',
    date: (y) => dayOf(y, 9, 11),
    citation: legalHoliday('10a', '(10a) First Responders Day, September 11.'),
    fixed: true,
  },
  {
    name: 'Columbus Day',
    date: (y) => nthWeekdayOfMonth(y, 10, MONDAY, 2),
    citation: legalHoliday('11', '(11) Columbus Day, the second Monday in October.'),
    fixed: false,
  },
  {
    name: 'Yom Kippur',
    date: yomKippur,
    citation: legalHoliday('11a', '(11a) Yom Kippur.'),
    fixed: false,
  },
  {
    name: 'Veterans Day',
    date: (y) => dayOf(y, 11, 11),
    citation: legalHoliday('12', '(12) Veterans Day, November 11.'),
    fixed: true,
  },
  {
    // General elections for the officers of G.S. 163-1 are held in even-numbered years.
    name: 'General election day',
    date: (y) => (y % 2 === 0 ? novemberElectionDay(y) : null),
    citation: legalHoliday(
      '13',
      '(13) Tuesday after the first Monday in November in years in which a general election is to be held.',
    ),
    fixed: false,
  },
  {
    name: 'Thanksgiving Day',
    date: (y) => nthWeekdayOfMonth(y, 11, THURSDAY, 4),
    citation: legalHoliday('14', '(14) Thanksgiving Day, the fourth Thursday in November.'),
    fixed: false,
  },
  {
    name: 'Christmas Day',
    date: (y) => dayOf(y, 12, 25),
    citation: legalHoliday('15', '(15) Christmas Day, December 25.'),
    fixed: true,
  },
];

/**
 * Days the State's published holiday schedule observes in place of a Saturday holiday, when the
 * public offices of G.S. 103-5 are closed. Only schedules the State has published are listed; a
 * Saturday holiday of a year with no published schedule moves nothing (D-672).
 */
const OBSERVED_ON_FRIDAY: readonly Holiday[] = [
  {
    date: '2026-07-03',
    name: 'Independence Day (observed)',
    citation: cite(
      'State Human Resources Commission, 2026 Holiday Schedule',
      OSHR_HOLIDAYS,
      'Independence Day | July 3, 2026 | Friday',
      '2026-01-01',
    ),
  },
];

function ncHolidays(year: number): HolidayCalendar {
  if (!Number.isInteger(year) || year < FIRST_HOLIDAY_YEAR || year > LAST_HOLIDAY_YEAR) {
    throw new RangeError(`nc: no holiday calendar for ${String(year)}`);
  }
  const holidays: Holiday[] = [];
  for (const rule of LEGAL_HOLIDAYS) {
    const date = rule.date(year);
    if (date === null) {
      continue;
    }
    holidays.push({ date, name: rule.name, citation: rule.citation });
    if (rule.fixed && weekdayOf(date) === SUNDAY) {
      holidays.push({
        date: addDays(date, 1),
        name: `${rule.name} (Monday following)`,
        citation: SUNDAY_HOLIDAY,
      });
    }
  }
  const prefix = `${String(year)}-`;
  holidays.push(...OBSERVED_ON_FRIDAY.filter((h) => h.date.startsWith(prefix)));
  holidays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { state: STATE, year, holidays };
}

/** The calendars of the year before, `year` and the year after, for rolls and business-day counts. */
function rollCalendar(year: number): HolidayCalendar {
  const years = [year - 1, year, year + 1].filter(
    (y) => y >= FIRST_HOLIDAY_YEAR && y <= LAST_HOLIDAY_YEAR,
  );
  return { state: STATE, year, holidays: years.flatMap((y) => ncHolidays(y).holidays) };
}

/** G.S. 103-5(a): an act due on a closed day may be done on the next day the office is open. */
function nextOpenDay(d: IsoDate): IsoDate {
  return roll(d, 'next_business_day', rollCalendar(yearOf(d)));
}

/** The third business day before `deadline` (G.S. 163-106.4, 163-294.2(d)). */
function thirdBusinessDayBefore(deadline: IsoDate): IsoDate {
  const cal = rollCalendar(yearOf(deadline));
  let date = deadline;
  let counted = 0;
  while (counted < 3) {
    date = addDays(date, -1);
    if (isBusinessDay(date, cal)) {
      counted += 1;
    }
  }
  return date;
}

// --- schedules, track sets, parties ---

const SCHEDULES = [
  'nc_state_general',
  'nc_state_general_quadrennial',
  'nc_municipal',
  'nc_municipal_partisan',
  'nc_municipal_primary',
  'nc_municipal_runoff',
  'nc_school',
  'nc_soil_water',
  'nc_no_public_election',
] as const;
const TRACK_SETS = ['nc_partisan', 'nc_nonpartisan', 'nc_municipal', 'nc_soil_water'] as const;

/** The four parties the State Board recognizes, each nominating at its own primary (G.S. 163-1(b)). */
const PRIMARY_PARTIES = ['democratic', 'green', 'libertarian', 'republican'] as const;

function yearOf(d: IsoDate): number {
  return Number(d.slice(0, 4));
}
function primaryDay(year: number): IsoDate {
  return firstWeekdayAfter(nthWeekdayOfMonth(year, 3, MONDAY, 1), TUESDAY);
}
function secondPrimaryDay(primary: IsoDate): IsoDate | null {
  return primary >= SECOND_PRIMARY_DATE.validFrom
    ? addDays(primary, SECOND_PRIMARY_WEEKS * 7)
    : null;
}

function contest(
  date: IsoDate,
  kind: ContestOut['kind'],
  party: string | null,
  dateCitation: Citation,
): ContestOut {
  return { date, kind, party, dateCitation, electsOutright: false };
}

/** Each party's primary, each party's second primary and the general, in date order (D-666). */
function stateCycle(office: OfficeRef, year: number, generalCitation: Citation): ContestOut[] {
  const general = contest(novemberElectionDay(year), 'general', null, generalCitation);
  if (office.partisan !== true) {
    return [general];
  }
  const primary = primaryDay(year);
  const second = secondPrimaryDay(primary);
  return [
    ...PRIMARY_PARTIES.map((party) => contest(primary, 'primary', party, PRIMARY_DATE)),
    ...(second === null
      ? []
      : PRIMARY_PARTIES.map((party) =>
          contest(second, 'primary_runoff', party, SECOND_PRIMARY_DATE),
        )),
    general,
  ];
}

/** Municipal elections fall every two years from 1973 under G.S. 163-279(a), in odd-numbered years. */
function oddMunicipalYear(year: number): boolean {
  return year >= MUNICIPAL_FIRST_YEAR && (year - MUNICIPAL_FIRST_YEAR) % 2 === 0;
}

// --- municipal offices whose charter sets their years, by template key (D-894, D-895) ---

/**
 * Raleigh's charter, section 9: S.L. 2021-56 put its regular elections in even-numbered years from
 * 2022, with two-year terms; Ordinance (2024) 627 (adopted May 7, 2024, on the city's own document
 * host) staggered four-year terms from the 2026 election.
 */
const SL_2021_56 =
  'https://www.ncleg.gov/EnactedLegislation/SessionLaws/HTML/2021-2022/SL2021-56.html';
const RALEIGH_ORDINANCE =
  'https://cityofraleigh0drupal.blob.core.usgovcloudapi.net/drupal-prod/COR14/municipal-election-changes-2024-627.pdf';
const RALEIGH_EVEN_YEARS = cite(
  'S.L. 2021-56, § 1.8(b)',
  SL_2021_56,
  'No municipal elections shall be conducted in the City of Raleigh in 2021. The next regular municipal election shall be conducted in the City of Raleigh on November 8, 2022. The terms of office of the Mayor and all Council members serving on the effective date of this act shall be extended until their successor is elected and qualified. Regular municipal elections shall be conducted in 2022 and every two years thereafter.',
  '2021-06-28',
);
const RALEIGH_STAGGER = cite(
  'Raleigh Charter § 9(d), Ordinance (2024) 627',
  RALEIGH_ORDINANCE,
  'The terms of office shall be staggered as follows: In November 2026 and every four years thereafter, the at-large candidate receiving the highest number of votes in the 2026 municipal election, and the prevailing candidates for Mayor, and the District A and B seats shall be elected to four-year terms. In November 2026, the at-large candidate receiving the second highest number of votes in the 2026 municipal election and the prevailing candidates for the District C, D, and E seats shall be elected to two-year terms and in November 2028, and every four years thereafter, the same shall be elected to four-year terms.',
  '2024-05-07',
);

/** Elected in `first + k × every` (k ≥ 0), through `last` when it is set. */
type Cycle = {
  readonly first: number;
  readonly every: number;
  readonly last: number | null;
  readonly citation: Citation;
};

/** The two-year terms before the stagger: every even year from 2022 to `last`. */
function raleighTwoYear(last: number | null): Cycle {
  return { first: 2022, every: 2, last, citation: RALEIGH_EVEN_YEARS };
}
const RALEIGH_FIRST_GROUP: readonly Cycle[] = [
  { first: 2026, every: 4, last: null, citation: RALEIGH_STAGGER },
  raleighTwoYear(2026),
];
const RALEIGH_SECOND_GROUP: readonly Cycle[] = [
  { first: 2026, every: 2, last: 2028, citation: RALEIGH_STAGGER },
  { first: 2028, every: 4, last: null, citation: RALEIGH_STAGGER },
  raleighTwoYear(2026),
];

/**
 * Template key to election years, the first matching cycle citing them. Before a key's earliest
 * year the office keeps the statute's odd years; a key not listed keeps them always. Raleigh's two
 * at-large seats are one office: one seat of each group, so a contest every even year.
 */
const KEY_CYCLES: ReadonlyMap<string, readonly Cycle[]> = new Map([
  ['raleigh-mayor', RALEIGH_FIRST_GROUP],
  ['raleigh-city-council-district-a', RALEIGH_FIRST_GROUP],
  ['raleigh-city-council-district-b', RALEIGH_FIRST_GROUP],
  ['raleigh-city-council-district-c', RALEIGH_SECOND_GROUP],
  ['raleigh-city-council-district-d', RALEIGH_SECOND_GROUP],
  ['raleigh-city-council-district-e', RALEIGH_SECOND_GROUP],
  [
    'raleigh-city-council-at-large',
    [{ first: 2026, every: 2, last: null, citation: RALEIGH_STAGGER }, raleighTwoYear(2026)],
  ],
]);

/** The office types the table keys; no other office reads the key. */
const KEYED_TYPES: ReadonlySet<string> = new Set(['mayor', 'city-council']);

type MunicipalYear = { readonly elected: boolean; readonly citation: Citation | null };

/** Whether a municipal office is elected in `year`, and the charter text that says so when keyed. */
function municipalYear(office: OfficeRef, year: number): MunicipalYear {
  const cycles = KEYED_TYPES.has(office.officeTypeId)
    ? KEY_CYCLES.get(office.templateKey)
    : undefined;
  if (cycles === undefined || year < Math.min(...cycles.map((c) => c.first))) {
    return { elected: oddMunicipalYear(year), citation: null };
  }
  const match = cycles.find(
    (c) =>
      year >= c.first && (c.last === null || year <= c.last) && (year - c.first) % c.every === 0,
  );
  return { elected: match !== undefined, citation: match?.citation ?? null };
}

function ncContests(office: OfficeRef, year: number): readonly ContestOut[] {
  switch (office.schedule) {
    case 'nc_state_general':
      return year % 2 === 0 ? stateCycle(office, year, GENERAL_BIENNIAL) : [];
    case 'nc_state_general_quadrennial':
      return year % 4 === 0 ? stateCycle(office, year, GENERAL_QUADRENNIAL) : [];
    case 'nc_school':
      return year % 2 === 0 ? [contest(primaryDay(year), 'general', null, SCHOOL_BOARD_DATE)] : [];
    case 'nc_soil_water':
      return year % 2 === 0
        ? [contest(novemberElectionDay(year), 'general', null, SOIL_WATER_DATE)]
        : [];
    case 'nc_municipal': {
      const { elected, citation } = municipalYear(office, year);
      return elected
        ? [
            contest(
              novemberElectionDay(year),
              'general',
              null,
              citation ?? MUNICIPAL_PLURALITY_DATE,
            ),
          ]
        : [];
    }
    case 'nc_municipal_partisan': {
      const { elected, citation } = municipalYear(office, year);
      if (!elected) {
        return [];
      }
      const election = novemberElectionDay(year);
      const laborDay = nthWeekdayOfMonth(year, 9, MONDAY, 1);
      const primary = addDays(firstWeekdayAfter(laborDay, TUESDAY), 7);
      const second = daysBefore(election, 28);
      return [
        ...PRIMARY_PARTIES.map((party) =>
          contest(primary, 'primary', party, MUNICIPAL_PARTISAN_DATE),
        ),
        ...PRIMARY_PARTIES.map((party) =>
          contest(second, 'primary_runoff', party, MUNICIPAL_PARTISAN_DATE),
        ),
        contest(election, 'general', null, citation ?? MUNICIPAL_PARTISAN_DATE),
      ];
    }
    case 'nc_municipal_primary': {
      const { elected, citation } = municipalYear(office, year);
      if (!elected) {
        return [];
      }
      const election = novemberElectionDay(year);
      return [
        contest(daysBefore(election, 28), 'primary', null, MUNICIPAL_PRIMARY_DATE),
        contest(election, 'general', null, citation ?? MUNICIPAL_PRIMARY_DATE),
      ];
    }
    case 'nc_municipal_runoff': {
      const { elected, citation } = municipalYear(office, year);
      if (!elected) {
        return [];
      }
      const runoff = novemberElectionDay(year);
      return [
        contest(daysBefore(runoff, 28), 'general', null, citation ?? MUNICIPAL_RUNOFF_DATE),
        contest(runoff, 'general_runoff', null, MUNICIPAL_RUNOFF_DATE),
      ];
    }
    case 'nc_no_public_election':
      return [];
    default:
      throw new RangeError(`nc: unknown schedule ${office.schedule}`);
  }
}

// --- filing tracks ---

/** Offices of G.S. 163-107.1(b) and of the statewide petition of G.S. 163-122(a)(1). */
const STATEWIDE_TYPES: ReadonlySet<string> = new Set([
  'us-senate',
  'governor',
  'statewide-executive-other',
  'attorney-general',
  'secretary-of-state',
  'state-treasurer',
  'insurance-commissioner',
  'labor-commissioner',
  'state-appellate-judge',
]);
/** The other offices that file with the State Board under G.S. 163-106.2(a). */
const STATE_BOARD_DISTRICT_TYPES: ReadonlySet<string> = new Set([
  'us-house',
  'district-attorney',
  'trial-judge',
]);
const ASSEMBLY_TYPES: ReadonlySet<string> = new Set(['state-senate', 'state-house']);
/** County offices of G.S. 163-1(a) filed under G.S. 163-106.2(b). */
const COUNTY_TYPES: ReadonlySet<string> = new Set([
  'county-commission',
  'sheriff',
  'county-treasurer',
  'county-row-other',
]);

function isKnownPartisanType(officeTypeId: string): boolean {
  return (
    STATEWIDE_TYPES.has(officeTypeId) ||
    STATE_BOARD_DISTRICT_TYPES.has(officeTypeId) ||
    ASSEMBLY_TYPES.has(officeTypeId) ||
    COUNTY_TYPES.has(officeTypeId)
  );
}

function emptyTrack(track: TrackOut['track'], closesOn: Computed<IsoDate>): TrackOut {
  return {
    track,
    opensOn: null,
    closesOn,
    closesTime: null,
    petitionOpens: null,
    petitionDue: null,
    fee: null,
    signatures: null,
    alternatives: [],
    whereToFile: null,
    withdrawalDeadline: null,
  };
}

function noon(citation: Citation): Computed<string> {
  return { value: '12:00', citation };
}

/** The December window before a primary in `primaryYear`: first Monday to third Friday (G.S. 163-106.2). */
function decemberWindow(primaryYear: number): { opens: IsoDate; closes: IsoDate } {
  return {
    opens: nthWeekdayOfMonth(primaryYear - 1, 12, MONDAY, 1),
    closes: nthWeekdayOfMonth(primaryYear - 1, 12, FRIDAY, 3),
  };
}

function onePercentFee(citation: Citation): Computed<FeeRule> {
  return { value: { kind: 'percent_of_annual_pay', percent: 1 }, citation };
}

function partyPrimaryTrack(office: OfficeRef, primaryYear: number): TrackOut {
  const { opens, closes } = decemberWindow(primaryYear);
  const stateBoard =
    STATEWIDE_TYPES.has(office.officeTypeId) || STATE_BOARD_DISTRICT_TYPES.has(office.officeTypeId);
  const citation = stateBoard ? FILING_STATE_BOARD : FILING_COUNTY_BOARD;
  const known = isKnownPartisanType(office.officeTypeId);
  const alternatives: TrackOut['alternatives'] = !known
    ? []
    : STATEWIDE_TYPES.has(office.officeTypeId)
      ? [
          {
            kind: 'petition_in_lieu_of_fee',
            signatures: {
              value: { kind: 'fixed', count: 10_000 },
              citation: PETITION_IN_LIEU_STATEWIDE,
            },
          },
        ]
      : [
          {
            kind: 'petition_in_lieu_of_fee',
            signatures: {
              value: { kind: 'percent_of_registered', percent: 5 },
              citation: PETITION_IN_LIEU_LOCAL,
            },
          },
        ];
  return {
    ...emptyTrack('party_primary', { value: closes, citation }),
    // "no earlier than 12:00 noon on the first Monday in December": always a business day.
    opensOn: { value: opens, citation },
    closesTime: noon(citation),
    fee: known ? onePercentFee(PRIMARY_FEE) : null,
    alternatives,
    whereToFile: known
      ? {
          value: stateBoard ? 'the State Board' : 'the county board of elections',
          citation,
        }
      : null,
    withdrawalDeadline: { value: thirdBusinessDayBefore(closes), citation: WITHDRAWAL_PRIMARY },
  };
}

type UnaffiliatedRule = {
  readonly citation: Citation;
  readonly signatures: SignatureRule;
  readonly filedWith: string;
};

function unaffiliatedRule(officeTypeId: string): UnaffiliatedRule | null {
  if (STATEWIDE_TYPES.has(officeTypeId)) {
    return {
      citation: UNAFFILIATED_STATEWIDE,
      signatures: { kind: 'percent_of_votes', percent: 1.5, base: 'last_governor' },
      filedWith: 'the State Board of Elections',
    };
  }
  if (officeTypeId === 'trial-judge') {
    return {
      citation: UNAFFILIATED_JUDGES,
      signatures: { kind: 'percent_of_registered', percent: 2 },
      filedWith: 'the State Board of Elections',
    };
  }
  if (STATE_BOARD_DISTRICT_TYPES.has(officeTypeId)) {
    return {
      citation: UNAFFILIATED_DISTRICT,
      signatures: { kind: 'percent_of_registered', percent: 1.5 },
      filedWith: 'the State Board of Elections',
    };
  }
  if (ASSEMBLY_TYPES.has(officeTypeId)) {
    return {
      citation: UNAFFILIATED_ASSEMBLY,
      signatures: { kind: 'percent_of_registered', percent: 4 },
      filedWith:
        'the State Board of Elections, for a district in more than one county; the county board of elections, for a single county legislative district',
    };
  }
  if (COUNTY_TYPES.has(officeTypeId)) {
    return {
      citation: UNAFFILIATED_COUNTY,
      signatures: { kind: 'percent_of_registered', percent: 4 },
      filedWith: 'the county board of elections',
    };
  }
  return null;
}

/** Petitions due at noon on primary day (G.S. 163-122(a)); the section sets no first day. */
function independentTrack(office: OfficeRef, generalYear: number): TrackOut {
  const rule = unaffiliatedRule(office.officeTypeId);
  const citation = rule?.citation ?? UNAFFILIATED_COUNTY;
  const due: Computed<IsoDate> = { value: primaryDay(generalYear), citation };
  return {
    ...emptyTrack('independent', due),
    closesTime: noon(citation),
    petitionDue: due,
    fee: rule === null ? null : onePercentFee(UNAFFILIATED_FEE),
    signatures: rule === null ? null : { value: rule.signatures, citation: rule.citation },
    whereToFile: rule === null ? null : { value: rule.filedWith, citation: rule.citation },
  };
}

/** County boards of education file in the December window before the primary (G.S. 115C-37(a)). */
function schoolTrack(contestYear: number): TrackOut {
  const { opens, closes } = decemberWindow(contestYear);
  return {
    ...emptyTrack('nonpartisan', { value: closes, citation: FILING_COUNTY_BOARD }),
    opensOn: { value: opens, citation: FILING_COUNTY_BOARD },
    closesTime: noon(FILING_COUNTY_BOARD),
    whereToFile: { value: 'the county board of elections', citation: SCHOOL_BOARD_FILING },
    withdrawalDeadline: { value: thirdBusinessDayBefore(closes), citation: WITHDRAWAL_PRIMARY },
  };
}

/**
 * The July window: noon on the first Friday to noon on the third Friday (G.S. 163-294.2(c),
 * 163-291(2)). A first day on which the office is closed moves to the next open day (G.S. 103-5(a)),
 * whose hour no statute states.
 */
function municipalTrack(track: 'nonpartisan' | 'party_primary', electionYear: number): TrackOut {
  const citation = track === 'nonpartisan' ? MUNICIPAL_FILING : MUNICIPAL_PARTY_FILING;
  const firstFriday = nthWeekdayOfMonth(electionYear, 7, FRIDAY, 1);
  const opens = nextOpenDay(firstFriday);
  const unrolledClose = nthWeekdayOfMonth(electionYear, 7, FRIDAY, 3);
  const closes = nextOpenDay(unrolledClose);
  return {
    ...emptyTrack(track, {
      value: closes,
      citation: closes === unrolledClose ? citation : NEXT_OPEN_DAY,
    }),
    opensOn: { value: opens, citation: opens === firstFriday ? citation : NEXT_OPEN_DAY },
    closesTime: closes === unrolledClose ? noon(citation) : null,
    whereToFile: { value: 'the board of elections', citation },
    withdrawalDeadline:
      track === 'nonpartisan'
        ? { value: thirdBusinessDayBefore(closes), citation: MUNICIPAL_WITHDRAWAL }
        : null,
  };
}

/** Noon on the second Monday in June to noon on the first Friday in July (G.S. 139-6), with 103-5(a). */
function soilWaterTrack(electionYear: number): TrackOut {
  const unrolledClose = nthWeekdayOfMonth(electionYear, 7, FRIDAY, 1);
  const closes = nextOpenDay(unrolledClose);
  const rolled = closes !== unrolledClose;
  return {
    ...emptyTrack('nonpartisan', {
      value: closes,
      citation: rolled ? NEXT_OPEN_DAY : SOIL_WATER_FILING,
    }),
    opensOn: { value: nthWeekdayOfMonth(electionYear, 6, MONDAY, 2), citation: SOIL_WATER_FILING },
    closesTime: rolled ? null : noon(SOIL_WATER_FILING),
    fee: { value: { kind: 'fixed', cents: 500 }, citation: SOIL_WATER_FEE },
    whereToFile: { value: 'the county board of elections', citation: SOIL_WATER_FILED_WITH },
  };
}

/** Municipal schedules whose candidates file for the primary, not for the election. */
const MUNICIPAL_WITH_PRIMARY: ReadonlySet<string> = new Set([
  'nc_municipal_partisan',
  'nc_municipal_primary',
]);

function ncFilingTracks(office: OfficeRef, contestRef: ContestRef): readonly TrackOut[] {
  const year = yearOf(contestRef.date);
  switch (office.trackSet) {
    case 'nc_partisan':
      if (contestRef.kind === 'primary') {
        return [partyPrimaryTrack(office, year)];
      }
      if (contestRef.kind === 'general') {
        return [independentTrack(office, year)];
      }
      return [];
    case 'nc_nonpartisan':
      return contestRef.kind === 'general' ? [schoolTrack(year)] : [];
    case 'nc_municipal':
      if (contestRef.kind === 'primary') {
        return [municipalTrack(contestRef.party === null ? 'nonpartisan' : 'party_primary', year)];
      }
      if (contestRef.kind === 'general' && !MUNICIPAL_WITH_PRIMARY.has(office.schedule)) {
        return [municipalTrack('nonpartisan', year)];
      }
      return [];
    case 'nc_soil_water':
      return contestRef.kind === 'general' ? [soilWaterTrack(year)] : [];
    default:
      throw new RangeError(`nc: unknown track set ${office.trackSet}`);
  }
}

// --- certification ---

function after(d: IsoDate, days: number, citation: Citation): Computed<IsoDate> {
  return { value: addDays(d, days), citation };
}

function ncCertification(office: OfficeRef, contestRef: ContestRef): Computed<IsoDate> | null {
  const { date, kind } = contestRef;
  switch (office.schedule) {
    case 'nc_state_general':
    case 'nc_state_general_quadrennial':
      if (office.jurisdictionKind === 'county') {
        return after(date, 10, COUNTY_CANVASS);
      }
      // After a primary the State Board fixes the day of its canvass (G.S. 163-182.5(c)).
      return kind === 'general' ? after(date, 21, STATE_CANVASS) : null;
    case 'nc_school':
    case 'nc_soil_water':
    case 'nc_municipal':
    case 'nc_municipal_primary':
      return after(date, 10, COUNTY_CANVASS);
    case 'nc_municipal_partisan':
      return kind === 'general'
        ? after(date, 10, COUNTY_CANVASS)
        : after(date, 7, MUNICIPAL_PRIMARY_CANVASS);
    case 'nc_municipal_runoff':
      return kind === 'general'
        ? after(date, 7, MUNICIPAL_FIRST_ELECTION_CANVASS)
        : after(date, 10, COUNTY_CANVASS);
    case 'nc_no_public_election':
      return null;
    default:
      throw new RangeError(`nc: unknown schedule ${office.schedule}`);
  }
}

export const ncRules: StateRules = {
  state: STATE,
  schedules: SCHEDULES,
  trackSets: TRACK_SETS,
  holidays: ncHolidays,
  contests: ({ office, year }) => ncContests(office, year),
  filingTracks: ({ office, contest: contestRef }) => ncFilingTracks(office, contestRef),
  certificationDate: ({ office, contest: contestRef }) => ncCertification(office, contestRef),
  // G.S. 153A-92(a): the board of commissioners fixes the pay of every county officer.
  countyPay: () => null,
};
