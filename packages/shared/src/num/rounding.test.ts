import { describe, expect, it } from 'vitest';
import { ceilDiv, clamp, roundDiv, roundHalfAwayFromZero } from './rounding.ts';

describe('roundHalfAwayFromZero', () => {
  it('rounds half away from zero', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(12.345, 1)).toBe(12.3);
    // 0.285 is stored as a binary value just under 0.285, so it rounds down.
    expect(roundHalfAwayFromZero(0.285, 2)).toBe(0.28);
    expect(roundHalfAwayFromZero(1.005 * 1000, 0)).toBe(1005);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundHalfAwayFromZero(-0.4), 0)).toBe(true);
    expect(Object.is(roundHalfAwayFromZero(-0), 0)).toBe(true);
    expect(Object.is(roundHalfAwayFromZero(-0.004, 2), 0)).toBe(true);
  });
});

describe('ceilDiv', () => {
  it('ceilDiv', () => {
    expect(ceilDiv(7, 2)).toBe(4);
    expect(ceilDiv(6, 2)).toBe(3);
    expect(ceilDiv(0, 5)).toBe(0);
    expect(ceilDiv(1, 1)).toBe(1);
  });
});

describe('roundDiv', () => {
  it('roundDiv rounds half up', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(5, 3)).toBe(2);
    expect(roundDiv(0, 3)).toBe(0);
  });
});

describe('division arguments', () => {
  it('refuses what a caller cannot pass', () => {
    expect(() => ceilDiv(1, 0)).toThrow(RangeError);
    expect(() => ceilDiv(-1, 2)).toThrow(RangeError);
    expect(() => ceilDiv(1, -2)).toThrow(RangeError);
    expect(() => roundDiv(1.5, 2)).toThrow(RangeError);
    expect(() => roundDiv(1, 0)).toThrow(RangeError);
    expect(() => roundDiv(1, 2.5)).toThrow(RangeError);
    expect(() => roundDiv(2 ** 53, 2)).toThrow(RangeError);
  });
});

describe('clamp', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
