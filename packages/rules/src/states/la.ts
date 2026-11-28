// Louisiana's deadline rules (PIPE-rules-api, PIPE-rules-helpers; D-329, D-330, D-666).
import {
  addDays,
  daysBefore,
  easterSunday,
  firstWeekdayAfter,
  fromDayNumber,
  nthWeekdayOfMonth,
  novemberElectionDay,
  roll,
  selectVersion,
  toDayNumber,
  weekdayOf,
  FRIDAY,
  MONDAY,
  SATURDAY,
  SUNDAY,
  THURSDAY,
  TUESDAY,
  WEDNESDAY,
} from '../dates.ts';
import type { Holiday, HolidayCalendar, Versioned } from '../dates.ts';
import type {
  Citation,
  Computed,
  ContestOut,
  ContestRef,
  FeeRule,
  IsoDate,
  LocalTime,
  OfficeRef,
  SignatureRule,
  StateRules,
  TrackOut,
} from '../types.ts';

// ---------------------------------------------------------------------------------------------
// Sources. Every quote is the exact text of the page the pipeline's fetcher retrieved.

const RS = (d: number): string => `https://legis.la.gov/legis/LawPrint.aspx?d=${String(d)}`;
const URL_18_402 = RS(81545);
const URL_18_419_2 = RS(1432545);
const URL_18_467 = RS(81598);
const URL_18_468 = RS(81600);
const URL_18_464 = RS(81595);
const URL_18_465 = RS(81596);
const URL_18_462 = RS(81593);
const URL_18_410_8 = RS(1341866);
const URL_18_574 = RS(81651);
const URL_18_1280_21 = RS(81288);
const URL_1_55 = RS(74097);
const URL_1_55_1 = RS(1238710);
const URL_ACT_7_2026 = 'https://legis.la.gov/legis/ViewDocument.aspx?d=1473830';
const URL_ACT_640_2024 = 'https://legis.la.gov/legis/ViewDocument.aspx?d=1382369';
const URL_ACT_640_2024_DIGEST = 'https://legis.la.gov/legis/ViewDocument.aspx?d=1388759';

/** Contests from this date are held under the Election Code as Acts 2024, No. 640 left it (its Section 5). */
const NEW_CODE_FROM: IsoDate = '2026-01-01';
const OLD_CODE_TO: IsoDate = '2025-12-31';

function cite(
  citation: string,
  sourceUrl: string,
  quote: string,
  validFrom: IsoDate,
  validTo: IsoDate | null = null,
): Citation {
  return { citation, sourceUrl, quote, validFrom, validTo };
}

// Election dates (R.S. 18:402).
const GUB_FALL_PRIMARY = cite(
  'R.S. 18:402(B)(2)(a)',
  URL_18_402,
  'There shall be a fall primary election held on the third to last Saturday in October of a gubernatorial election year for governor and officers elected at the same time as the governor.',
  '2023-10-14', // earliest published application (the 2023 gubernatorial primary)
);
const GUB_FALL_PRIMARY_FOR_PARTY_OFFICES = cite(
  'R.S. 18:402(B)(2)(a)',
  URL_18_402,
  'This election date shall also serve as the general election date for party primary office to be elected at the gubernatorial election.',
  NEW_CODE_FROM,
);
const GUB_FALL_GENERAL = cite(
  'R.S. 18:402(B)(2)(b)',
  URL_18_402,
  'There shall be a fall general election held on the sixth Saturday after the third to last Saturday in October of a gubernatorial election year.',
  NEW_CODE_FROM,
);
const CONG_FALL_PRIMARY = cite(
  'R.S. 18:402(C)(2)(a)',
  URL_18_402,
  'There shall be a fall primary election held on the first Tuesday after the first Monday in November for officers elected at the same time as members of congress in that year.',
  '2024-11-05', // earliest published application (the 2024 congressional primary)
);
const CONG_FALL_PRIMARY_FOR_PARTY_OFFICES = cite(
  'R.S. 18:402(C)(2)(a)',
  URL_18_402,
  'This election date shall also serve as the general election date for a party primary office to be elected in a congressional election year.',
  NEW_CODE_FROM,
);
const CONG_FALL_GENERAL = cite(
  'R.S. 18:402(C)(2)(b)',
  URL_18_402,
  'There shall be a fall general election held on the sixth Saturday after the first Tuesday after the first Monday in November of a congressional election year.',
  NEW_CODE_FROM,
);
/** Before Acts 2024, No. 640: five weeks from primary to general (the act's digest states the prior law). */
const OLD_FIVE_WEEK_GENERAL = cite(
  'R.S. 18:402 (before Acts 2024, No. 640)',
  URL_ACT_640_2024_DIGEST,
  'Prior law generally provided that there were five weeks between a primary and a general election.',
  '2023-11-18', // earliest published application (the 2023 gubernatorial general)
  OLD_CODE_TO,
);
const GUB_SPRING_PRIMARY = cite(
  'R.S. 18:402(B)(1)(a)',
  URL_18_402,
  'There shall be a spring primary election held on the third Saturday in April for municipal and ward officers elected in the spring of a gubernatorial election year and for candidates in a party primary election for a party primary office to be elected at the gubernatorial election.',
  NEW_CODE_FROM,
);
const GUB_SPRING_SECOND = cite(
  'R.S. 18:402(B)(1)(b)',
  URL_18_402,
  'There shall be a spring election held on the sixth Saturday after the third Saturday in April which shall be a general election for municipal and ward officers elected in the spring of a gubernatorial election year and, if necessary, a second party primary for candidates in a party primary election for a party primary office to be elected at the gubernatorial election.',
  NEW_CODE_FROM,
);
const CONG_SPRING_PRIMARY = cite(
  'R.S. 18:402(C)(1)(a)',
  URL_18_402,
  'election held on the third Saturday in April for municipal and ward officers elected in the spring of a nonpresidential congressional election year and for candidates in a party primary election for a party primary office to be elected in that year.',
  NEW_CODE_FROM,
);
const CONG_SPRING_SECOND = cite(
  'R.S. 18:402(C)(1)(b)',
  URL_18_402,
  'In the spring of a nonpresidential congressional election year, there shall be an election held on the sixth Saturday after the third Saturday in April which shall be a general election for municipal and ward officers and, if necessary, a second party primary for candidates in a party primary election for a party primary office to be elected that year.',
  NEW_CODE_FROM,
);
const PRES_SPRING_PRIMARY = cite(
  'R.S. 18:402(C)(1)(c)',
  URL_18_402,
  'In the spring of a presidential and congressional election year, there shall be a spring primary election held on the last Saturday in March for municipal and ward officers and for candidates in a party primary election for a party primary office to be elected in that year.',
  NEW_CODE_FROM,
);
const PRES_SPRING_SECOND = cite(
  'R.S. 18:402(C)(1)(d)',
  URL_18_402,
  'In the spring of a presidential and congressional election year, there shall be an election held on the sixth Saturday after the last Saturday in March for municipal and ward officers elected and for candidates in a party primary election for a party primary office to be elected in that year.',
  NEW_CODE_FROM,
);
const ODD_SPRING_PRIMARY = cite(
  'R.S. 18:402(D)(1)(a)',
  URL_18_402,
  'There shall be a spring primary election held on the third Saturday in April for municipal and ward officers elected in the spring of a nongubernatorial election year.',
  NEW_CODE_FROM,
);
const ODD_SPRING_GENERAL = cite(
  'R.S. 18:402(D)(1)(b)',
  URL_18_402,
  'There shall be a spring election held on the sixth Saturday after the third Saturday in April which shall be a general election for municipal and ward officers elected in the spring of a nongubernatorial election year.',
  NEW_CODE_FROM,
);
const ODD_FALL_PRIMARY = cite(
  'R.S. 18:402(D)(2)(a)',
  URL_18_402,
  'There shall be a fall primary election held on the second Saturday in October for parochial and municipal officers in a parish containing a municipality with a population of three hundred thousand or more.',
  NEW_CODE_FROM,
);
const ODD_FALL_GENERAL = cite(
  'R.S. 18:402(D)(2)(b)',
  URL_18_402,
  'There shall be a fall general election held on the sixth Saturday after the second Saturday in October of an election year.',
  NEW_CODE_FROM,
);
const FALL_PROHIBITED = cite(
  'R.S. 18:402(A)(1), (2) and (4)',
  URL_18_402,
  'If the date of any fall election falls on any of the above-named days, the election shall be held on the same weekday of the preceding week.',
  NEW_CODE_FROM,
);
const ANY_PROHIBITED = cite(
  'R.S. 18:402(G)(1)',
  URL_18_402,
  'If the date of any election falls on any of the above-named days, the election shall be held on the same day of the preceding week.',
  NEW_CODE_FROM,
);
const SPRING_2026 = cite(
  'R.S. 18:419.2(A)',
  URL_18_419_2,
  'There shall be a spring primary election held on May 16, 2026, for municipal and ward officers elected in the spring of a nonpresidential congressional election year and for candidates in a party primary election for a party primary office to be elected in that year.',
  '2026-01-01',
  '2026-12-31',
);
const SPRING_2026_SECOND = cite(
  'R.S. 18:419.2(A)(2)',
  URL_18_419_2,
  'There shall be a spring general election held on June 27, 2026, for municipal and ward officers and, if necessary, a second party primary for candidates in a party primary election for a party primary office to be elected that year.',
  '2026-01-01',
  '2026-12-31',
);
const PPP = cite(
  'R.S. 18:1280.21(A)',
  URL_18_1280_21,
  'A statewide presidential preference primary election shall be held on the last Saturday in March in 2024 and every fourth year thereafter',
  NEW_CODE_FROM,
);
const HOUSE_2026 = cite(
  'Acts 2026, No. 7, Section 7(B)',
  URL_ACT_7_2026,
  '(B) Candidates for representative in the United States Congress shall be elected at 10 the open primary election to be held on November 3, 2026, and the open general election to 11 be held on December 12, 2026.',
  '2026-01-01',
  '2026-12-31',
);

