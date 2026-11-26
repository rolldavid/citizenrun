import { describe, expect, it } from 'vitest';
import { formatBigNumber, formatCompact } from './compact.ts';
import { englishT } from './english-t.fixtures.ts';

const t = englishT();

const ROWS: readonly (readonly [number, string])[] = [
  [999, '999'],
  [9_999, '9,999'],
  [10_000, '10K'],
  [12_345, '12.3K'],
  [99_950, '100K'],
  [592_900, '593K'],
  [999_950, '1M'],
  [1_185_800, '1.2M'],
  [25_000_000, '25M'],
  [1_500_000_000, '1.5B'],
];

describe('formatCompact', () => {
  for (const [value, text] of ROWS) {
    it(`${String(value)} is ${text}`, () => {
      expect(formatCompact(value, 'en', t)).toBe(text);
    });
  }

  it('a negative value keeps its sign', () => {
    expect(formatCompact(-12_345, 'en', t)).toBe('-12.3K');
    expect(formatCompact(-999, 'en', t)).toBe('-999');
  });

  it('a non-integer is refused', () => {
    expect(() => formatCompact(12_345.5, 'en', t)).toThrow(RangeError);
    expect(() => formatBigNumber(2.5, 'en', t)).toThrow(RangeError);
  });
});

describe('formatBigNumber', () => {
  it('formatBigNumber', () => {
    expect(formatBigNumber(2_101, 'en', t)).toBe('2,101');
    expect(formatBigNumber(99_999, 'en', t)).toBe('99,999');
    expect(formatBigNumber(592_900, 'en', t)).toBe('593K');
    expect(formatBigNumber(100_000, 'en', t)).toBe('100K');
  });
});
