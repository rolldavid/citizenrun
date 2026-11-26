import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';

import { msUntilNextLocalMidnight } from './now';

describe('msUntilNextLocalMidnight', () => {
  it('counts to the next local midnight', async () => {
    await eachZone((zone) => {
      expect(msUntilNextLocalMidnight(new Date(2027, 2, 5, 23, 59, 0)), zone).toBe(60_000);
      expect(msUntilNextLocalMidnight(new Date(2027, 2, 5, 0, 0, 0)), zone).toBe(86_400_000);
    });
  });

  it('never answers below 1', async () => {
    await eachZone((zone) => {
      const lastMoment = new Date(2027, 2, 6, 0, 0, 0).getTime() - 1;
      expect(msUntilNextLocalMidnight(new Date(lastMoment)), zone).toBe(1);
      expect(msUntilNextLocalMidnight(new Date(2027, 2, 5, 12, 0, 0)), zone).toBeGreaterThanOrEqual(
        1,
      );
    });
  });
});
