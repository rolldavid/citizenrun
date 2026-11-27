import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { isElectionNight } from './hours.ts';

const at = (iso: string) => Date.parse(iso);

describe('election night', () => {
  it('election night across a daylight-saving change in America/New_York', async () => {
    await eachZone(() => {
      const zone = 'America/New_York';
      // The clocks change on Sunday 2027-03-14: 17:00 that evening is EDT (UTC-4).
      const dates = ['2027-03-14'];
      expect(isElectionNight(at('2027-03-14T20:59:00Z'), zone, dates)).toBe(false); // 16:59 EDT
      expect(isElectionNight(at('2027-03-14T21:00:00Z'), zone, dates)).toBe(true); // 17:00 EDT
      expect(isElectionNight(at('2027-03-15T09:59:00Z'), zone, dates)).toBe(true); // 05:59 EDT
      expect(isElectionNight(at('2027-03-15T10:00:00Z'), zone, dates)).toBe(false); // 06:00 EDT
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
