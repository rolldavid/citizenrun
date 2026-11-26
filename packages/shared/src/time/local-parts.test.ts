import { describe, expect, it } from 'vitest';
import { eachZone } from '../testing/zones.ts';
import { DAYS_UNTIL_CASES, DAYS_UNTIL_ROWS } from './days-until.fixtures.ts';
import { FALLBACK_TIME_ZONE } from './days-until.ts';
import { localPartsByFields, localPartsByFormatToParts } from './local-parts.ts';

const KNOWN_ZONE = (zone: string | null): boolean => zone !== 'Not/AZone';

describe('local parts', () => {
  it('both ways agree', async () => {
    await eachZone(() => {
      for (const row of [...DAYS_UNTIL_ROWS, ...DAYS_UNTIL_CASES]) {
        const now = new Date(row.now);
        if (!KNOWN_ZONE(row.zone)) {
          expect(() => localPartsByFormatToParts(row.zone ?? '', now)).toThrow(RangeError);
          expect(() => localPartsByFields(row.zone ?? '', now)).toThrow(RangeError);
          continue;
        }
        const zone = row.zone ?? FALLBACK_TIME_ZONE;
        const byParts = localPartsByFormatToParts(zone, now);
        expect(localPartsByFields(zone, now), row.name).toEqual(byParts);
        expect(`${byParts.date} ${byParts.time}`, row.name).toBe(row.local);
      }
    });
  });

  it('midnight is 00, never 24', async () => {
    await eachZone(() => {
      const now = new Date('2027-03-05T05:00:00Z');
      const expected = { date: '2027-03-05', time: '00:00' };
      expect(localPartsByFormatToParts('America/New_York', now)).toEqual(expected);
      expect(localPartsByFields('America/New_York', now)).toEqual(expected);
    });
  });

  it('pads single digits both ways', async () => {
    await eachZone(() => {
      const now = new Date('2027-01-02T08:04:00Z');
      const expected = { date: '2027-01-02', time: '03:04' };
      expect(localPartsByFormatToParts('America/New_York', now)).toEqual(expected);
      expect(localPartsByFields('America/New_York', now)).toEqual(expected);
    });
  });
});
