import { describe, expect, it } from 'vitest';
import { seededRandom } from './random.ts';

describe('seededRandom', () => {
  it('seededRandom is Mulberry32', () => {
    const one = seededRandom(1);
    const fortyTwo = seededRandom(42);
    const fromOne = [one(), one(), one()];
    const fromFortyTwo = [fortyTwo(), fortyTwo(), fortyTwo()];
    expect(fromOne).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
    expect(fromFortyTwo).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
    const rng = seededRandom(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
