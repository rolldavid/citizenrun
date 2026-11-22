import { describe, expect, it } from 'vitest';
import { FakeClock } from './clock.ts';

describe('FakeClock', () => {
  it('starts at the real time truncated to the second', () => {
    const before = Date.now();
    const now = new FakeClock().now();
    expect(now.getUTCMilliseconds()).toBe(0);
    expect(Math.abs(now.getTime() - before)).toBeLessThan(2000);
  });

  it('never moves by itself, and set and advance move it', async () => {
    const clock = new FakeClock('2027-03-05T22:00:00.000Z');
    const first = clock.now();
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(clock.now()).toEqual(first);
    expect(clock.now()).not.toBe(clock.now());
    clock.advance(30_000);
    expect(clock.now().getTime() - first.getTime()).toBe(30_000);
    clock.set('2027-03-05T22:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2027-03-05T22:00:00.000Z');
    clock.set(new Date('2028-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2028-01-01T00:00:00.000Z');
  });

  it('refuses an invalid date', () => {
    expect(() => new FakeClock('not a date')).toThrow(RangeError);
  });
});
