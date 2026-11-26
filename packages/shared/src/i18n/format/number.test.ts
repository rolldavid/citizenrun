import { describe, expect, it } from 'vitest';
import { formatNumber } from './number.ts';

describe('formatNumber', () => {
  it('writes grouping separators', () => {
    expect(formatNumber(2101, 'en')).toBe('2,101');
    expect(formatNumber(592900, 'en')).toBe('592,900');
    expect(formatNumber(1185800, 'en')).toBe('1,185,800');
  });

  it('keeps at most the decimals asked for', () => {
    expect(formatNumber(12.3, 'en', 1)).toBe('12.3');
    expect(formatNumber(12.34, 'en', 1)).toBe('12.3');
    expect(formatNumber(12.3, 'en')).toBe('12');
    expect(formatNumber(1, 'en', 1)).toBe('1');
  });

  it('writes zero as 0', () => {
    expect(formatNumber(0, 'en')).toBe('0');
  });
});
