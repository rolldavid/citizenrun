import { describe, expect, it } from 'vitest';
import { fitsDayJob, type MeetingTime } from './fits-day-job.ts';

type Row = [boolean | null, number | null, MeetingTime[] | null, 'yes' | 'likely' | 'no' | null];

describe('fitsDayJob', () => {
  it.each<Row>([
    [true, 10, ['evenings'], 'no'],
    [null, 35, null, 'no'],
    [false, 15, ['daytime', 'evenings'], 'no'],
    [null, 8, ['daytime'], 'likely'],
    [null, null, ['daytime'], 'no'],
    [null, null, null, null],
    [false, 12, ['evenings', 'weekends'], 'yes'],
    [null, 25, ['evenings'], 'likely'],
    [false, null, null, 'likely'],
    [null, null, [], 'likely'],
  ])('full time %s, %s hours, meetings %j gives %s', (fullTime, hours, meetings, expected) => {
    expect(fitsDayJob(fullTime, hours, meetings)).toBe(expected);
  });

  it('boundaries', () => {
    expect(fitsDayJob(null, 30, ['evenings'])).toBe('likely');
    expect(fitsDayJob(null, 30.5, ['evenings'])).toBe('no');
    expect(fitsDayJob(null, 20, ['weekends'])).toBe('yes');
    expect(fitsDayJob(null, 20.5, ['weekends'])).toBe('likely');
    expect(fitsDayJob(null, 10, ['daytime'])).toBe('likely');
    expect(fitsDayJob(null, 10.5, ['daytime'])).toBe('no');
  });

  it('refuses negative hours', () => {
    expect(() => fitsDayJob(null, -1, null)).toThrow(RangeError);
    expect(() => fitsDayJob(null, Number.NaN, null)).toThrow(RangeError);
    expect(() => fitsDayJob(null, Number.POSITIVE_INFINITY, null)).toThrow(RangeError);
  });
});