// Qualifying (R.S. 18:467, 468; Acts 2026, No. 7; R.S. 18:419.2).
const QUAL_GUB_FALL = cite(
  'R.S. 18:467(A)(1)',
  URL_18_467,
  'For candidates in a fall primary election in a gubernatorial election year and those in any special primary election to be held at the same time, on the first Tuesday after the first Monday in August of the year of the election.',
  NEW_CODE_FROM,
);
const QUAL_CONG_FALL = cite(
  'R.S. 18:467(A)(2)',
  URL_18_467,
  'For candidates in a fall primary election in a congressional election year and those in any special primary election to be held at the same time, on the last Wednesday in July of the year of the election.',
  NEW_CODE_FROM,
);
const QUAL_GUB_SPRING = cite(
  'R.S. 18:467(A)(3)',
  URL_18_467,
  'For candidates in a spring primary election in a gubernatorial election year, for all candidates for a party primary office to be elected that year, and those in any special primary election to be held at the same time, on the second Wednesday in January of the year of the election.',
  NEW_CODE_FROM,
);
const QUAL_ORLEANS_FALL = cite(
  'R.S. 18:467(A)(4)',
  URL_18_467,
  'For candidates in a nongubernatorial, odd-numbered year fall primary election for parochial and municipal officers in a parish containing a municipality with a population of three hundred thousand or more and those in any special primary election to be held at the same time, on the second Wednesday in July in the year of the election.',
  NEW_CODE_FROM,
);
const QUAL_PRES_SPRING = cite(
  'R.S. 18:467(A)(5)',
  URL_18_467,
  'For candidates in a spring primary election in a presidential election year and for candidates in a presidential primary election, for all candidates for a party primary office to be elected that year, and those in any special primary election to be held at the same time, the qualifying period shall open on the third Wednesday in December.',
  NEW_CODE_FROM,
);
const QUAL_CONG_SPRING = cite(
  'R.S. 18:467(A)(6)',
  URL_18_467,
  'For candidates in a spring primary election held in a nonpresidential congressional election year, for all candidates for a party primary office to be elected that year, and those in any special primary election to be held at the same time, on the second Wednesday in January of the year of the election.',
  NEW_CODE_FROM,
);
const QUAL_ODD_SPRING = cite(
  'R.S. 18:467(A)(7)',
  URL_18_467,
  'For candidates in a spring primary election held in a nongubernatorial, odd-numbered election year, for all candidates for a party primary office to be elected that year, and those in any special primary election to be held at the same time, on the second Wednesday in January of the year of the election.',
  NEW_CODE_FROM,
);
const QUAL_INDEPENDENT = cite(
  'R.S. 18:467(B)',
  URL_18_467,
  'The qualifying period for candidates qualifying for the general election for a party primary office in the manner provided in R.S. 18:410.8 shall be the qualifying period for candidates qualifying for a party primary office as provided in Subsection A of this Section.',
  NEW_CODE_FROM,
);
/** R.S. 18:467 before Acts 2024, No. 640: the act prints the section with its changes, and its digest states the prior law. */
const OLD_QUAL_GUB_FALL = cite(
  'R.S. 18:467(1) (before Acts 2024, No. 640)',
  URL_ACT_640_2024,
  'and those in any special primary election to be held at the same time, 16 on the first Tuesday after the first Monday in August of the year of the election.',
  '2023-08-08', // earliest published application (the 2023 gubernatorial qualifying period)
  OLD_CODE_TO,
);
const OLD_QUAL_CONG_FALL = cite(
  'R.S. 18:467(2) (before Acts 2024, No. 640)',
  URL_ACT_640_2024_DIGEST,
  'New law changes the opening of qualifying for the fall primary election in a congressional election year from the third Wednesday in July to the last Wednesday in July.',
  '2020-07-15', // earliest published application (the 2020 congressional qualifying period)
  OLD_CODE_TO,
);
const OLD_QUAL_ADVANCED = cite(
  'R.S. 18:467 (before Acts 2024, No. 640)',
  URL_ACT_640_2024_DIGEST,
  'Prior law provided that if the date of a primary election was advanced pursuant to existing law the qualifying period for candidates in the primary election was advanced the same number of weeks as the primary election.',
  '2020-07-15',
  OLD_CODE_TO,
);
const QUAL_SPRING_2026 = cite(
  'R.S. 18:419.2(B)(1)',
  URL_18_419_2,
  'the qualifying period for candidates for the spring primary election in 2026 and for all candidates for a party primary office to be elected in 2026, and those in any special primary election to be held at the same time, shall open on February 11, 2026.',
  '2026-01-01',
  '2026-12-31',
);
const PETITION_SPRING_2026 = cite(
  'R.S. 18:419.2(B)(2)(a)',
  URL_18_419_2,
  'any signature collected on or after September 16, 2025, on a nominating petition for an office for which qualifying opens on February 11, 2026, shall be considered timely.',
  '2026-01-01',
  '2026-12-31',
);
const QUAL_FALL_2026 = cite(
  'Acts 2026, No. 7, Section 7(C)(1)',
  URL_ACT_7_2026,
  '(C)(1) Notwithstanding the provisions of R.S. 18:467, the qualifying period for all 13 candidates in the 2026 fall primary election, including candidates for representative in the 14 United States Congress, shall begin on August 5, 2026. The qualifying period for such 15 candidates shall close at 4:30 p.m. on August 7, 2026.',
  '2026-01-01',
  '2026-12-31',
);
const HOUSE_PETITION_2026 = cite(
  'Acts 2026, No. 7, Section 7(C)(2)',
  URL_ACT_7_2026,
  '(2) Notwithstanding the provisions of R.S. 18:465(C)(3)(b), the number of qualified 17 voters who must timely sign a nominating petition for a candidate for representative in the 18 United States Congress for the 2026 congressional election shall be two hundred fifty.',
  '2026-01-01',
  '2026-12-31',
);
const CLOSE_FRIDAY = cite(
  'R.S. 18:468(A)',
  URL_18_468,
  'The qualifying period for candidates in a primary election shall close at 4:30 p.m. on the Friday after the opening of the qualifying period for candidates in the primary election or, if that Friday is a legal holiday, at 4:30 p.m. on the next day which is not a legal holiday.',
  '2013-06-18', // Acts 2013, No. 383, the last amendment the section's history lists
);
const CLOSE_THURSDAY = cite(
  'R.S. 18:468(B)',
  URL_18_468,
  'Notwithstanding the provisions of Subsection A of this Section, the qualifying period for candidates in a gubernatorial primary election and those in any special primary election to be held at the same time shall close at 4:30 p.m. on the Thursday after the opening of the qualifying period.',
  '2013-06-18',
);
const WHERE_STATE = cite(
  'R.S. 18:462(A)',
  URL_18_462,
  'State candidates shall qualify for a primary election with the secretary of state or a person in his office designated to receive qualifying papers.',
  '2023-10-14',
);
const WHERE_LOCAL = cite(
  'R.S. 18:462(B)',
  URL_18_462,
  'Local and municipal candidates shall qualify for a primary election with the clerk of court for the parish in which the candidate is registered to vote.',
  '2023-10-14',
);
const FEE_STATE = cite(
  'R.S. 18:464(B)(1)',
  URL_18_464,
  'For state candidates -- two thousand five hundred dollars for governor, lieutenant governor, secretary of state, attorney general, treasurer, commissioner of agriculture, and commissioner of insurance; three thousand five hundred dollars for United States senator; one thousand five hundred dollars for United States representative; four hundred fifty dollars for justice of the supreme court, judge of a court of appeal, and member of the public service commission; and six hundred dollars for all other state candidates.',
  '2023-10-14',
);
const FEE_LOCAL = cite(
  'R.S. 18:464(B)(2)',
  URL_18_464,
  'For local candidates -- three hundred dollars for state senator and district judge, two hundred twenty-five dollars for state representative, parish president, and other district or parochial offices, one hundred fifteen dollars for police juror, parish council member, and school board member, and seventy-five dollars for ward and all other local offices.',
  '2023-10-14',
);
const FEE_MUNICIPAL = cite(
  'R.S. 18:464(B)(3)',
  URL_18_464,
  'For municipal candidates -- forty dollars in a municipality with a population of less than five thousand, seventy-five dollars in a municipality with a population of five thousand or more but less than twenty-five thousand, one hundred fifty dollars in a municipality with a population of twenty-five thousand or more but less than fifty thousand, two hundred twenty-five dollars in a municipality with a population of fifty thousand or more but less than one hundred thousand, three hundred dollars in a municipality with a population of one hundred thousand or more but less than three hundred thousand, and three hundred seventy-five dollars in a municipality with a population of three hundred thousand or more. Population for purposes of this Paragraph shall be the population shown by the latest federal decennial census.',
  '2023-10-14',
);
const FEE_COMMITTEE = cite(
  'R.S. 18:464(B)(4)',
  URL_18_464,
  'For candidates for membership on state central committees and parish executive committees of political parties -- seventy-five dollars.',
  '2023-10-14',
);
const FEE_ADDITIONAL = cite(
  'R.S. 18:464(B)(5)',
  URL_18_464,
  'All candidates other than candidates for membership on the state central committee or parish executive committee of a political party, in addition to the qualifying fees established pursuant to Paragraphs (1) through (4) of this Subsection, shall pay an additional qualifying fee of twenty-five dollars.',
  '2023-10-14',
);
/** A fee of Paragraph (1), (2) or (3) with the additional fee of Paragraph (5) it always carries. */
function withAdditionalFee(paragraph: Citation): Citation {
  return cite(
    `${paragraph.citation} and (B)(5)`,
    URL_18_464,
    `${paragraph.quote} ${FEE_ADDITIONAL.quote}`,
    paragraph.validFrom,
  );
}
const FEE_STATE_TOTAL = withAdditionalFee(FEE_STATE);
const FEE_LOCAL_TOTAL = withAdditionalFee(FEE_LOCAL);
const FEE_MUNICIPAL_TOTAL = withAdditionalFee(FEE_MUNICIPAL);
const PETITION_COUNTS = cite(
  'R.S. 18:465(C)',
  URL_18_465,
  'C. Number of signatures required. The number of qualified voters who must timely sign a nominating petition is: (1) For a candidate for an office voted on throughout the state-- two thousand five hundred, not less than two hundred fifty of which shall be from each of the congressional districts into which the state is divided. (2) For a candidate for membership on the Public Service Commission--one thousand from within that district. (3) For a candidate for any of the following offices: (a) Louisiana Supreme Court Justice--one thousand from within that district. (b) United States Representatives in Congress-- seven hundred fifty from within that district. (c) Member of the State Board of Elementary and Secondary Education--one thousand from within that district. (d) Judge of a court of appeal--five hundred from within that district. (e) Any officer elected from throughout a judicial district--five hundred from within the district. (f) Louisiana Senate--five hundred from within the senatorial district. (g) Louisiana House of Representatives--four hundred from within the representative district. (h) Any officer elected from throughout a parish--four hundred.',
  '2023-10-14',
);
const PETITION_MUNICIPAL = cite(
  'R.S. 18:465(C)(4)',
  URL_18_465,
  'For a candidate for a municipal office--fifty in a municipality having a population of five thousand or less, two hundred in a municipality having a population of more than five thousand but less than twenty-five thousand, three hundred in a municipality having a population of twenty-five thousand or more but less than fifty thousand, five hundred in a municipality having a population of fifty thousand or more but less than one hundred thousand, seven hundred fifty in a municipality having a population of one hundred thousand or more but less than three hundred thousand, and one thousand in a municipality having a population of three hundred thousand or more.',
  '2023-10-14',
);
const PETITION_COMMITTEE = cite(
  'R.S. 18:465(C)(5)',
  URL_18_465,
  'For a candidate for membership on a political party committee - the lesser of four hundred or ten percent of the qualified voters in the voting area who are registered as being affiliated with the same political party as the candidate.',
  '2023-10-14',
);
const PETITION_WINDOW = cite(
  'R.S. 18:465(B)',
  URL_18_465,
  'A person may only be nominated as a candidate in a primary election by persons who are registered to vote on the office he seeks who sign a nominating petition for him no more than one hundred twenty days before the qualifying period opens for candidates in the primary election.',
  '2023-10-14',
);
const PETITION_DUE = cite(
  'R.S. 18:465(E)(1)(a)',
  URL_18_465,
  'A nominating petition shall be submitted to the registrars in such parishes not less than thirty days before the qualifying period ends for candidates in the primary election',
  '2023-10-14',
);
const INDEPENDENT_PETITION = cite(
  'R.S. 18:410.8(A)',
  URL_18_410_8,
  'Any person who desires to become a candidate in a general election for a party primary office and who is not registered as being affiliated with a major political party shall file his notice of candidacy, which shall be accompanied by a nominating petition as provided in R.S. 18:465, with the appropriate qualifying official during the qualifying period established for the party primary election.',
  NEW_CODE_FROM,
);
const PROMULGATION = cite(
  'R.S. 18:574(E)',
  URL_18_574,
  'However, if the fourteenth day after the primary or general election falls on a Saturday, Sunday, or other legal holiday, and the secretary of state does not promulgate the returns prior to the fourteenth day after the primary or general election, he shall promulgate the returns on the next day which is not a Saturday, Sunday, or other legal holiday.',
  '2023-10-14',
);

