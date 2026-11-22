import { describe, expect, it } from 'vitest';
import { TEST_ZONES, eachZone } from './zones.ts';

describe('eachZone', () => {
  it('runs the body once per zone with TZ set', async () => {
    const seen: { zone: string; hours: number; date: number }[] = [];
    await eachZone((zone) => {
      const at = new Date('2027-03-05T12:00:00Z');
      seen.push({ zone, hours: at.getHours(), date: at.getDate() });
    });
    expect(seen).toEqual([
      { zone: 'America/Los_Angeles', hours: 4, date: 5 },
      { zone: 'Pacific/Kiritimati', hours: 2, date: 6 },
    ]);
    expect(TEST_ZONES).toEqual(['America/Los_Angeles', 'Pacific/Kiritimati']);
  });

  it('awaits an async body', async () => {
    const order: string[] = [];
    await eachZone(async (zone) => {
      await Promise.resolve();
      order.push(zone);
    });
    expect(order).toEqual([...TEST_ZONES]);
  });
});
