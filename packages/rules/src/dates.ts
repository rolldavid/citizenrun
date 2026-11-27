// Calendar arithmetic on IsoDate strings through an integer day number (PIPE-rules-helpers, D-330).
// No Date object and no zone is ever involved.
import { assertNever } from '@citizenrun/shared';
import type { Citation, IsoDate } from './types.ts';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 Sunday ... 6 Saturday
export const SUNDAY = 0,
  MONDAY = 1,
  TUESDAY = 2,
  WEDNESDAY = 3,
  THURSDAY = 4,
  FRIDAY = 5,
  SATURDAY = 6;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Days from 0000-03-01 to 1970-01-01 in the proleptic Gregorian calendar. */
const EPOCH_SHIFT = 719_468;
const DAYS_PER_ERA = 146_097; // 400 Gregorian years

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError(`Not a four-digit year: ${String(year)}`);
  }
}

function assertMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Not a month: ${String(month)}`);
  }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function civilToDays(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * DAYS_PER_ERA + dayOfEra - EPOCH_SHIFT;
}

/** Days since 1970-01-01 (proleptic Gregorian); RangeError unless `d` is a real YYYY-MM-DD date. */
export function toDayNumber(d: IsoDate): number {
  const match = ISO_DATE.exec(d);
  if (match === null) {
    throw new RangeError(`Not a YYYY-MM-DD date: ${d}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Not a calendar date: ${d}`);
  }
  return civilToDays(year, month, day);
}

/** The YYYY-MM-DD date of a day number; RangeError outside years 0000 to 9999. */
export function fromDayNumber(n: number): IsoDate {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Not a day number: ${String(n)}`);
  }
  const z = n + EPOCH_SHIFT;
  const era = Math.floor(z / DAYS_PER_ERA);
  const dayOfEra = z - era * DAYS_PER_ERA;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  assertYear(year);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Not a whole number of days: ${String(n)}`);
  }
  return fromDayNumber(toDayNumber(d) + n);
}

/** addDays(anchor, -n): "the 78th day before". */
export function daysBefore(anchor: IsoDate, n: number): IsoDate {
  return addDays(anchor, -n);
}

export function weekdayOf(d: IsoDate): Weekday {
  // 1970-01-01 was a Thursday.
  return ((((toDayNumber(d) + THURSDAY) % 7) + 7) % 7) as Weekday;
}

/** n = 1..5 for first to fifth, -1 for last. Throws when the month has no such day. */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: Weekday,
  n: 1 | 2 | 3 | 4 | 5 | -1,
): IsoDate {
  assertYear(year);
  assertMonth(month);
  if (n === -1) {
    const last = `${pad(year, 4)}-${pad(month, 2)}-${pad(daysInMonth(year, month), 2)}`;
    return daysBefore(last, (weekdayOf(last) - weekday + 7) % 7);
  }
  const first = firstWeekdayOnOrAfter(`${pad(year, 4)}-${pad(month, 2)}-01`, weekday);
  const date = addDays(first, 7 * (n - 1));
  if (date.slice(0, 7) !== first.slice(0, 7)) {
    throw new RangeError(
      `${pad(year, 4)}-${pad(month, 2)} has no weekday ${String(weekday)} number ${String(n)}`,
    );
  }
  return date;
}

export function firstWeekdayOnOrAfter(d: IsoDate, weekday: Weekday): IsoDate {
  return addDays(d, (weekday - weekdayOf(d) + 7) % 7);
}

/** Strictly after: "the first Tuesday after the first Monday". */
export function firstWeekdayAfter(d: IsoDate, weekday: Weekday): IsoDate {
  return firstWeekdayOnOrAfter(addDays(d, 1), weekday);
}

/** The first Tuesday after the first Monday in November: the one November-date helper (D-500). */
export function novemberElectionDay(year: number): IsoDate {
  return firstWeekdayAfter(nthWeekdayOfMonth(year, 11, MONDAY, 1), TUESDAY);
}

const FIRST_EASTER_YEAR = 1900;
const LAST_EASTER_YEAR = 2100;

/** Gregorian Easter Sunday (the anonymous Gregorian algorithm). Throws RangeError outside 1900 to 2100. */
export function easterSunday(year: number): IsoDate {
  if (!Number.isInteger(year) || year < FIRST_EASTER_YEAR || year > LAST_EASTER_YEAR) {
    throw new RangeError(`No Easter date for ${String(year)}`);
  }
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export type Holiday = {
  readonly date: IsoDate;
  readonly name: string;
  readonly citation: Citation;
};
export type HolidayCalendar = {
  readonly state: string;
  readonly year: number;
  readonly holidays: readonly Holiday[];
};

/** 5 U.S.C. 6103(a), copied from the official text of the section. */
const FEDERAL_HOLIDAYS_CITATION: Citation = {
  citation: '5 U.S.C. 6103',
  sourceUrl: 'https://uscode.house.gov/us/usc/t5/s6103/',
  quote:
    'The following are legal public holidays:New Year’s Day, January 1.\n' +
    'Birthday of Martin Luther King, Jr., the third Monday in January.\n' +
    'Washington’s Birthday, the third Monday in February.\n' +
    'Memorial Day, the last Monday in May.\n' +
    'Juneteenth National Independence Day, June 19.\n' +
    'Independence Day, July 4.\n' +
    'Labor Day, the first Monday in September.\n' +
    'Columbus Day, the second Monday in October.\n' +
    'Veterans Day, November 11.\n' +
    'Thanksgiving Day, the fourth Thursday in November.\n' +
    'Christmas Day, December 25.',
  validFrom: '2021-06-17',
  validTo: null,
};

const FIRST_FEDERAL_HOLIDAY_YEAR = 2021;
const LAST_FEDERAL_HOLIDAY_YEAR = 2100;

function dateIn(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The statute's date of each holiday in `year`, before the weekend rule. */
function statutoryHolidays(year: number): readonly { date: IsoDate; name: string }[] {
  return [
    { date: dateIn(year, 1, 1), name: 'New Year’s Day' },
    { date: nthWeekdayOfMonth(year, 1, MONDAY, 3), name: 'Birthday of Martin Luther King, Jr.' },
    { date: nthWeekdayOfMonth(year, 2, MONDAY, 3), name: 'Washington’s Birthday' },
    { date: nthWeekdayOfMonth(year, 5, MONDAY, -1), name: 'Memorial Day' },
    { date: dateIn(year, 6, 19), name: 'Juneteenth National Independence Day' },
    { date: dateIn(year, 7, 4), name: 'Independence Day' },
    { date: nthWeekdayOfMonth(year, 9, MONDAY, 1), name: 'Labor Day' },
    { date: nthWeekdayOfMonth(year, 10, MONDAY, 2), name: 'Columbus Day' },
    { date: dateIn(year, 11, 11), name: 'Veterans Day' },
    { date: nthWeekdayOfMonth(year, 11, THURSDAY, 4), name: 'Thanksgiving Day' },
    { date: dateIn(year, 12, 25), name: 'Christmas Day' },
  ];
}

/** A Saturday holiday is observed the Friday before, a Sunday holiday the Monday after (5 U.S.C. 6103(b)). */
function observed(date: IsoDate): IsoDate {
  const weekday = weekdayOf(date);
  if (weekday === SATURDAY) {
    return daysBefore(date, 1);
  }
  if (weekday === SUNDAY) {
    return addDays(date, 1);
  }
  return date;
}

/**
 * Federal legal public holidays with their observed dates (5 U.S.C. 6103), for states whose
 * statute adopts them: every observed date that falls in `year`, so New Year's Day of the next
 * year observed on December 31 is in this year's list. RangeError outside 2021 to 2100.
 */
export function federalHolidays(year: number): readonly Holiday[] {
  if (
    !Number.isInteger(year) ||
    year < FIRST_FEDERAL_HOLIDAY_YEAR ||
    year > LAST_FEDERAL_HOLIDAY_YEAR
  ) {
    throw new RangeError(`No federal holiday list for ${String(year)}`);
  }
  const prefix = `${pad(year, 4)}-`;
  return [...statutoryHolidays(year), ...statutoryHolidays(year + 1)]
    .map(({ date, name }) => ({ date: observed(date), name, citation: FEDERAL_HOLIDAYS_CITATION }))
    .filter((holiday) => holiday.date.startsWith(prefix))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Not a Saturday, not a Sunday, and not the date of any holiday in `cal`, whatever its year. */
export function isBusinessDay(d: IsoDate, cal: HolidayCalendar): boolean {
  const weekday = weekdayOf(d);
  if (weekday === SATURDAY || weekday === SUNDAY) {
    return false;
  }
  return !cal.holidays.some((holiday) => holiday.date === d);
}

export type Roll = 'none' | 'next_business_day' | 'previous_business_day';

export function roll(d: IsoDate, rule: Roll, cal: HolidayCalendar): IsoDate {
  switch (rule) {
    case 'none':
      toDayNumber(d);
      return d;
    case 'next_business_day':
    case 'previous_business_day': {
      const step = rule === 'next_business_day' ? 1 : -1;
      let date = d;
      while (!isBusinessDay(date, cal)) {
        date = addDays(date, step);
      }
      return date;
    }
    default:
      return assertNever(rule);
  }
}

export type Versioned<T> = {
  readonly validFrom: IsoDate;
  readonly validTo: IsoDate | null;
  readonly rule: T;
};

/** The version in force for a contest date (both ends inclusive); throws when none or more than one applies. */
export function selectVersion<T>(versions: readonly Versioned<T>[], contestDate: IsoDate): T {
  toDayNumber(contestDate);
  const inForce = versions.filter(
    (version) =>
      version.validFrom <= contestDate &&
      (version.validTo === null || contestDate <= version.validTo),
  );
  const [only] = inForce;
  if (only === undefined || inForce.length > 1) {
    throw new RangeError(
      `${String(inForce.length)} rule versions are in force on ${contestDate}; exactly one must be`,
    );
  }
  return only.rule;
}
