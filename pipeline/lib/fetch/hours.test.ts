import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { isBusinessHours, isElectionNight } from './hours.ts';

const at = (iso: string) => Date.parse(iso);

describe('business hours and election night', () => {
  it('the business-hours edges', async () => {
    await eachZone(() => {
      // Tuesday 2027-03-02 in America/Chicago (UTC-6).
      expect(isBusinessHours(at('2027-03-02T13:59:00Z'), 'America/Chicago')).toBe(false); // 07:59
      expect(isBusinessHours(at('2027-03-02T14:00:00Z'), 'America/Chicago')).toBe(true); // 08:00
      expect(isBusinessHours(at('2027-03-02T23:59:00Z'), 'America/Chicago')).toBe(true); // 17:59
      expect(isBusinessHours(at('2027-03-03T00:00:00Z'), 'America/Chicago')).toBe(false); // 18:00
      // Saturday and Sunday are never business hours.
      expect(isBusinessHours(at('2027-03-06T16:00:00Z'), 'America/Chicago')).toBe(false);
      expect(isBusinessHours(at('2027-03-07T16:00:00Z'), 'America/Chicago')).toBe(false);
    });
  });

  it('a daylight-saving change in America/New_York', async () => {
    await eachZone(() => {
      const zone = 'America/New_York';
      // Friday 2027-03-12 is on EST (UTC-5).
      expect(isBusinessHours(at('2027-03-12T12:59:00Z'), zone)).toBe(false); // 07:59 EST
      expect(isBusinessHours(at('2027-03-12T13:00:00Z'), zone)).toBe(true); // 08:00 EST
      // The clocks change on Sunday 2027-03-14: 10:00 local is a weekend hour either way.
      expect(isBusinessHours(at('2027-03-14T14:00:00Z'), zone)).toBe(false);
      // Monday 2027-03-15 is on EDT (UTC-4): 12:00Z is 08:00, 11:59Z is 07:59.
      expect(isBusinessHours(at('2027-03-15T11:59:00Z'), zone)).toBe(false);
      expect(isBusinessHours(at('2027-03-15T12:00:00Z'), zone)).toBe(true);
      expect(isBusinessHours(at('2027-03-15T21:59:00Z'), zone)).toBe(true); // 17:59 EDT
      expect(isBusinessHours(at('2027-03-15T22:00:00Z'), zone)).toBe(false); // 18:00 EDT
    });
  });

  it('election night runs from 17:00 local on the date until 06:00 the next day', async () => {
    await eachZone(() => {
      const zone = 'America/Los_Angeles';
      const dates = ['2026-11-03'];
      expect(isElectionNight(at('2026-11-04T00:59:00Z'), zone, dates)).toBe(false); // 16:59
      expect(isElectionNight(at('2026-11-04T01:00:00Z'), zone, dates)).toBe(true); // 17:00
      expect(isElectionNight(at('2026-11-04T13:59:00Z'), zone, dates)).toBe(true); // 05:59 next day
      expect(isElectionNight(at('2026-11-04T14:00:00Z'), zone, dates)).toBe(false); // 06:00 next day
      expect(isElectionNight(at('2026-11-04T01:00:00Z'), zone, [])).toBe(false);
    });
  });
});
