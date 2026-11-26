import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';

import { localDateOf } from './local-date';

describe('localDateOf', () => {
  it('gives the calendar date of an instant where the device is', async () => {
    const days: Record<string, string[]> = {};
    await eachZone((zone) => {
      days[zone] = [
        localDateOf('2027-02-14T12:00:00.000Z') ?? '',
        localDateOf('2027-02-14T03:00:00.000Z') ?? '',
        localDateOf('2027-12-31T20:00:00.000Z') ?? '',
      ];
    });
    // Los Angeles is 8 hours behind UTC in winter; Kiritimati is 14 hours ahead all year.
    expect(days).toEqual({
      'America/Los_Angeles': ['2027-02-14', '2027-02-13', '2027-12-31'],
      'Pacific/Kiritimati': ['2027-02-15', '2027-02-14', '2028-01-01'],
    });
  });

  it('gives null for a string that is no instant', () => {
    expect(localDateOf('')).toBeNull();
    expect(localDateOf('not a date')).toBeNull();
  });
});
