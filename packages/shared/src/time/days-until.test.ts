import { afterEach, describe, expect, it } from 'vitest';
import { eachZone } from '../testing/zones.ts';
import { DAYS_UNTIL_CASES, DAYS_UNTIL_ROWS } from './days-until.fixtures.ts';
import { FALLBACK_TIME_ZONE, daysUntil, localDateTimeIn } from './days-until.ts';

describe('daysUntil', () => {
  for (const row of DAYS_UNTIL_ROWS) {
    it(`${row.name}: ${row.date} in ${String(row.zone)} at ${row.now} is ${String(row.days)}`, async () => {
      await eachZone(() => {
        expect(daysUntil(row.date, row.zone, new Date(row.now))).toBe(row.days);
      });
    });
  }

  for (const row of DAYS_UNTIL_CASES) {
    it(row.name, async () => {
      await eachZone(() => {
        expect(daysUntil(row.date, row.zone, new Date(row.now))).toBe(row.days);
      });
    });
  }

  it('an impossible date is refused', async () => {
    await eachZone(() => {
      const now = new Date('2027-02-01T12:00:00Z');
      expect(() => daysUntil('2027-02-30', 'America/New_York', now)).toThrow(RangeError);
      expect(() => daysUntil('2027-13-01', 'America/New_York', now)).toThrow(RangeError);
      expect(() => daysUntil('2027-2-3', 'America/New_York', now)).toThrow(RangeError);
      expect(() => daysUntil('', null, now)).toThrow(RangeError);
    });
  });

  it('counts across a year end and a leap day', async () => {
    await eachZone(() => {
      expect(daysUntil('2028-03-01', 'America/New_York', new Date('2028-02-28T17:00:00Z'))).toBe(2);
      expect(daysUntil('2028-01-01', 'America/New_York', new Date('2027-12-31T17:00:00Z'))).toBe(1);
    });
  });
});

describe('localDateTimeIn', () => {
  it('the local date and time', async () => {
    await eachZone(() => {
      expect(localDateTimeIn('America/Chicago', new Date('2027-03-14T07:30:00Z'))).toEqual({
        date: '2027-03-14',
        time: '01:30',
      });
      const now = new Date('2027-03-05T03:00:00Z');
      expect(localDateTimeIn(null, now)).toEqual(localDateTimeIn(FALLBACK_TIME_ZONE, now));
      expect(localDateTimeIn(null, now)).toEqual({ date: '2027-03-04', time: '22:00' });
    });
  });

  it('reads every fixture row in its zone', async () => {
    await eachZone(() => {
      for (const row of [...DAYS_UNTIL_ROWS, ...DAYS_UNTIL_CASES]) {
        const local = localDateTimeIn(row.zone, new Date(row.now));
        expect(`${local.date} ${local.time}`, row.name).toBe(row.local);
      }
    });
  });

  it('an unknown zone reads as the fallback zone', async () => {
    await eachZone(() => {
      const now = new Date('2027-07-01T12:00:00Z');
      expect(localDateTimeIn('Not/AZone', now)).toEqual(localDateTimeIn(FALLBACK_TIME_ZONE, now));
      expect(localDateTimeIn('', now)).toEqual(localDateTimeIn(FALLBACK_TIME_ZONE, now));
    });
  });

  describe('without formatToParts', () => {
    const original = Object.getOwnPropertyDescriptor(
      Intl.DateTimeFormat.prototype,
      'formatToParts',
    );
    afterEach(() => {
      if (original !== undefined) {
        Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', original);
      }
    });

    it('reads one field at a time, as on an engine that lacks it', async () => {
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      await eachZone(() => {
        for (const row of [...DAYS_UNTIL_ROWS, ...DAYS_UNTIL_CASES]) {
          const now = new Date(row.now);
          const local = localDateTimeIn(row.zone, now);
          expect(`${local.date} ${local.time}`, row.name).toBe(row.local);
          expect(daysUntil(row.date, row.zone, now), row.name).toBe(row.days);
        }
      });
    });
  });

  it('falls back to Eastern, not to the zone of the machine', () => {
    expect(FALLBACK_TIME_ZONE).toBe('America/New_York');
  });
});
