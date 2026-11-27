// Texas deadline rules (PIPE-rules-api, D-330): the Election Code's election dates, filing periods
// and canvass days, with the holidays Election Code § 1.006 names. Counties, cities, school
// districts, the legislature, statewide offices and party offices on the primary ballot (D-080,
// D-383). Only the helpers of ../dates.ts and the tables below.
import {
  addDays,
  daysBefore,
  firstWeekdayAfter,
  MONDAY,
  novemberElectionDay,
  nthWeekdayOfMonth,
  roll,
  SATURDAY,
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

const STATE = 'TX';

const ELECTION_CODE_URL = 'https://tcss.legis.texas.gov/resources/EL/htm';
const CH1 = `${ELECTION_CODE_URL}/EL.1.htm`;
const CH41 = `${ELECTION_CODE_URL}/EL.41.htm`;
const CH67 = `${ELECTION_CODE_URL}/EL.67.htm`;
const CH142 = `${ELECTION_CODE_URL}/EL.142.htm`;
const CH143 = `${ELECTION_CODE_URL}/EL.143.htm`;
const CH144 = `${ELECTION_CODE_URL}/EL.144.htm`;
const CH172 = `${ELECTION_CODE_URL}/EL.172.htm`;
const GOV_662 = 'https://tcss.legis.texas.gov/resources/GV/htm/GV.662.htm';
const USC_6103 = 'https://uscode.house.gov/us/usc/t5/s6103/';

function cite(citation: string, sourceUrl: string, quote: string, validFrom: IsoDate): Citation {
  return { citation, sourceUrl, quote, validFrom, validTo: null };
}

// --- election dates ---

const MAY_ODD = cite(
  'Tex. Elec. Code § 41.001(a)(1)',
  CH41,
  '(1) the first Saturday in May in an odd-numbered year;',
  '2021-09-01',
);
const MAY_EVEN = cite(
  'Tex. Elec. Code § 41.001(a)(2)',
  CH41,
  '(2) the first Saturday in May in an even-numbered year, for an election held by a political subdivision other than a county, or ordered by the governor; or',
  '2021-09-01',
);
const NOVEMBER_UNIFORM = cite(
  'Tex. Elec. Code § 41.001(a)(3)',
  CH41,
  '(3) the first Tuesday after the first Monday in November.',
  '2021-09-01',
);
const GENERAL_ELECTION = cite(
  'Tex. Elec. Code § 41.002',
  CH41,
  'The general election for state and county officers shall be held on the first Tuesday after the first Monday in November in even-numbered years.',
  '1986-01-01',
);
const PRIMARY_DATE = cite(
  'Tex. Elec. Code § 41.007(a)',
  CH41,
  'The general primary election date is the first Tuesday in March in each even-numbered year.',
  '2011-09-01',
);
const RUNOFF_PRIMARY_DATE = cite(
  'Tex. Elec. Code § 41.007(b)',
  CH41,
  'The runoff primary election date is the fourth Tuesday in May following the general primary election.',
  '2011-09-01',
);

// --- primary filing (party candidates, independents' declarations, party offices) ---

const PRIMARY_DEADLINE = cite(
  'Tex. Elec. Code § 172.023(a)',
  CH172,
  'An application for a place on the general primary election ballot must be filed not later than 6 p.m. on the second Monday in December of an odd-numbered year unless the filing deadline is extended under Subchapter C.',
  '2011-09-01',
);
const PRIMARY_OPENS = cite(
  'Tex. Elec. Code § 172.023(b)',
  CH172,
  'An application, other than an application for the office of precinct chair, may not be filed earlier than the 30th day before the date of the regular filing deadline.',
  '2011-09-01',
);
const PRECINCT_CHAIR_OPENS = cite(
  'Tex. Elec. Code § 172.023(b)',
  CH172,
  'An application for the office of precinct chair may not be filed earlier than the 90th day before the date of the regular filing deadline.',
  '2011-09-01',
);
const PRIMARY_FILED_WITH = cite(
  'Tex. Elec. Code § 172.022(a)',
  CH172,
  'An application for a place on the general primary election ballot must be filed with: (1) the state chair, for an office filled by voters of more than one county; or (2) the county chair or the secretary, if any, of the county executive committee, for an office filled by voters of a single county.',
  '2013-06-14',
);
const PETITION_IN_LIEU = cite(
  'Tex. Elec. Code § 172.025',
  CH172,
  'The minimum number of signatures that must appear on the petition authorized by Section 172.021(b) is: (1) 5,000, for a statewide office; or (2) for a district, county, or precinct office, the lesser of: (A) 500; or (B) two percent of the total vote received in the district, county, or precinct, as applicable, by all the candidates for governor in the most recent gubernatorial general election',
  '1987-09-01',
);
const PARTY_OFFICE_NO_FEE = cite(
  'Tex. Elec. Code § 172.021(b)',
  CH172,
  'A political party may not require payment of a fee as a condition to applying for a place on the ballot as a candidate for county chair or precinct chair.',
  '2025-09-01',
);

/** The fee of § 172.024(a): its text in force since 2023-09-01 (H.B. 4559). */
function feeCitation(quote: string): Citation {
  return cite('Tex. Elec. Code § 172.024(a)', CH172, quote, '2023-09-01');
}
const FEE_US_SENATE = feeCitation('(1) United States senator $5,000');
const FEE_STATEWIDE = feeCitation(
  '(2) office elected statewide, except United States senator 3,750',
);
const FEE_US_HOUSE = feeCitation('(3) United States representative 3,125');
const FEE_STATE_SENATE = feeCitation('(4) state senator 1,250');
const FEE_STATE_HOUSE = feeCitation('(5) state representative 750');
const FEE_SBOE = feeCitation('(6) member, State Board of Education 300');
const FEE_DISTRICT_ATTORNEY = feeCitation(
  '(13) district attorney, criminal district attorney, or county attorney performing the duties of a district attorney 1,250',
);
const FEE_COUNTY_TIER = feeCitation(
  '(14) county commissioner, district clerk, county clerk, sheriff, county tax assessor-collector, county treasurer, or judge, constitutional county court: (A) county with a population of 200,000 or more 1,250 (B) county with a population of under 200,000 750',
);

const INDEPENDENT_DECLARATION = cite(
  'Tex. Elec. Code § 142.002(b)(2)',
  CH142,
  "(2) be filed with the authority with whom the candidate's application for a place on the ballot is required to be filed within the regular filing period for an application for a place on a general primary election ballot; and",
  '1986-01-01',
);
const INDEPENDENT_PETITION_ONLY = cite(
  'Tex. Elec. Code § 142.004(b)',
  CH142,
  'An application must, in addition to complying with Section 141.031, be accompanied by a petition that satisfies the requirements prescribed by Section 141.062.',
  '1986-01-01',
);
const INDEPENDENT_FILED_WITH = cite(
  'Tex. Elec. Code § 142.005',
  CH142,
  'An application for a place on the ballot must be filed with: (1) the secretary of state, for a statewide or district office; or (2) the county judge, for a county or precinct office.',
  '1986-01-01',
);
const INDEPENDENT_DEADLINE = cite(
  'Tex. Elec. Code § 142.006(a)',
  CH142,
  'An application for a place on the ballot must be filed not later than 5 p.m. of the 30th day after runoff primary election day, except as provided by Section 202.007.',
  '1987-09-01',
);
const INDEPENDENT_SIGNATURES = cite(
  'Tex. Elec. Code § 142.007',
  CH142,
  "The minimum number of signatures that must appear on a candidate's petition is: (1) for a statewide office, one percent of the total vote received by all candidates for governor in the most recent gubernatorial general election; or (2) for a district, county, or precinct office, the lesser of: (A) 500; or",
  '1986-01-01',
);
const INDEPENDENT_PETITION_AFTER_PRIMARY = cite(
  'Tex. Elec. Code § 142.009',
  CH142,
  "A signature on a candidate's petition is invalid if the signer: (1) signed the petition on or before general primary election day or, if a runoff primary is held for the office sought by the candidate, on or before runoff primary election day; or",
  '1986-01-01',
);

// --- local (city, school district and other political subdivision) filing ---

const CITY_FILING = cite(
  'Tex. Elec. Code § 143.007',
  CH143,
  '(a) Except as otherwise provided by this code, an application for a place on the ballot must be filed not later than 5 p.m. of the 62nd day before election day. An application may not be filed earlier than the 30th day before the date of the filing deadline. (b) An application filed by mail is considered to be filed at the time of its receipt by the appropriate authority. (c) For an election to be held on a uniform election date, the day of the filing deadline is the 78th day before election day.',
  '2015-09-01',
);
const CITY_FILED_WITH = cite(
  'Tex. Elec. Code § 143.006(a)',
  CH143,
  '(a) Except as provided by Subsections (b) and (c), an application for a place on the ballot must be filed with the city secretary.',
  '1986-01-01',
);
const DISTRICT_FILING = cite(
  'Tex. Elec. Code § 144.005',
  CH144,
  '(a) Except as provided by Subsection (d), an application for a place on the ballot must be filed not later than 5 p.m. of the 62nd day before election day. Notwithstanding any other law outside this code, an application may not be filed earlier than the 30th day before the date of the filing deadline.',
  '2015-09-01',
);
const DISTRICT_FILING_UNIFORM = cite(
  'Tex. Elec. Code § 144.005(d)',
  CH144,
  '(d) For an election to be held on a uniform election date, the day of the filing deadline is the 78th day before election day.',
  '2015-09-01',
);
const DISTRICT_FILED_WITH = cite(
  'Tex. Elec. Code § 144.004',
  CH144,
  "Except as otherwise provided by law, an application for a place on the ballot must be filed with the secretary of the political subdivision's governing body or, if the governing body has no secretary, with the governing body's presiding officer.",
  '1986-01-01',
);

// --- canvass (D-322) ---

const PRIMARY_LOCAL_CANVASS = cite(
  'Tex. Elec. Code § 172.116(b)',
  CH172,
  "(b) The county chair or the county chair's designee and any selected county executive committee member shall convene to conduct the local canvass on the second Thursday after election day",
  '2019-09-01',
);
const PRIMARY_STATE_CANVASS = cite(
  'Tex. Elec. Code § 172.120(b)',
  CH172,
  '(b) The state chair shall conduct the state canvass for the general primary election not later than: (1) the second Sunday after general primary election day, for an election in which three or more candidates are seeking election to the same office; or (2) the 22nd day after general primary election day, for an election not described by Subdivision (1).',
  '2015-09-01',
);
const RUNOFF_STATE_CANVASS = cite(
  'Tex. Elec. Code § 172.120(b-1)',
  CH172,
  '(b-1) Not later than the third Saturday after runoff primary election day, the state chair shall complete the state canvass of the runoff primary election.',
  '2015-09-01',
);
const LOCAL_CANVASS = cite(
  'Tex. Elec. Code § 67.003(b)',
  CH67,
  "(b) Except as provided by Subsection (c), each local canvassing authority shall convene to conduct the local canvass at the time set by the canvassing authority's presiding officer not later than the 11th day after election day",
  '2017-09-01',
);
const LOCAL_CANVASS_GENERAL_DAY = cite(
  'Tex. Elec. Code § 67.003(c)',
  CH67,
  '(c) In an election described by Section 65.051(a-1), the time for the local canvass may be set not later than the 14th day after election day.',
  '2017-09-01',
);
const STATE_CANVASS_GENERAL_DAY = cite(
  'Tex. Elec. Code § 67.012(a)(2)',
  CH67,
  '(2) for an election described by Section 65.051(a-1), not earlier than the 18th or later than the 33rd day after election day.',
  '2019-09-01',
);

// --- holidays (Election Code § 1.006) ---

const NATIONAL_HOLIDAY_VALID_FROM = '2015-09-01';
function nationalHoliday(
  quote: string,
  validFrom: IsoDate = NATIONAL_HOLIDAY_VALID_FROM,
): Citation {
  return cite('5 U.S.C. § 6103(a); Tex. Elec. Code § 1.006(f)(1)(A)', USC_6103, quote, validFrom);
}
function stateHoliday(item: string, quote: string): Citation {
  return cite(
    `Tex. Gov’t Code § 662.003(b)(${item}); Tex. Elec. Code § 1.006(f)(2)`,
    GOV_662,
    quote,
    '2015-09-01',
  );
}
const IN_LIEU_HOLIDAY = cite(
  'Tex. Elec. Code § 1.006(f)(1)(B)',
  CH1,
  '(B) if a holiday described by Paragraph (A) occurs on a Saturday or Sunday, a holiday taken in lieu of that holiday on which there is no regular United States mail delivery.',
  '2015-09-01',
);

const FIRST_HOLIDAY_YEAR = 2022;
const LAST_HOLIDAY_YEAR = 2100;

type HolidayRule = {
  readonly name: string;
  readonly date: (year: number) => IsoDate;
  readonly citation: Citation;
};

function dayOf(year: number, month: number, day: number): IsoDate {
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const NATIONAL_HOLIDAYS: readonly HolidayRule[] = [
  {
    name: 'New Year’s Day',
    date: (y) => dayOf(y, 1, 1),
    citation: nationalHoliday('New Year’s Day, January 1.'),
  },
  {
    name: 'Birthday of Martin Luther King, Jr.',
    date: (y) => nthWeekdayOfMonth(y, 1, MONDAY, 3),
    citation: nationalHoliday('Birthday of Martin Luther King, Jr., the third Monday in January.'),
  },
  {
    name: 'Washington’s Birthday',
    date: (y) => nthWeekdayOfMonth(y, 2, MONDAY, 3),
    citation: nationalHoliday('Washington’s Birthday, the third Monday in February.'),
  },
  {
    name: 'Memorial Day',
    date: (y) => nthWeekdayOfMonth(y, 5, MONDAY, -1),
    citation: nationalHoliday('Memorial Day, the last Monday in May.'),
  },
  {
    name: 'Juneteenth National Independence Day',
    date: (y) => dayOf(y, 6, 19),
    citation: nationalHoliday('Juneteenth National Independence Day, June 19.', '2021-06-17'),
  },
  {
    name: 'Independence Day',
    date: (y) => dayOf(y, 7, 4),
    citation: nationalHoliday('Independence Day, July 4.'),
  },
  {
    name: 'Labor Day',
    date: (y) => nthWeekdayOfMonth(y, 9, MONDAY, 1),
    citation: nationalHoliday('Labor Day, the first Monday in September.'),
  },
  {
    name: 'Columbus Day',
    date: (y) => nthWeekdayOfMonth(y, 10, MONDAY, 2),
    citation: nationalHoliday('Columbus Day, the second Monday in October.'),
  },
  {
    name: 'Veterans Day',
    date: (y) => dayOf(y, 11, 11),
    citation: nationalHoliday('Veterans Day, November 11.'),
  },
  {
    name: 'Thanksgiving Day',
    date: (y) => nthWeekdayOfMonth(y, 11, THURSDAY, 4),
    citation: nationalHoliday('Thanksgiving Day, the fourth Thursday in November.'),
  },
  {
    name: 'Christmas Day',
    date: (y) => dayOf(y, 12, 25),
    citation: nationalHoliday('Christmas Day, December 25.'),
  },
];

// § 1.006(f)(2) takes the state holidays of § 662.003(b)(1) to (6) only: not December 24 or 26,
// and no optional holiday of § 662.003(c).
const STATE_HOLIDAYS: readonly HolidayRule[] = [
  {
    name: 'Confederate Heroes Day',
    date: (y) => dayOf(y, 1, 19),
    citation: stateHoliday('1', '(1) the 19th day of January, "Confederate Heroes Day,"'),
  },
  {
    name: 'Texas Independence Day',
    date: (y) => dayOf(y, 3, 2),
    citation: stateHoliday('2', '(2) the second day of March, "Texas Independence Day";'),
  },
  {
    name: 'San Jacinto Day',
    date: (y) => dayOf(y, 4, 21),
    citation: stateHoliday('3', '(3) the 21st day of April, "San Jacinto Day";'),
  },
  {
    name: 'Emancipation Day in Texas',
    date: (y) => dayOf(y, 6, 19),
    citation: stateHoliday('4', '(4) the 19th day of June, "Emancipation Day in Texas,"'),
  },
  {
    name: 'Lyndon Baines Johnson Day',
    date: (y) => dayOf(y, 8, 27),
    citation: stateHoliday('5', '(5) the 27th day of August, "Lyndon Baines Johnson Day,"'),
  },
  {
    name: 'Friday after Thanksgiving Day',
    date: (y) => addDays(nthWeekdayOfMonth(y, 11, THURSDAY, 4), 1),
    citation: stateHoliday('6', '(6) the Friday after Thanksgiving Day;'),
  },
];

function txHolidays(year: number): HolidayCalendar {
  if (!Number.isInteger(year) || year < FIRST_HOLIDAY_YEAR || year > LAST_HOLIDAY_YEAR) {
    throw new RangeError(`tx: no holiday calendar for ${String(year)}`);
  }
  const holidays: Holiday[] = [];
  for (const rule of NATIONAL_HOLIDAYS) {
    const date = rule.date(year);
    holidays.push({ date, name: rule.name, citation: rule.citation });
    // A Sunday holiday is taken the Monday after, a day with no regular mail delivery. The Friday
    // before a Saturday holiday is left out: the Saturday is no business day already.
    if (weekdayOf(date) === SUNDAY) {
      holidays.push({
        date: addDays(date, 1),
        name: `${rule.name} (observed)`,
        citation: IN_LIEU_HOLIDAY,
      });
    }
  }
  for (const rule of STATE_HOLIDAYS) {
    holidays.push({
      date: rule.date(year),
      name: rule.name,
      citation: rule.citation,
    });
  }
  holidays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { state: STATE, year, holidays };
}

/** The calendars of `year` and the year after, for a roll that can cross December 31. */
function rollCalendar(year: number): HolidayCalendar {
  const years = year < LAST_HOLIDAY_YEAR ? [year, year + 1] : [year];
  return {
    state: STATE,
    year,
    holidays: years.flatMap((y) => txHolidays(y).holidays),
  };
}

/** § 1.006(a): a last day that is a Saturday, Sunday or holiday moves to the next business day. */
function lastDay(d: IsoDate): IsoDate {
  return roll(d, 'next_business_day', rollCalendar(Number(d.slice(0, 4))));
}

// --- schedules, track sets, parties ---

const SCHEDULES = [
  'tx_state_general',
  'tx_county_general',
  'tx_uniform_may',
  'tx_uniform_november',
  'tx_party_primary',
  'tx_no_public_election',
] as const;
const TRACK_SETS = ['tx_partisan', 'tx_local', 'tx_party_office'] as const;

/** Parties that nominate by primary under § 172.001 (the Democratic and Republican primaries). */
const PRIMARY_PARTIES = ['democratic', 'republican'] as const;

function yearOf(d: IsoDate): number {
  return Number(d.slice(0, 4));
}
function primaryDay(year: number): IsoDate {
  return nthWeekdayOfMonth(year, 3, TUESDAY, 1);
}
function runoffPrimaryDay(year: number): IsoDate {
  return nthWeekdayOfMonth(year, 5, TUESDAY, 4);
}
/** The second Monday in December of the odd-numbered year before the primary (§ 172.023(a)). */
function primaryDeadline(primaryYear: number): IsoDate {
  return nthWeekdayOfMonth(primaryYear - 1, 12, MONDAY, 2);
}

function contest(
  date: IsoDate,
  kind: ContestOut['kind'],
  party: string | null,
  dateCitation: Citation,
): ContestOut {
  return { date, kind, party, dateCitation, electsOutright: false };
}

/** Each party's primary, each party's runoff primary and the general, in date order (D-666). */
function partisanCycle(year: number, withPrimaries: boolean): readonly ContestOut[] {
  const general = contest(novemberElectionDay(year), 'general', null, GENERAL_ELECTION);
  if (!withPrimaries) {
    return [general];
  }
  return [
    ...PRIMARY_PARTIES.map((party) => contest(primaryDay(year), 'primary', party, PRIMARY_DATE)),
    ...PRIMARY_PARTIES.map((party) =>
      contest(runoffPrimaryDay(year), 'primary_runoff', party, RUNOFF_PRIMARY_DATE),
    ),
    general,
  ];
}

function txContests(office: OfficeRef, year: number): readonly ContestOut[] {
  switch (office.schedule) {
    case 'tx_state_general':
    case 'tx_county_general':
      return year % 2 === 0 ? partisanCycle(year, office.partisan === true) : [];
    case 'tx_party_primary':
      // §§ 171.022(a), (b): county and precinct chairs are elected at the general primary by
      // majority vote, with a runoff conducted as the runoff primary.
      return year % 2 === 0
        ? [
            ...PRIMARY_PARTIES.map((party) =>
              contest(primaryDay(year), 'primary', party, PRIMARY_DATE),
            ),
            ...PRIMARY_PARTIES.map((party) =>
              contest(runoffPrimaryDay(year), 'primary_runoff', party, RUNOFF_PRIMARY_DATE),
            ),
          ]
        : [];
    case 'tx_uniform_may': {
      const date = nthWeekdayOfMonth(year, 5, SATURDAY, 1);
      if (year % 2 === 1) {
        return [contest(date, 'general', null, MAY_ODD)];
      }
      return office.jurisdictionKind === 'county' ? [] : [contest(date, 'general', null, MAY_EVEN)];
    }
    case 'tx_uniform_november':
      return [contest(novemberElectionDay(year), 'general', null, NOVEMBER_UNIFORM)];
    case 'tx_no_public_election':
      return [];
    default:
      throw new RangeError(`tx: unknown schedule ${office.schedule}`);
  }
}

// --- filing tracks ---

const STATEWIDE_TYPES: ReadonlySet<string> = new Set([
  'us-senate',
  'governor',
  'statewide-executive-other',
  'attorney-general',
  'state-treasurer',
  'oil-gas-land-commission',
]);
/** Offices of a district, county or precinct whose type alone places them (§§ 142.007(2), 172.025(2)). */
const DISTRICT_OR_LOCAL_TYPES: ReadonlySet<string> = new Set([
  'us-house',
  'state-senate',
  'state-house',
  'state-education-board',
  'district-attorney',
  'trial-judge',
  'county-executive',
  'county-commission',
  'county-clerk',
  'county-treasurer',
  'county-assessor',
  'sheriff',
  'county-row-other',
]);
const COUNTY_TIER_TYPES: ReadonlySet<string> = new Set([
  'county-commission',
  'county-clerk',
  'sheriff',
  'county-assessor',
  'county-treasurer',
  'county-executive',
]);
const COUNTY_TIER_POPULATION = 200_000;
const FIXED_FEES: Readonly<
  Record<string, { readonly cents: number; readonly citation: Citation }>
> = {
  'us-senate': { cents: 500_000, citation: FEE_US_SENATE },
  governor: { cents: 375_000, citation: FEE_STATEWIDE },
  'statewide-executive-other': { cents: 375_000, citation: FEE_STATEWIDE },
  'attorney-general': { cents: 375_000, citation: FEE_STATEWIDE },
  'state-treasurer': { cents: 375_000, citation: FEE_STATEWIDE },
  'oil-gas-land-commission': { cents: 375_000, citation: FEE_STATEWIDE },
  'us-house': { cents: 312_500, citation: FEE_US_HOUSE },
  'state-senate': { cents: 125_000, citation: FEE_STATE_SENATE },
  'state-house': { cents: 75_000, citation: FEE_STATE_HOUSE },
  'state-education-board': { cents: 30_000, citation: FEE_SBOE },
  'district-attorney': { cents: 125_000, citation: FEE_DISTRICT_ATTORNEY },
};

/** The § 172.024 fee; null where the office type does not tell which item applies (judges, other county offices). */
function primaryFee(office: OfficeRef): Computed<FeeRule> | null {
  const fixed = FIXED_FEES[office.officeTypeId];
  if (fixed !== undefined) {
    return {
      value: { kind: 'fixed', cents: fixed.cents },
      citation: fixed.citation,
    };
  }
  if (COUNTY_TIER_TYPES.has(office.officeTypeId)) {
    const population = office.population;
    if (population === null) {
      return null;
    }
    const cents = population >= COUNTY_TIER_POPULATION ? 125_000 : 75_000;
    return { value: { kind: 'fixed', cents }, citation: FEE_COUNTY_TIER };
  }
  return null;
}

function fixedSignatures(count: number, citation: Citation): Computed<SignatureRule> {
  return { value: { kind: 'fixed', count }, citation };
}

function primaryFiledWith(office: OfficeRef): Computed<string> {
  if (office.jurisdictionKind === 'county' || office.jurisdictionKind === 'party') {
    return {
      value: 'the county chair or the secretary, if any, of the county executive committee',
      citation: PRIMARY_FILED_WITH,
    };
  }
  if (STATEWIDE_TYPES.has(office.officeTypeId)) {
    return { value: 'the state chair', citation: PRIMARY_FILED_WITH };
  }
  return {
    value:
      'the state chair, for an office filled by voters of more than one county; or the county chair or the secretary, if any, of the county executive committee, for an office filled by voters of a single county',
    citation: PRIMARY_FILED_WITH,
  };
}

const SIX_PM: Computed<string> = { value: '18:00', citation: PRIMARY_DEADLINE };

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

function partyPrimaryTrack(office: OfficeRef, primaryYear: number): TrackOut {
  const deadline = primaryDeadline(primaryYear);
  const alternatives: TrackOut['alternatives'] = STATEWIDE_TYPES.has(office.officeTypeId)
    ? [
        {
          kind: 'petition_in_lieu_of_fee',
          signatures: fixedSignatures(5_000, PETITION_IN_LIEU),
        },
      ]
    : DISTRICT_OR_LOCAL_TYPES.has(office.officeTypeId)
      ? [
          {
            kind: 'petition_in_lieu_of_fee',
            signatures: fixedSignatures(500, PETITION_IN_LIEU),
          },
        ]
      : [];
  return {
    ...emptyTrack('party_primary', {
      value: deadline,
      citation: PRIMARY_DEADLINE,
    }),
    // "may not be filed earlier than": the first day is not moved for a weekend (§ 172.023(b)).
    opensOn: { value: daysBefore(deadline, 30), citation: PRIMARY_OPENS },
    closesTime: SIX_PM,
    fee: primaryFee(office),
    alternatives,
    whereToFile: primaryFiledWith(office),
  };
}

function independentSignatures(office: OfficeRef): Computed<SignatureRule> | null {
  if (STATEWIDE_TYPES.has(office.officeTypeId)) {
    return {
      value: { kind: 'percent_of_votes', percent: 1, base: 'last_governor' },
      citation: INDEPENDENT_SIGNATURES,
    };
  }
  if (DISTRICT_OR_LOCAL_TYPES.has(office.officeTypeId)) {
    return fixedSignatures(500, INDEPENDENT_SIGNATURES);
  }
  return null;
}

/** The declaration of intent in the primary filing period, then the petition after the primaries (ch. 142). */
function independentTrack(office: OfficeRef, generalYear: number): TrackOut {
  const deadline = primaryDeadline(generalYear);
  const filedWith =
    office.jurisdictionKind === 'county' ? 'the county judge' : 'the secretary of state';
  return {
    ...emptyTrack('independent', {
      value: deadline,
      citation: INDEPENDENT_DECLARATION,
    }),
    opensOn: {
      value: daysBefore(deadline, 30),
      citation: INDEPENDENT_DECLARATION,
    },
    closesTime: SIX_PM,
    petitionOpens: {
      value: addDays(primaryDay(generalYear), 1),
      citation: INDEPENDENT_PETITION_AFTER_PRIMARY,
    },
    petitionDue: {
      value: lastDay(addDays(runoffPrimaryDay(generalYear), 30)),
      citation: INDEPENDENT_DEADLINE,
    },
    fee: { value: { kind: 'none' }, citation: INDEPENDENT_PETITION_ONLY },
    signatures: independentSignatures(office),
    whereToFile: { value: filedWith, citation: INDEPENDENT_FILED_WITH },
  };
}

/** A local election on a uniform date: the 78th day before at 5 p.m.; the first day does not move. */
function localTrack(office: OfficeRef, electionDay: IsoDate): TrackOut {
  const deadline = lastDay(daysBefore(electionDay, 78));
  const isCity = office.jurisdictionKind === 'city';
  const closing = isCity ? CITY_FILING : DISTRICT_FILING_UNIFORM;
  const hour = isCity ? CITY_FILING : DISTRICT_FILING;
  return {
    ...emptyTrack('nonpartisan', { value: deadline, citation: closing }),
    opensOn: { value: daysBefore(deadline, 30), citation: hour },
    closesTime: { value: '17:00', citation: hour },
    whereToFile: isCity
      ? { value: 'the city secretary', citation: CITY_FILED_WITH }
      : {
          value:
            "the secretary of the political subdivision's governing body or, if the governing body has no secretary, the governing body's presiding officer",
          citation: DISTRICT_FILED_WITH,
        },
  };
}

/**
 * No fee may be asked of a county or precinct chair (§ 172.021(b)). The section's present text is
 * in force from its validFrom; for earlier contests the fee is not known yet.
 */
function partyOfficeFee(contestDate: IsoDate): Computed<FeeRule> | null {
  return contestDate >= PARTY_OFFICE_NO_FEE.validFrom
    ? { value: { kind: 'none' }, citation: PARTY_OFFICE_NO_FEE }
    : null;
}

function partyOfficeTrack(office: OfficeRef, contestRef: ContestRef): TrackOut {
  const deadline = primaryDeadline(yearOf(contestRef.date));
  const precinct = office.officeTypeId === 'party-precinct-committee';
  return {
    ...emptyTrack('party_primary', {
      value: deadline,
      citation: PRIMARY_DEADLINE,
    }),
    opensOn: precinct
      ? { value: daysBefore(deadline, 90), citation: PRECINCT_CHAIR_OPENS }
      : { value: daysBefore(deadline, 30), citation: PRIMARY_OPENS },
    closesTime: SIX_PM,
    fee: partyOfficeFee(contestRef.date),
    whereToFile: {
      value: 'the county chair or the secretary, if any, of the county executive committee',
      citation: PRIMARY_FILED_WITH,
    },
  };
}

function txFilingTracks(office: OfficeRef, contestRef: ContestRef): readonly TrackOut[] {
  switch (office.trackSet) {
    case 'tx_partisan':
      if (contestRef.kind === 'primary') {
        return [partyPrimaryTrack(office, yearOf(contestRef.date))];
      }
      if (contestRef.kind === 'general') {
        return [independentTrack(office, yearOf(contestRef.date))];
      }
      return [];
    case 'tx_local':
      return contestRef.kind === 'general' ? [localTrack(office, contestRef.date)] : [];
    case 'tx_party_office':
      return contestRef.kind === 'primary' ? [partyOfficeTrack(office, contestRef)] : [];
    default:
      throw new RangeError(`tx: unknown track set ${office.trackSet}`);
  }
}

// --- certification ---

function secondThursdayAfter(d: IsoDate): IsoDate {
  return addDays(firstWeekdayAfter(d, THURSDAY), 7);
}
function thirdSaturdayAfter(d: IsoDate): IsoDate {
  return addDays(firstWeekdayAfter(d, SATURDAY), 14);
}

function txCertification(office: OfficeRef, contestRef: ContestRef): Computed<IsoDate> | null {
  const { date, kind } = contestRef;
  switch (office.schedule) {
    case 'tx_state_general':
      if (kind === 'primary') {
        return {
          value: lastDay(addDays(date, 22)),
          citation: PRIMARY_STATE_CANVASS,
        };
      }
      if (kind === 'primary_runoff') {
        return {
          value: thirdSaturdayAfter(date),
          citation: RUNOFF_STATE_CANVASS,
        };
      }
      if (kind === 'general') {
        return {
          value: lastDay(addDays(date, 33)),
          citation: STATE_CANVASS_GENERAL_DAY,
        };
      }
      return null;
    case 'tx_county_general':
      if (kind === 'primary' || kind === 'primary_runoff') {
        return {
          value: secondThursdayAfter(date),
          citation: PRIMARY_LOCAL_CANVASS,
        };
      }
      if (kind === 'general') {
        return {
          value: lastDay(addDays(date, 14)),
          citation: LOCAL_CANVASS_GENERAL_DAY,
        };
      }
      return null;
    case 'tx_party_primary':
      return kind === 'primary' || kind === 'primary_runoff'
        ? { value: secondThursdayAfter(date), citation: PRIMARY_LOCAL_CANVASS }
        : null;
    case 'tx_uniform_may':
    case 'tx_uniform_november': {
      if (kind !== 'general') {
        return null;
      }
      const year = yearOf(date);
      const onGeneralDay = year % 2 === 0 && date === novemberElectionDay(year);
      return onGeneralDay
        ? {
            value: lastDay(addDays(date, 14)),
            citation: LOCAL_CANVASS_GENERAL_DAY,
          }
        : { value: lastDay(addDays(date, 11)), citation: LOCAL_CANVASS };
    }
    case 'tx_no_public_election':
      return null;
    default:
      throw new RangeError(`tx: unknown schedule ${office.schedule}`);
  }
}

export const txRules: StateRules = {
  state: STATE,
  schedules: SCHEDULES,
  trackSets: TRACK_SETS,
  holidays: txHolidays,
  contests: ({ office, year }) => txContests(office, year),
  filingTracks: ({ office, contest: contestRef }) => txFilingTracks(office, contestRef),
  certificationDate: ({ office, contest: contestRef }) => txCertification(office, contestRef),
  // Local Gov't Code § 152.013(a): the commissioners court sets county officers' pay each year.
  countyPay: () => null,
};
