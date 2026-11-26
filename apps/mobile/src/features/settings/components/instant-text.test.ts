import { describe, expect, it } from 'vitest';

import { instantDateTime, localDateOf } from './instant-text';

/** The text with the narrow and the fixed spaces a formatter writes read as plain ones. */
function plain(text: string | null): string | null {
  return text === null ? null : text.replace(/[\u202f\u00a0]/g, ' ');
}

describe('localDateOf', () => {
  it('is the calendar date where the device is', () => {
    // Built from the device's own calendar, so the case holds in every time zone.
    expect(localDateOf(new Date(2027, 1, 14, 0, 0).toISOString())).toBe('2027-02-14');
    expect(localDateOf(new Date(2027, 1, 14, 23, 59).toISOString())).toBe('2027-02-14');
    expect(localDateOf(new Date(2027, 11, 31, 9, 30).toISOString())).toBe('2027-12-31');
    expect(localDateOf(new Date(2027, 0, 1, 9, 30).toISOString())).toBe('2027-01-01');
  });

  it('is null for a string that is no instant', () => {
    expect(localDateOf('')).toBeNull();
    expect(localDateOf('soon')).toBeNull();
  });
});

describe('instantDateTime', () => {
  it('writes the day and the time where the device is', () => {
    expect(plain(instantDateTime(new Date(2027, 2, 5, 17, 4).toISOString(), 'en'))).toBe(
      'Mar 5, 5:04 PM',
    );
    expect(plain(instantDateTime(new Date(2027, 0, 16, 0, 0).toISOString(), 'en'))).toBe(
      'Jan 16, 12:00 AM',
    );
  });

  it('is null for a string that is no instant', () => {
    expect(instantDateTime('', 'en')).toBeNull();
    expect(instantDateTime('soon', 'en')).toBeNull();
  });
});
