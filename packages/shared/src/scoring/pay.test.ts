import { describe, expect, it } from 'vitest';
import { effectiveHourlyCents, termPayCents } from './pay.ts';

describe('termPayCents', () => {
  it('term pay is annual pay times the term length', () => {
    // $52,941 a year over a 4-year term is $211,764.
    expect(termPayCents(5_294_100, 4)).toBe(21_176_400);
    expect(termPayCents(300_000, 2.5)).toBe(750_000);
  });

  it('rounds half away from zero to whole cents', () => {
    // 3 cents over a 2.5-year term is 7.5 cents.
    expect(termPayCents(3, 2.5)).toBe(8);
  });

  it('returns null when pay or the term is not known', () => {
    expect(termPayCents(null, 4)).toBeNull();
    expect(termPayCents(5_294_100, null)).toBeNull();
    expect(termPayCents(null, null)).toBeNull();
  });

  it('a zero amount is a known zero', () => {
    expect(termPayCents(0, 4)).toBe(0);
  });
});

describe('effectiveHourlyCents', () => {
  it('effective hourly is annual pay over 52 weeks of the stated hours', () => {
    // 5,294,100 / (20 × 52) = 5,090.48, so $50.90.
    expect(effectiveHourlyCents(5_294_100, 20)).toBe(5_090);
    // 1,000,000 / (12 × 52) = 1,602.56, so $16.03.
    expect(effectiveHourlyCents(1_000_000, 12)).toBe(1_603);
  });

  it('returns null unless pay and positive hours are known', () => {
    expect(effectiveHourlyCents(5_294_100, null)).toBeNull();
    expect(effectiveHourlyCents(5_294_100, 0)).toBeNull();
    expect(effectiveHourlyCents(null, 20)).toBeNull();
  });
});

describe('pay helpers', () => {
  it('negative input is refused', () => {
    expect(() => termPayCents(-1, 4)).toThrow(RangeError);
    expect(() => termPayCents(5_294_100, -4)).toThrow(RangeError);
    expect(() => termPayCents(-1, null)).toThrow(RangeError);
    expect(() => effectiveHourlyCents(-1, 20)).toThrow(RangeError);
    expect(() => effectiveHourlyCents(5_294_100, -20)).toThrow(RangeError);
    expect(() => effectiveHourlyCents(Number.NaN, 20)).toThrow(RangeError);
  });
});
