import { describe, expect, it } from 'vitest';
import { systemClock } from './clock.ts';

describe('systemClock', () => {
  it('reads the time and waits on a real timer', async () => {
    const before = Date.now();
    expect(Math.abs(systemClock.now() - before)).toBeLessThan(1000);
    await systemClock.sleep(20);
    expect(systemClock.now() - before).toBeGreaterThanOrEqual(15);
  });
});