// Holidays (R.S. 1:55, 1:55.1).
const HOLIDAYS_1_55 = cite(
  'R.S. 1:55(A)(1)',
  URL_1_55,
  "The following shall be days of public rest and legal holidays: Sundays; January 1, New Year's Day; January 8, Battle of New Orleans; the third Monday in January, Dr. Martin Luther King, Jr.'s Birthday; the third Monday in February, Washington's Birthday; the day of Mardi Gras; Good Friday; the last Monday in May, National Memorial Day; July 4, Independence Day; August 30, Huey P. Long Day; the first Monday in September, Labor Day; the second Monday in October, Christopher Columbus Day; November 1, All Saints' Day; November 11, Veterans' Day; the fourth Thursday in November, Thanksgiving Day; December 25, Christmas Day;",
  '2021-01-01',
);
const HOLIDAYS_SUNDAY_RULE = cite(
  'R.S. 1:55(A)(4)',
  URL_1_55,
  'Whenever December 25, January 1, or July 4 falls on a Sunday, the next day is a holiday.',
  '2021-01-01',
);
/**
 * Two days R.S. 1:55(A)(1) listed until Acts 2022, No. 452 struck them, effective August 1, 2022
 * (the act's résumé digest); the enrolled act prints them as deletions.
 */
const URL_ACT_452_2022 = 'https://legis.la.gov/legis/ViewDocument.aspx?d=1289512';
const ACT_452_FROM: IsoDate = '2022-08-01';
const ROBERT_E_LEE_DAY = cite(
  'R.S. 1:55(A)(1) (before Acts 2022, No. 452)',
  URL_ACT_452_2022,
  'January 19, Robert E. Lee Day',
  '2021-01-01',
  '2022-07-31',
);
const CONFEDERATE_MEMORIAL_DAY = cite(
  'R.S. 1:55(A)(1) (before Acts 2022, No. 452)',
  URL_ACT_452_2022,
  'June 3, 16 Confederate Memorial Day',
  '2021-01-01',
  '2022-07-31',
);
const JUNETEENTH = cite(
  'R.S. 1:55.1',
  URL_1_55_1,
  'The third Saturday in June, Juneteenth Day, shall be a day of public rest and a legal holiday.',
  '2021-06-01',
);

