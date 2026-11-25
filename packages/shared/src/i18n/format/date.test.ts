import { describe, expect, it } from 'vitest';
import { eachZone } from '../../testing/zones.ts';
import { formatDate } from './date.ts';
import type { DateStyle } from './date.ts';

const EXPECTED: readonly (readonly [DateStyle, string])[] = [
  ['long', 'March 5, 2027'],
  ['medium', 'Mar 5, 2027'],
  ['short', 'Mar 5'],
  ['weekday', 'Friday, March 5, 2027'],
  ['weekdayShort', 'Fri, Mar 5'],
];

describe('formatDate', () => {
  it('formats every style', () => {
    for (const [style, text] of EXPECTED) {
      expect(formatDate('2027-03-05', 'en', style)).toBe(text);
    }
  });

  it('never shifts the day', async () => {
    const seen: string[] = [];
    await eachZone((zone) => {
      seen.push(zone);
      for (const [style, text] of EXPECTED) {
        expect(formatDate('2027-03-05', 'en', style)).toBe(text);
      }
      // The first and last days of a year, where a shift would also change the year.
      expect(formatDate('2027-01-01', 'en', 'long')).toBe('January 1, 2027');
      expect(formatDate('2026-12-31', 'en', 'long')).toBe('December 31, 2026');
    });
    expect(seen).toEqual(['America/Los_Angeles', 'Pacific/Kiritimati']);
  });

  it('refuses a date that does not exist', () => {
    expect(() => formatDate('2027-02-30', 'en', 'long')).toThrow(RangeError);
    expect(() => formatDate('2027-02-29', 'en', 'long')).toThrow(RangeError);
    expect(() => formatDate('2027-13-01', 'en', 'long')).toThrow(RangeError);
    expect(() => formatDate('2027-00-10', 'en', 'long')).toThrow(RangeError);
    expect(() => formatDate('2027-3-5', 'en', 'long')).toThrow(RangeError);
    expect(() => formatDate('', 'en', 'long')).toThrow(RangeError);
    // A leap day that exists.
    expect(formatDate('2028-02-29', 'en', 'medium')).toBe('Feb 29, 2028');
  });
});
