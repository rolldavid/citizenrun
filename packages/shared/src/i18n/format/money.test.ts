import { describe, expect, it } from 'vitest';
import { formatMoney } from './money.ts';

const ROWS: readonly (readonly [number, string])[] = [
  [5_290_000, '$52,900'],
  [5_294_100, '$52,941'],
  [3_750, '$37.50'],
  [0, '$0'],
  [30_000, '$300'],
  [5, '$0.05'],
  [17_400_000, '$174,000'],
  [21_176_400, '$211,764'],
];

describe('formatMoney', () => {
  for (const [cents, text] of ROWS) {
    it(`${String(cents)} cents is ${text}`, () => {
      expect(formatMoney(cents, 'en')).toBe(text);
    });
  }

  it('a fraction of a cent is refused', () => {
    expect(() => formatMoney(12.5, 'en')).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, 'en')).toThrow(RangeError);
  });
});