// ---------------------------------------------------------------------------------------------
// Ids (the rules interface).

const S_GUB = 'la_gubernatorial';
const S_CONG = 'la_congressional';
const S_SPRING = 'la_municipal_spring';
const S_ORLEANS = 'la_orleans_odd_year';
const S_PARTY_CONG = 'la_party_primary_congressional';
const S_PARTY_GUB = 'la_party_primary_gubernatorial';
const S_COMMITTEE = 'la_party_committee';
const S_NONE = 'la_no_public_election';
const T_QUAL = 'la_qualifying';
const T_PARTY = 'la_party_primary';
const T_COMMITTEE = 'la_party_committee';

/** The major political parties whose party primaries the module returns (R.S. 18:410.1, 18:441(C)). */
const PARTY_KEYS = ['democratic', 'republican'] as const;

const FIRST_HOLIDAY_YEAR = 2021;
const LAST_HOLIDAY_YEAR = 2100;

// ---------------------------------------------------------------------------------------------
// Prohibited election days (R.S. 18:402(A) and (G)): Jewish holy days by the fixed Hebrew calendar,
// and days around Labor Day, Easter and Thanksgiving.

const HEBREW_EPOCH_RD = -1_373_427; // fixed day of 1 Tishrei, year 1
const RD_OF_1970 = 719_163;

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function hebrewElapsedDays(year: number): number {
  const months = Math.floor((235 * year - 234) / 19);
  const parts = 12_084 + 13_753 * months;
  const days = 29 * months + Math.floor(parts / 25_920);
  return mod(3 * (days + 1), 7) < 3 ? days + 1 : days;
}

function hebrewYearLengthCorrection(year: number): number {
  const before = hebrewElapsedDays(year - 1);
  const now = hebrewElapsedDays(year);
  const after = hebrewElapsedDays(year + 1);
  if (after - now === 356) {
    return 2;
  }
  return now - before === 382 ? 1 : 0;
}

/** 1 Tishrei of the Hebrew year that begins in the autumn of civil year `civilYear`. */
function roshHashanah(civilYear: number): IsoDate {
  const hebrewYear = civilYear + 3761;
  return fromDayNumber(
    HEBREW_EPOCH_RD +
      hebrewElapsedDays(hebrewYear) +
      hebrewYearLengthCorrection(hebrewYear) -
      RD_OF_1970,
  );
}

