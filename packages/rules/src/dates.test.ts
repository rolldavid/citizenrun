import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBefore,
  federalHolidays,
  FRIDAY,
  firstWeekdayAfter,
  firstWeekdayOnOrAfter,
  fromDayNumber,
  isBusinessDay,
  MONDAY,
  novemberElectionDay,
  nthWeekdayOfMonth,
  roll,
  SATURDAY,
  SUNDAY,
  selectVersion,
  THURSDAY,
  toDayNumber,
  TUESDAY,
  WEDNESDAY,
  weekdayOf,
} from './dates.ts';
import type { HolidayCalendar, Versioned } from './dates.ts';

function zzCalendar(...years: number[]): HolidayCalendar {
  return {
    state: 'ZZ',
    year: years[0] ?? 0,
    holidays: years.flatMap((year) => federalHolidays(year)),
  };
}

const HOLIDAY_NAMES = [
  'New Year’s Day',
  'Birthday of Martin Luther King, Jr.',
  'Washington’s Birthday',
  'Memorial Day',
  'Juneteenth National Independence Day',
  'Independence Day',
  'Labor Day',
  'Columbus Day',
  'Veterans Day',
  'Thanksgiving Day',
  'Christmas Day',
];

describe('the date library', () => {
  it('November election day', async () => {
    await eachZone(() => {
      expect(novemberElectionDay(2026)).toBe('2026-11-03');
      expect(novemberElectionDay(2027)).toBe('2027-11-02');
      expect(novemberElectionDay(2028)).toBe('2028-11-07');
      expect(novemberElectionDay(2029)).toBe('2029-11-06');
      expect(novemberElectionDay(1900)).toBe('1900-11-06');
      expect(novemberElectionDay(2000)).toBe('2000-11-07');
      expect(novemberElectionDay(2100)).toBe('2100-11-02');
      // A November that starts on a Tuesday: the election is a week later.
      expect(novemberElectionDay(2022)).toBe('2022-11-08');
    });
  });

  it('weekday ordinals', async () => {
    await eachZone(() => {
      expect(nthWeekdayOfMonth(2027, 5, MONDAY, 1)).toBe('2027-05-03');
      expect(nthWeekdayOfMonth(2100, 2, MONDAY, -1)).toBe('2100-02-22');
      expect(nthWeekdayOfMonth(2000, 2, TUESDAY, 5)).toBe('2000-02-29');
      expect(nthWeekdayOfMonth(2028, 2, TUESDAY, 5)).toBe('2028-02-29');
      expect(() => nthWeekdayOfMonth(2027, 2, TUESDAY, 5)).toThrow(RangeError);
      expect(nthWeekdayOfMonth(2027, 11, THURSDAY, 4)).toBe('2027-11-25');
      expect(nthWeekdayOfMonth(2027, 5, MONDAY, -1)).toBe('2027-05-31');
      expect(nthWeekdayOfMonth(1900, 2, WEDNESDAY, -1)).toBe('1900-02-28');
      expect(() => nthWeekdayOfMonth(2027, 13, MONDAY, 1)).toThrow(RangeError);
      expect(() => nthWeekdayOfMonth(2027, 0, MONDAY, 1)).toThrow(RangeError);
    });
  });

  it('day numbers', async () => {
    await eachZone(() => {
      expect(toDayNumber('1970-01-01')).toBe(0);
      expect(toDayNumber('1969-12-31')).toBe(-1);
      expect(toDayNumber('2000-03-01')).toBe(11017);
      expect(toDayNumber('1900-03-01')).toBe(-25508);
      expect(toDayNumber('2100-03-01')).toBe(47541);
      expect(toDayNumber('2028-02-29')).toBe(21243);
      expect(fromDayNumber(0)).toBe('1970-01-01');
      expect(fromDayNumber(-1)).toBe('1969-12-31');
      expect(fromDayNumber(11017)).toBe('2000-03-01');
      expect(fromDayNumber(-25508)).toBe('1900-03-01');
      expect(fromDayNumber(47541)).toBe('2100-03-01');
      expect(fromDayNumber(21243)).toBe('2028-02-29');
    });
  });

  it('every day round-trips', async () => {
    await eachZone(() => {
      const first = toDayNumber('1899-12-01');
      const last = toDayNumber('2101-01-31');
      let previous: number | null = null;
      let count = 0;
      for (let n = first; n <= last; n += 1) {
        const date = fromDayNumber(n);
        expect(toDayNumber(date)).toBe(n);
        if (previous !== null) {
          expect(toDayNumber(date) - previous).toBe(1);
        }
        previous = n;
        count += 1;
      }
      // December 1899, the 201 years 1900 to 2100 with 49 leap days (1900 and 2100 are not), January 2101.
      expect(count).toBe(31 + 365 * 201 + 49 + 31);
      expect(fromDayNumber(first)).toBe('1899-12-01');
      expect(fromDayNumber(last)).toBe('2101-01-31');
    });
  });

  it('leap-year rules', async () => {
    await eachZone(() => {
      expect(() => toDayNumber('1900-02-29')).toThrow(RangeError);
      expect(() => toDayNumber('2100-02-29')).toThrow(RangeError);
      expect(toDayNumber('2000-02-29')).toBe(toDayNumber('2000-03-01') - 1);
      expect(toDayNumber('2028-02-29')).toBe(toDayNumber('2028-03-01') - 1);
      expect(() => toDayNumber('2027-02-29')).toThrow(RangeError);
      expect(() => toDayNumber('2027-02-30')).toThrow(RangeError);
      expect(() => toDayNumber('2027-13-01')).toThrow(RangeError);
      expect(() => toDayNumber('27-03-05')).toThrow(RangeError);
      expect(() => toDayNumber('2027-00-10')).toThrow(RangeError);
      expect(() => toDayNumber('2027-04-31')).toThrow(RangeError);
      expect(() => toDayNumber('2027-3-5')).toThrow(RangeError);
      expect(() => toDayNumber('2027-03-05T00:00:00Z')).toThrow(RangeError);
      // The day before 1 March is 28 or 29 February by the 4, 100 and 400 rules.
      expect(daysBefore('1900-03-01', 1)).toBe('1900-02-28');
      expect(daysBefore('2000-03-01', 1)).toBe('2000-02-29');
      expect(daysBefore('2100-03-01', 1)).toBe('2100-02-28');
    });
  });

  it('weekdays', async () => {
    await eachZone(() => {
      expect(weekdayOf('1900-01-01')).toBe(MONDAY);
      expect(weekdayOf('1970-01-01')).toBe(THURSDAY);
      expect(weekdayOf('2000-01-01')).toBe(SATURDAY);
      expect(weekdayOf('2100-01-01')).toBe(FRIDAY);
      expect(weekdayOf('1969-12-28')).toBe(SUNDAY);
      expect(weekdayOf('2027-11-02')).toBe(TUESDAY);
    });
  });

  it('days before across a month end and a leap day', async () => {
    await eachZone(() => {
      expect(daysBefore('2028-03-01', 1)).toBe('2028-02-29');
      expect(daysBefore('2028-03-10', 10)).toBe('2028-02-29');
      expect(daysBefore('2027-03-01', 1)).toBe('2027-02-28');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
      expect(daysBefore('2027-01-01', -1)).toBe('2027-01-02');
      expect(() => addDays('2027-01-01', 1.5)).toThrow(RangeError);
    });
  });

  it('first weekday on or after, and after', async () => {
    await eachZone(() => {
      expect(firstWeekdayOnOrAfter('2027-05-03', MONDAY)).toBe('2027-05-03');
      expect(firstWeekdayAfter('2027-05-03', MONDAY)).toBe('2027-05-10');
      expect(firstWeekdayAfter('2027-11-01', TUESDAY)).toBe('2027-11-02');
      expect(firstWeekdayOnOrAfter('2028-02-27', TUESDAY)).toBe('2028-02-29');
    });
  });

  it('federal holidays at their observed dates', async () => {
    await eachZone(() => {
      const dates = (year: number): string[] => federalHolidays(year).map((h) => h.date);
      expect(dates(2026)).toEqual([
        '2026-01-01',
        '2026-01-19',
        '2026-02-16',
        '2026-05-25',
        '2026-06-19',
        '2026-07-03',
        '2026-09-07',
        '2026-10-12',
        '2026-11-11',
        '2026-11-26',
        '2026-12-25',
      ]);
      expect(dates(2027)).toEqual([
        '2027-01-01',
        '2027-01-18',
        '2027-02-15',
        '2027-05-31',
        '2027-06-18',
        '2027-07-05',
        '2027-09-06',
        '2027-10-11',
        '2027-11-11',
        '2027-11-25',
        '2027-12-24',
        '2027-12-31',
      ]);
      expect(federalHolidays(2027).at(-1)?.name).toBe('New Year’s Day');
      const of2022 = dates(2022);
      expect(of2022).toHaveLength(10);
      expect(of2022.filter((d) => d.startsWith('2022-01-'))).toEqual(['2022-01-17']);
      expect(of2022.at(-1)).toBe('2022-12-26');
      expect(federalHolidays(2021).map((h) => h.date)).toContain('2021-06-18');
      expect(federalHolidays(2021).map((h) => h.date)).toContain('2021-12-31');
      // 1 January 2101 is a Saturday, observed on Friday 31 December 2100.
      expect(dates(2100)).toHaveLength(12);
      expect(dates(2100).at(-1)).toBe('2100-12-31');
      expect(() => federalHolidays(2020)).toThrow(RangeError);
      expect(() => federalHolidays(2101)).toThrow(RangeError);
    });
  });

  it('each holiday cites 5 U.S.C. 6103', async () => {
    await eachZone(() => {
      const holidays = [...federalHolidays(2026), ...federalHolidays(2027)];
      expect(holidays.map((h) => h.name).slice(0, 11)).toEqual(HOLIDAY_NAMES);
      for (const holiday of holidays) {
        const { citation, sourceUrl, quote, validFrom, validTo } = holiday.citation;
        expect(citation).toBe('5 U.S.C. 6103');
        const url = new URL(sourceUrl);
        expect(url.protocol).toBe('https:');
        expect(['uscode.house.gov', 'www.govinfo.gov', 'govinfo.gov']).toContain(url.hostname);
        for (const name of HOLIDAY_NAMES) {
          expect(quote).toContain(name);
        }
        expect(validFrom).toBe('2021-06-17');
        expect(validTo).toBeNull();
      }
    });
  });

  it('business days and rolls', async () => {
    await eachZone(() => {
      const zz2026 = zzCalendar(2026);
      expect(isBusinessDay('2026-07-03', zz2026)).toBe(false);
      expect(isBusinessDay('2026-07-04', zz2026)).toBe(false);
      expect(isBusinessDay('2026-07-06', zz2026)).toBe(true);
      expect(roll('2026-07-03', 'next_business_day', zz2026)).toBe('2026-07-06');
      expect(roll('2026-07-05', 'previous_business_day', zz2026)).toBe('2026-07-02');
      expect(roll('2026-07-03', 'none', zz2026)).toBe('2026-07-03');
      expect(roll('2026-09-07', 'next_business_day', zz2026)).toBe('2026-09-08');
      expect(roll('2026-09-08', 'next_business_day', zz2026)).toBe('2026-09-08');
      // 31 December 2027 holds New Year's Day 2028, a Saturday; 1 to 2 January are a weekend.
      expect(roll('2027-12-31', 'next_business_day', zzCalendar(2027, 2028))).toBe('2028-01-03');
      // 2 January 2023 is the observed New Year's Day, in 2023's list: one year's list misses it.
      expect(roll('2022-12-31', 'next_business_day', zzCalendar(2022))).toBe('2023-01-02');
      expect(roll('2022-12-31', 'next_business_day', zzCalendar(2022, 2023))).toBe('2023-01-03');
      expect(() => roll('2026-02-30', 'none', zz2026)).toThrow(RangeError);
    });
  });

  it('version selection', async () => {
    await eachZone(() => {
      const zz: Versioned<number>[] = [
        { validFrom: '2000-01-01', validTo: '2026-12-31', rule: 57 },
        { validFrom: '2027-01-01', validTo: null, rule: 64 },
      ];
      expect(selectVersion(zz, '2026-11-03')).toBe(57);
      expect(selectVersion(zz, '2027-11-02')).toBe(64);
      expect(selectVersion(zz, '2026-12-31')).toBe(57);
      expect(selectVersion(zz, '2027-01-01')).toBe(64);
      expect(() => selectVersion(zz, '1999-11-02')).toThrow(RangeError);
      expect(() => selectVersion(zz, '1999-11-02')).toThrow('1999-11-02');
      const overlapping: Versioned<number>[] = [
        { validFrom: '2000-01-01', validTo: null, rule: 57 },
        { validFrom: '2027-01-01', validTo: null, rule: 64 },
      ];
      expect(() => selectVersion(overlapping, '2027-11-02')).toThrow(RangeError);
      expect(selectVersion(overlapping, '2026-11-03')).toBe(57);
    });
  });
});
