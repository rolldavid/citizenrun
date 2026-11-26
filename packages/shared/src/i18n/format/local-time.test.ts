import { describe, expect, it } from 'vitest';
import { eachZone } from '../../testing/zones.ts';
import { englishT } from './english-t.fixtures.ts';
import { formatLocalTime, US_ZONE_NAMES } from './local-time.ts';

const t = englishT();

const ROWS: readonly (readonly [string | null, string | null, string])[] = [
  ['12:00', 'America/New_York', '12:00 noon Eastern'],
  ['17:00', 'America/Chicago', '5:00 pm Central'],
  ['00:00', 'Pacific/Honolulu', '12:00 midnight Hawaii-Aleutian'],
  ['08:30', 'America/Los_Angeles', '8:30 am Pacific'],
  ['16:30', 'America/Phoenix', '4:30 pm Mountain'],
  ['19:00', null, '7:00 pm local time'],
  ['22:04', 'Etc/UTC', '10:04 pm UTC'],
  [null, 'America/New_York', 'Closing time not known yet'],
];

describe('formatLocalTime', () => {
  it('formatLocalTime names the zone and never converts', async () => {
    await eachZone(() => {
      for (const [time, zone, text] of ROWS) {
        expect(formatLocalTime(time, zone, t), `${String(time)} ${String(zone)}`).toBe(text);
      }
    });
  });

  it('noon and midnight neighbours', () => {
    expect(formatLocalTime('12:30', 'America/New_York', t)).toBe('12:30 pm Eastern');
    expect(formatLocalTime('00:30', 'America/New_York', t)).toBe('12:30 am Eastern');
    expect(formatLocalTime('11:59', 'America/New_York', t)).toBe('11:59 am Eastern');
    expect(formatLocalTime('23:59', 'America/New_York', t)).toBe('11:59 pm Eastern');
  });

  it('an unknown zone is local time', () => {
    expect(formatLocalTime('17:00', 'Europe/Paris', t)).toBe('5:00 pm local time');
    expect(formatLocalTime('17:00', 'toString', t)).toBe('5:00 pm local time');
  });

  it('every zone of the table has a name', () => {
    const zones = Object.keys(US_ZONE_NAMES);
    expect(zones).toContain('Etc/UTC');
    expect(zones).toHaveLength(35);
    for (const zone of zones) {
      const text = formatLocalTime('12:00', zone, t);
      expect(text, zone).toMatch(/^12:00 noon \S/);
      expect(text, zone).not.toContain('local time');
    }
  });

  it('refuses a time that is not HH:MM', () => {
    expect(() => formatLocalTime('24:00', 'America/New_York', t)).toThrow(RangeError);
    expect(() => formatLocalTime('5:00', 'America/New_York', t)).toThrow(RangeError);
  });
});