function prohibitedDays(year: number): ReadonlySet<IsoDate> {
  const days = new Set<IsoDate>();
  const add = (d: IsoDate, offsets: readonly number[]): void => {
    for (const offset of offsets) {
      days.add(addDays(d, offset));
    }
  };
  const tishrei = roshHashanah(year);
  // Rosh Hashana (1, 2), Yom Kippur (10), Sukkot (15 to 21), Shemini Atzeret (22), Simchat Torah (23).
  add(tishrei, [0, 1, 9, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  const passover = daysBefore(tishrei, 163); // 15 Nisan of the Hebrew year ending this autumn
  add(passover, [0, 1, 6, 7, 50, 51]); // Passover's first and last two days; Shavuot (6, 7 Sivan)
  add(daysBefore(tishrei, 51), [0]); // Tish'a B'Av (9 Av)
  add(nthWeekdayOfMonth(year, 9, MONDAY, 1), [-2, -1]); // the two days preceding Labor Day
  add(easterSunday(year), [-3, -2, -1]); // the three days preceding Easter
  add(nthWeekdayOfMonth(year, 11, THURSDAY, 4), [1, 2, 3]); // the three days following Thanksgiving
  return days;
}

function isProhibited(d: IsoDate): boolean {
  return prohibitedDays(Number(d.slice(0, 4))).has(d);
}

// ---------------------------------------------------------------------------------------------
// Election dates.

type Dated = { readonly date: IsoDate; readonly citation: Citation };
type Cycle = 'gubernatorial' | 'presidential' | 'congressional' | 'odd';

function cycleOf(year: number): Cycle {
  switch (mod(year, 4)) {
    case 3:
      return 'gubernatorial';
    case 0:
      return 'presidential';
    case 2:
      return 'congressional';
    default:
      return 'odd';
  }
}

const sixSaturdaysAfter = (d: IsoDate): IsoDate => addDays(d, 42);

/** The third to last Saturday in October. */
function thirdToLastSaturdayInOctober(year: number): IsoDate {
  return daysBefore(nthWeekdayOfMonth(year, 10, SATURDAY, -1), 14);
}

/** A fall primary and its general under R.S. 18:402(A)(1), (2) and (4): both move back a week together. */
function fallPair(
  primary: Dated,
  general: Dated,
): { readonly primary: Dated; readonly general: Dated } {
  if (isProhibited(primary.date) || isProhibited(general.date)) {
    return {
      primary: { date: daysBefore(primary.date, 7), citation: FALL_PROHIBITED },
      general: { date: daysBefore(general.date, 7), citation: FALL_PROHIBITED },
    };
  }
  return { primary, general };
}

/** A spring date under R.S. 18:402(G)(1). */
function springDate(d: Dated): Dated {
  return isProhibited(d.date) ? { date: daysBefore(d.date, 7), citation: ANY_PROHIBITED } : d;
}

/** The general that follows a fall primary: five weeks before 2026, six from 2026 (Acts 2024, No. 640). */
const FALL_GENERAL_RULE: readonly Versioned<{
  readonly saturdaysAfter: number;
  readonly citation: (cycle: 'gubernatorial' | 'congressional') => Citation;
}>[] = [
  {
    validFrom: '2023-01-01',
    validTo: OLD_CODE_TO,
    rule: { saturdaysAfter: 5, citation: () => OLD_FIVE_WEEK_GENERAL },
  },
  {
    validFrom: NEW_CODE_FROM,
    validTo: null,
    rule: {
      saturdaysAfter: 6,
      citation: (cycle) => (cycle === 'gubernatorial' ? GUB_FALL_GENERAL : CONG_FALL_GENERAL),
    },
  },
];

function nthSaturdayAfter(d: IsoDate, n: number): IsoDate {
  return addDays(firstWeekdayAfter(d, SATURDAY), 7 * (n - 1));
}

/** The fall open primary and general of a gubernatorial or congressional year, or null before the cited texts. */
function fallElections(year: number): { readonly primary: Dated; readonly general: Dated } | null {
  const cycle = cycleOf(year);
  if (cycle !== 'gubernatorial' && cycle !== 'congressional' && cycle !== 'presidential') {
    return null;
  }
  const kind = cycle === 'gubernatorial' ? 'gubernatorial' : 'congressional';
  const primaryDate =
    kind === 'gubernatorial' ? thirdToLastSaturdayInOctober(year) : novemberElectionDay(year);
  const primaryCitation = kind === 'gubernatorial' ? GUB_FALL_PRIMARY : CONG_FALL_PRIMARY;
  if (primaryDate < primaryCitation.validFrom) {
    return null;
  }
  const rule = selectVersion(FALL_GENERAL_RULE, primaryDate);
  return fallPair(
    { date: primaryDate, citation: primaryCitation },
    { date: nthSaturdayAfter(primaryDate, rule.saturdaysAfter), citation: rule.citation(kind) },
  );
}

/** Spring dates fixed for 2026 by R.S. 18:419.2, by year. */
const SPRING_BY_ACT: readonly {
  readonly year: number;
  readonly primary: Dated;
  readonly second: Dated;
}[] = [
  {
    year: 2026,
    primary: { date: '2026-05-16', citation: SPRING_2026 },
    second: { date: '2026-06-27', citation: SPRING_2026_SECOND },
  },
];

/** The spring primary and the election six weeks later (general, or second party primary), from 2026. */
function springElections(year: number): { readonly primary: Dated; readonly second: Dated } | null {
  if (year < Number(NEW_CODE_FROM.slice(0, 4))) {
    return null;
  }
  const fixed = SPRING_BY_ACT.find((entry) => entry.year === year);
  if (fixed !== undefined) {
    return fixed;
  }
  const cycle = cycleOf(year);
  if (cycle === 'presidential') {
    const primary = nthWeekdayOfMonth(year, 3, SATURDAY, -1);
    return {
      primary: springDate({ date: primary, citation: PRES_SPRING_PRIMARY }),
      second: springDate({ date: sixSaturdaysAfter(primary), citation: PRES_SPRING_SECOND }),
    };
  }
  const primary = nthWeekdayOfMonth(year, 4, SATURDAY, 3);
  const citations: Record<Exclude<Cycle, 'presidential'>, readonly [Citation, Citation]> = {
    gubernatorial: [GUB_SPRING_PRIMARY, GUB_SPRING_SECOND],
    congressional: [CONG_SPRING_PRIMARY, CONG_SPRING_SECOND],
    odd: [ODD_SPRING_PRIMARY, ODD_SPRING_GENERAL],
  };
  const [first, second] = citations[cycle];
  return {
    primary: springDate({ date: primary, citation: first }),
    second: springDate({ date: sixSaturdaysAfter(primary), citation: second }),
  };
}

/** Offices whose 2026 party primaries Acts 2026, No. 7 cancelled for an open primary and general, by year. */
const OPEN_BY_ACT: readonly {
  readonly year: number;
  readonly officeTypeId: string;
  readonly primary: Dated;
  readonly general: Dated;
}[] = [
  {
    year: 2026,
    officeTypeId: 'us-house',
    primary: { date: '2026-11-03', citation: HOUSE_2026 },
    general: { date: '2026-12-12', citation: HOUSE_2026 },
  },
];

function openContests(primary: Dated, general: Dated): ContestOut[] {
  return [
    {
      date: primary.date,
      kind: 'primary',
      party: null,
      dateCitation: primary.citation,
      electsOutright: true,
    },
    {
      date: general.date,
      kind: 'general',
      party: null,
      dateCitation: general.citation,
      electsOutright: false,
    },
  ];
}

function closedContests(primary: Dated, second: Dated, general: Dated): ContestOut[] {
  const out: ContestOut[] = [];
  for (const party of PARTY_KEYS) {
    out.push({
      date: primary.date,
      kind: 'primary',
      party,
      dateCitation: primary.citation,
      electsOutright: false,
    });
  }
  for (const party of PARTY_KEYS) {
    out.push({
      date: second.date,
      kind: 'primary_runoff',
      party,
      dateCitation: second.citation,
      electsOutright: false,
    });
  }
  out.push({
    date: general.date,
    kind: 'general',
    party: null,
    dateCitation: general.citation,
    electsOutright: false,
  });
  return out;
}

/** True when the office's contests that year are closed party primaries (R.S. 18:410.1 to 410.10). */
function hasClosedPrimaries(office: OfficeRef, year: number): boolean {
  if (year < Number(NEW_CODE_FROM.slice(0, 4))) {
    return false;
  }
  if (office.schedule === S_PARTY_GUB) {
    return cycleOf(year) === 'gubernatorial';
  }
  if (office.schedule === S_PARTY_CONG) {
    const cycle = cycleOf(year);
    if (cycle !== 'congressional' && cycle !== 'presidential') {
      return false;
    }
    return !OPEN_BY_ACT.some(
      (entry) => entry.year === year && entry.officeTypeId === office.officeTypeId,
    );
  }
  return false;
}

function partyPrimaryContests(office: OfficeRef, year: number, cycle: Cycle): ContestOut[] {
  const wanted = office.schedule === S_PARTY_GUB ? 'gubernatorial' : 'congressional';
  const yearKind = cycle === 'presidential' ? 'congressional' : cycle;
  if (yearKind !== wanted) {
    return [];
  }
  const byAct = OPEN_BY_ACT.find(
    (entry) => entry.year === year && entry.officeTypeId === office.officeTypeId,
  );
  if (byAct !== undefined) {
    return openContests(byAct.primary, byAct.general);
  }
  const fall = fallElections(year);
  if (fall === null) {
    return [];
  }
  if (!hasClosedPrimaries(office, year)) {
    return openContests(fall.primary, fall.general);
  }
  const spring = springElections(year);
  if (spring === null) {
    return [];
  }
  const general: Dated = {
    date: fall.primary.date,
    citation:
      fall.primary.citation === FALL_PROHIBITED
        ? FALL_PROHIBITED
        : wanted === 'gubernatorial'
          ? GUB_FALL_PRIMARY_FOR_PARTY_OFFICES
          : CONG_FALL_PRIMARY_FOR_PARTY_OFFICES,
  };
  return closedContests(spring.primary, spring.second, general);
}

function contestsFor(office: OfficeRef, year: number): readonly ContestOut[] {
  const cycle = cycleOf(year);
  switch (office.schedule) {
    case S_GUB: {
      const fall = cycle === 'gubernatorial' ? fallElections(year) : null;
      return fall === null ? [] : openContests(fall.primary, fall.general);
    }
    case S_CONG: {
      const fall =
        cycle === 'congressional' || cycle === 'presidential' ? fallElections(year) : null;
      return fall === null ? [] : openContests(fall.primary, fall.general);
    }
    case S_SPRING: {
      const spring = springElections(year);
      return spring === null ? [] : openContests(spring.primary, spring.second);
    }
    case S_ORLEANS: {
      if (cycle !== 'odd' || year < Number(NEW_CODE_FROM.slice(0, 4))) {
        return [];
      }
      const primary = nthWeekdayOfMonth(year, 10, SATURDAY, 2);
      const pair = fallPair(
        { date: primary, citation: ODD_FALL_PRIMARY },
        { date: sixSaturdaysAfter(primary), citation: ODD_FALL_GENERAL },
      );
      return openContests(pair.primary, pair.general);
    }
    case S_PARTY_CONG:
    case S_PARTY_GUB:
      return partyPrimaryContests(office, year, cycle);
    case S_COMMITTEE: {
      if (cycle !== 'presidential' || year < Number(NEW_CODE_FROM.slice(0, 4))) {
        return [];
      }
      const ppp = springDate({ date: nthWeekdayOfMonth(year, 3, SATURDAY, -1), citation: PPP });
      return PARTY_KEYS.map((party): ContestOut => ({
        date: ppp.date,
        kind: 'primary',
        party,
        dateCitation: ppp.citation,
        electsOutright: true,
      }));
    }
    case S_NONE:
      return [];
    default:
      throw new RangeError(`la: unknown schedule ${office.schedule}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Qualifying.

type Period = {
  readonly opens: Computed<IsoDate>;
  readonly closes: Computed<IsoDate>;
  readonly closesTime: Computed<LocalTime>;
};

function fridayClose(opens: IsoDate): Period['closes'] {
  let close = firstWeekdayAfter(opens, FRIDAY);
  const calendar = mergedHolidays(Number(close.slice(0, 4)));
  const isLegalHoliday = (d: IsoDate): boolean =>
    weekdayOf(d) === SUNDAY || calendar.holidays.some((holiday) => holiday.date === d);
  if (isLegalHoliday(close)) {
    do {
      close = addDays(close, 1);
    } while (isLegalHoliday(close));
  }
  return { value: close, citation: CLOSE_FRIDAY };
}

function closedWeekPeriod(opens: Computed<IsoDate>, thursday: boolean): Period {
  if (thursday) {
    return {
      opens,
      closes: { value: firstWeekdayAfter(opens.value, THURSDAY), citation: CLOSE_THURSDAY },
      closesTime: { value: '16:30', citation: CLOSE_THURSDAY },
    };
  }
  return {
    opens,
    closes: fridayClose(opens.value),
    closesTime: { value: '16:30', citation: CLOSE_FRIDAY },
  };
}

/** Qualifying periods fixed by act for one year, by the fall or spring primary they serve. */
const QUALIFYING_BY_ACT: readonly {
  readonly year: number;
  readonly season: 'fall' | 'spring';
  readonly period: Period;
  readonly petitionOpens: Computed<IsoDate> | null;
}[] = [
  {
    year: 2026,
    season: 'fall',
    period: {
      opens: { value: '2026-08-05', citation: QUAL_FALL_2026 },
      closes: { value: '2026-08-07', citation: QUAL_FALL_2026 },
      closesTime: { value: '16:30', citation: QUAL_FALL_2026 },
    },
    petitionOpens: null,
  },
  {
    year: 2026,
    season: 'spring',
    period: {
      opens: { value: '2026-02-11', citation: QUAL_SPRING_2026 },
      closes: { value: '2026-02-13', citation: CLOSE_FRIDAY },
      closesTime: { value: '16:30', citation: CLOSE_FRIDAY },
    },
    petitionOpens: { value: '2025-09-16', citation: PETITION_SPRING_2026 },
  },
];

function requireNewCode(contest: ContestRef): void {
  if (contest.date < NEW_CODE_FROM) {
    throw new RangeError(`la: no cited qualifying rule for a contest on ${contest.date}`);
  }
}

/**
 * The qualifying period of a fall open primary before 2026 (R.S. 18:467(1), (2) before Acts 2024,
 * No. 640): advanced as many weeks as the primary was advanced from its regular day.
 */
function oldFallPeriod(contest: ContestRef): Period {
  const year = Number(contest.date.slice(0, 4));
  const gubernatorial = cycleOf(year) === 'gubernatorial';
  const opening: Computed<IsoDate> = gubernatorial
    ? {
        value: firstWeekdayAfter(nthWeekdayOfMonth(year, 8, MONDAY, 1), TUESDAY),
        citation: OLD_QUAL_GUB_FALL,
      }
    : { value: nthWeekdayOfMonth(year, 7, WEDNESDAY, 3), citation: OLD_QUAL_CONG_FALL };
  if (contest.date < opening.citation.validFrom) {
    throw new RangeError(`la: no cited qualifying rule for a contest on ${contest.date}`);
  }
  const regular = gubernatorial ? thirdToLastSaturdayInOctober(year) : novemberElectionDay(year);
  const weeks = (toDayNumber(regular) - toDayNumber(contest.date)) / 7;
  const opens =
    Number.isInteger(weeks) && weeks > 0
      ? { value: daysBefore(opening.value, 7 * weeks), citation: OLD_QUAL_ADVANCED }
      : opening;
  return closedWeekPeriod(opens, gubernatorial);
}

/** The qualifying period of a fall open primary on `schedule` (R.S. 18:467(A)(1), (2), (4)). */
function fallPeriod(schedule: string, contest: ContestRef): Period {
  if (contest.date < NEW_CODE_FROM && schedule !== S_ORLEANS) {
    return oldFallPeriod(contest);
  }
  requireNewCode(contest);
  const year = Number(contest.date.slice(0, 4));
  const byAct = QUALIFYING_BY_ACT.find((entry) => entry.year === year && entry.season === 'fall');
  if (byAct !== undefined && schedule !== S_ORLEANS) {
    return byAct.period;
  }
  if (schedule === S_ORLEANS) {
    return closedWeekPeriod(
      { value: nthWeekdayOfMonth(year, 7, WEDNESDAY, 2), citation: QUAL_ORLEANS_FALL },
      false,
    );
  }
  if (cycleOf(year) === 'gubernatorial') {
    return closedWeekPeriod(
      {
        value: firstWeekdayAfter(nthWeekdayOfMonth(year, 8, MONDAY, 1), TUESDAY),
        citation: QUAL_GUB_FALL,
      },
      true,
    );
  }
  return closedWeekPeriod(
    { value: nthWeekdayOfMonth(year, 7, WEDNESDAY, -1), citation: QUAL_CONG_FALL },
    false,
  );
}

/** The qualifying period of a spring primary and of a year's party primary offices (R.S. 18:467(A)(3), (5) to (7)). */
function springPeriod(contestYear: number): {
  readonly period: Period;
  readonly petitionOpens: Computed<IsoDate> | null;
} {
  const byAct = QUALIFYING_BY_ACT.find(
    (entry) => entry.year === contestYear && entry.season === 'spring',
  );
  if (byAct !== undefined) {
    return byAct;
  }
  const cycle = cycleOf(contestYear);
  if (cycle === 'presidential') {
    return {
      period: closedWeekPeriod(
        { value: nthWeekdayOfMonth(contestYear - 1, 12, WEDNESDAY, 3), citation: QUAL_PRES_SPRING },
        false,
      ),
      petitionOpens: null,
    };
  }
  const citation =
    cycle === 'gubernatorial'
      ? QUAL_GUB_SPRING
      : cycle === 'congressional'
        ? QUAL_CONG_SPRING
        : QUAL_ODD_SPRING;
  return {
    period: closedWeekPeriod(
      { value: nthWeekdayOfMonth(contestYear, 1, WEDNESDAY, 2), citation },
      false,
    ),
    petitionOpens: null,
  };
}

// Fees (R.S. 18:464(B)) and nominating petitions (R.S. 18:465(C)), in cents and signatures.
const STATE_CANDIDATE_TYPES: ReadonlySet<string> = new Set([
  'governor',
  'statewide-executive-other',
  'attorney-general',
  'secretary-of-state',
  'state-treasurer',
  'insurance-commissioner',
  'us-senate',
  'us-house',
  'state-appellate-judge',
  'utility-commission',
  'state-education-board',
]);
const ADDITIONAL_FEE_CENTS = 2_500;
const FEE_DOLLARS: Readonly<Record<string, number>> = {
  governor: 2_500,
  'statewide-executive-other': 2_500,
  'attorney-general': 2_500,
  'secretary-of-state': 2_500,
  'state-treasurer': 2_500,
  'insurance-commissioner': 2_500,
  'us-senate': 3_500,
  'us-house': 1_500,
  'state-appellate-judge': 450,
  'utility-commission': 450,
  'state-education-board': 600,
  'state-senate': 300,
  'state-house': 225,
  'county-executive': 225,
  sheriff: 225,
  'district-attorney': 225,
  'county-clerk': 225,
  'county-assessor': 225,
  'county-commission': 115,
  'school-board': 115,
};
const MUNICIPAL_TYPES: ReadonlySet<string> = new Set(['mayor', 'city-council', 'city-officer']);
/** [population below which the tier applies, fee in dollars] (R.S. 18:464(B)(3)). */
const MUNICIPAL_FEE_TIERS: readonly (readonly [number, number])[] = [
  [5_000, 40],
  [25_000, 75],
  [50_000, 150],
  [100_000, 225],
  [300_000, 300],
  [Number.POSITIVE_INFINITY, 375],
];
/** [highest population of the tier, signatures] (R.S. 18:465(C)(4)). */
const MUNICIPAL_PETITION_TIERS: readonly (readonly [number, number])[] = [
  [5_000, 50],
  [24_999, 200],
  [49_999, 300],
  [99_999, 500],
  [299_999, 750],
  [Number.POSITIVE_INFINITY, 1_000],
];
const PETITION_SIGNATURES: Readonly<Record<string, number>> = {
  governor: 2_500,
  'statewide-executive-other': 2_500,
  'attorney-general': 2_500,
  'secretary-of-state': 2_500,
  'state-treasurer': 2_500,
  'insurance-commissioner': 2_500,
  'us-senate': 2_500,
  'us-house': 750,
  'utility-commission': 1_000,
  'state-education-board': 1_000,
  'state-senate': 500,
  'state-house': 400,
  'district-attorney': 500,
  sheriff: 400,
  'county-clerk': 400,
  'county-assessor': 400,
  'county-executive': 400,
};
/** Justices of the supreme court are on a party primary schedule; judges of a court of appeal are not. */
const SUPREME_COURT_SIGNATURES = 1_000;
const COURT_OF_APPEAL_SIGNATURES = 500;

function feeFor(office: OfficeRef): Computed<FeeRule> | null {
  if (MUNICIPAL_TYPES.has(office.officeTypeId)) {
    const population = office.population;
    if (population === null) {
      return null;
    }
    const tier = MUNICIPAL_FEE_TIERS.find(([below]) => population < below);
    return tier === undefined
      ? null
      : {
          value: { kind: 'fixed', cents: tier[1] * 100 + ADDITIONAL_FEE_CENTS },
          citation: FEE_MUNICIPAL_TOTAL,
        };
  }
  const dollars = FEE_DOLLARS[office.officeTypeId];
  return dollars === undefined
    ? null
    : {
        value: { kind: 'fixed', cents: dollars * 100 + ADDITIONAL_FEE_CENTS },
        citation: STATE_CANDIDATE_TYPES.has(office.officeTypeId)
          ? FEE_STATE_TOTAL
          : FEE_LOCAL_TOTAL,
      };
}

function signaturesFor(office: OfficeRef, contestYear: number): Computed<SignatureRule> | null {
  if (
    office.officeTypeId === 'us-house' &&
    contestYear === 2026 &&
    office.schedule === S_PARTY_CONG
  ) {
    const open = OPEN_BY_ACT.some(
      (entry) => entry.year === contestYear && entry.officeTypeId === 'us-house',
    );
    if (open) {
      return { value: { kind: 'fixed', count: 250 }, citation: HOUSE_PETITION_2026 };
    }
  }
  if (MUNICIPAL_TYPES.has(office.officeTypeId)) {
    const population = office.population;
    if (population === null) {
      return null;
    }
    const tier = MUNICIPAL_PETITION_TIERS.find(([highest]) => population <= highest);
    return tier === undefined
      ? null
      : { value: { kind: 'fixed', count: tier[1] }, citation: PETITION_MUNICIPAL };
  }
  if (office.officeTypeId === 'state-appellate-judge') {
    const count =
      office.schedule === S_PARTY_CONG ? SUPREME_COURT_SIGNATURES : COURT_OF_APPEAL_SIGNATURES;
    return { value: { kind: 'fixed', count }, citation: PETITION_COUNTS };
  }
  const count = PETITION_SIGNATURES[office.officeTypeId];
  return count === undefined
    ? null
    : { value: { kind: 'fixed', count }, citation: PETITION_COUNTS };
}

function whereToFile(office: OfficeRef): Computed<string> {
  return STATE_CANDIDATE_TYPES.has(office.officeTypeId)
    ? { value: 'the secretary of state', citation: WHERE_STATE }
    : {
        value: 'the clerk of court for the parish in which the candidate is registered to vote',
        citation: WHERE_LOCAL,
      };
}

function track(
  kind: TrackOut['track'],
  period: Period,
  office: OfficeRef,
  contestYear: number,
): TrackOut {
  const signatures = signaturesFor(office, contestYear);
  return {
    track: kind,
    opensOn: period.opens,
    closesOn: period.closes,
    closesTime: period.closesTime,
    petitionOpens: null,
    petitionDue: null,
    fee: feeFor(office),
    signatures: null,
    alternatives: signatures === null ? [] : [{ kind: 'petition_in_lieu_of_fee', signatures }],
    whereToFile: whereToFile(office),
    withdrawalDeadline: null,
  };
}

function openPrimaryTrack(office: OfficeRef, contest: ContestRef, schedule: string): TrackOut {
  const year = Number(contest.date.slice(0, 4));
  const period = schedule === S_SPRING ? springPeriod(year).period : fallPeriod(schedule, contest);
  return track('nonpartisan', period, office, year);
}

function qualifyingTracks(office: OfficeRef, contest: ContestRef): readonly TrackOut[] {
  if (contest.kind !== 'primary' || contest.party !== null) {
    return [];
  }
  switch (office.schedule) {
    case S_GUB:
    case S_CONG:
      return [openPrimaryTrack(office, contest, office.schedule)];
    case S_SPRING:
    case S_ORLEANS:
      requireNewCode(contest);
      return [openPrimaryTrack(office, contest, office.schedule)];
    default:
      return [];
  }
}

function partyPrimaryTracks(office: OfficeRef, contest: ContestRef): readonly TrackOut[] {
  const year = Number(contest.date.slice(0, 4));
  if (contest.kind === 'primary_runoff' || contest.kind === 'general_runoff') {
    return [];
  }
  if (!hasClosedPrimaries(office, year)) {
    if (contest.kind !== 'primary' || contest.party !== null) {
      return [];
    }
    const cycleSchedule = office.schedule === S_PARTY_GUB ? S_GUB : S_CONG;
    return [openPrimaryTrack(office, contest, cycleSchedule)];
  }
  const { period, petitionOpens } = springPeriod(year);
  if (contest.kind === 'primary' && contest.party !== null) {
    return [track('party_primary', period, office, year)];
  }
  if (contest.kind === 'general') {
    const signatures = signaturesFor(office, year);
    return [
      {
        track: 'independent',
        opensOn: { value: period.opens.value, citation: QUAL_INDEPENDENT },
        closesOn: period.closes,
        closesTime: period.closesTime,
        petitionOpens: petitionOpens ?? {
          value: daysBefore(period.opens.value, 120),
          citation: PETITION_WINDOW,
        },
        petitionDue: { value: daysBefore(period.closes.value, 30), citation: PETITION_DUE },
        fee: null,
        signatures:
          signatures === null ? null : { value: signatures.value, citation: INDEPENDENT_PETITION },
        alternatives: [],
        whereToFile: whereToFile(office),
        withdrawalDeadline: null,
      },
    ];
  }
  return [];
}

function committeeTracks(contest: ContestRef): readonly TrackOut[] {
  if (contest.kind !== 'primary') {
    return [];
  }
  requireNewCode(contest);
  const { period } = springPeriod(Number(contest.date.slice(0, 4)));
  return [
    {
      track: 'party_primary',
      opensOn: period.opens,
      closesOn: period.closes,
      closesTime: period.closesTime,
      petitionOpens: null,
      petitionDue: null,
      fee: { value: { kind: 'fixed', cents: 7_500 }, citation: FEE_COMMITTEE },
      signatures: null,
      alternatives: [
        {
          kind: 'petition_in_lieu_of_fee',
          signatures: { value: { kind: 'fixed', count: 400 }, citation: PETITION_COMMITTEE },
        },
      ],
      whereToFile: null,
      withdrawalDeadline: null,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Holidays (R.S. 1:55(A)(1) and (4), 1:55.1).

function holidayList(year: number): readonly Holiday[] {
  const day = (month: number, d: number): IsoDate =>
    `${String(year)}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const easter = easterSunday(year);
  const listed: { date: IsoDate; name: string; citation: Citation }[] = [
    { date: day(1, 1), name: "New Year's Day", citation: HOLIDAYS_1_55 },
    { date: day(1, 8), name: 'Battle of New Orleans', citation: HOLIDAYS_1_55 },
    {
      date: nthWeekdayOfMonth(year, 1, MONDAY, 3),
      name: "Dr. Martin Luther King, Jr.'s Birthday",
      citation: HOLIDAYS_1_55,
    },
    {
      date: nthWeekdayOfMonth(year, 2, MONDAY, 3),
      name: "Washington's Birthday",
      citation: HOLIDAYS_1_55,
    },
    { date: daysBefore(easter, 47), name: 'Mardi Gras', citation: HOLIDAYS_1_55 },
    { date: daysBefore(easter, 2), name: 'Good Friday', citation: HOLIDAYS_1_55 },
    {
      date: nthWeekdayOfMonth(year, 5, MONDAY, -1),
      name: 'National Memorial Day',
      citation: HOLIDAYS_1_55,
    },
    { date: nthWeekdayOfMonth(year, 6, SATURDAY, 3), name: 'Juneteenth Day', citation: JUNETEENTH },
    { date: day(7, 4), name: 'Independence Day', citation: HOLIDAYS_1_55 },
    { date: day(8, 30), name: 'Huey P. Long Day', citation: HOLIDAYS_1_55 },
    { date: nthWeekdayOfMonth(year, 9, MONDAY, 1), name: 'Labor Day', citation: HOLIDAYS_1_55 },
    {
      date: nthWeekdayOfMonth(year, 10, MONDAY, 2),
      name: 'Christopher Columbus Day',
      citation: HOLIDAYS_1_55,
    },
    { date: day(11, 1), name: "All Saints' Day", citation: HOLIDAYS_1_55 },
    { date: day(11, 11), name: "Veterans' Day", citation: HOLIDAYS_1_55 },
    {
      date: nthWeekdayOfMonth(year, 11, THURSDAY, 4),
      name: 'Thanksgiving Day',
      citation: HOLIDAYS_1_55,
    },
    { date: day(12, 25), name: 'Christmas Day', citation: HOLIDAYS_1_55 },
  ];
  for (const [month, d, name, citation] of [
    [1, 19, 'Robert E. Lee Day', ROBERT_E_LEE_DAY],
    [6, 3, 'Confederate Memorial Day', CONFEDERATE_MEMORIAL_DAY],
  ] as const) {
    if (day(month, d) < ACT_452_FROM) {
      listed.push({ date: day(month, d), name, citation });
    }
  }
  for (const [month, d, name] of [
    [1, 1, "New Year's Day"],
    [7, 4, 'Independence Day'],
    [12, 25, 'Christmas Day'],
  ] as const) {
    if (weekdayOf(day(month, d)) === SUNDAY) {
      listed.push({
        date: addDays(day(month, d), 1),
        name: `${name} (observed)`,
        citation: HOLIDAYS_SUNDAY_RULE,
      });
    }
  }
  return listed.sort((a, b) => toDayNumber(a.date) - toDayNumber(b.date));
}

function laHolidays(year: number): HolidayCalendar {
  if (!Number.isInteger(year) || year < FIRST_HOLIDAY_YEAR || year > LAST_HOLIDAY_YEAR) {
    throw new RangeError(`la: no holiday calendar for ${String(year)}`);
  }
  return { state: 'LA', year, holidays: holidayList(year) };
}

/** The year's calendar with the next year's, for a roll that can cross December 31. */
function mergedHolidays(year: number): HolidayCalendar {
  const next = year < LAST_HOLIDAY_YEAR ? laHolidays(year + 1).holidays : [];
  return { state: 'LA', year, holidays: [...laHolidays(year).holidays, ...next] };
}

// ---------------------------------------------------------------------------------------------

export const laRules: StateRules = {
  state: 'LA',
  schedules: [S_GUB, S_CONG, S_SPRING, S_ORLEANS, S_PARTY_CONG, S_PARTY_GUB, S_COMMITTEE, S_NONE],
  trackSets: [T_QUAL, T_PARTY, T_COMMITTEE],
  holidays: laHolidays,
  contests: ({ office, year }) => contestsFor(office, year),
  filingTracks: ({ office, contest }) => {
    switch (office.trackSet) {
      case T_QUAL:
        return qualifyingTracks(office, contest);
      case T_PARTY:
        return partyPrimaryTracks(office, contest);
      case T_COMMITTEE:
        return committeeTracks(contest);
      default:
        throw new RangeError(`la: unknown track set ${office.trackSet}`);
    }
  },
  certificationDate: ({ contest }) => {
    const fourteenth = addDays(contest.date, 14);
    return {
      value: roll(fourteenth, 'next_business_day', mergedHolidays(Number(fourteenth.slice(0, 4)))),
      citation: PROMULGATION,
    };
  },
  countyPay: () => null,
};
