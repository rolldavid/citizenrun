import { describe, expect, it } from 'vitest';
import { dhashFromPixels } from './dhash.ts';

const BRIGHTER = [0, 10, 20, 30, 40, 50, 60, 70, 80];
const DARKER = [...BRIGHTER].reverse();

// Eight rows of nine pixels; `darkerRows` lists the rows that get darker from left to right.
function grid(darkerRows: readonly number[]): Uint8Array {
  const rows = Array.from({ length: 8 }, (_, row) =>
    darkerRows.includes(row) ? DARKER : BRIGHTER,
  );
  return new Uint8Array(rows.flat());
}

describe('dhashFromPixels', () => {
  it('rows that only get brighter give zero', () => {
    expect(dhashFromPixels(grid([]))).toBe(0n);
  });

  it('rows that only get darker set every bit', () => {
    expect(dhashFromPixels(grid([0, 1, 2, 3, 4, 5, 6, 7]))).toBe(-1n);
  });

  it('the first row sets the low byte', () => {
    expect(dhashFromPixels(grid([0]))).toBe(255n);
  });

  it('the last row sets the sign', () => {
    expect(dhashFromPixels(grid([7]))).toBe(BigInt.asIntN(64, 0xff00000000000000n));
  });

  it('equal neighbours set no bit', () => {
    expect(dhashFromPixels(new Uint8Array(72).fill(128))).toBe(0n);
  });

  it('refuses a wrong size', () => {
    expect(() => dhashFromPixels(new Uint8Array(71))).toThrow(RangeError);
    expect(() => dhashFromPixels(new Uint8Array(73))).toThrow(RangeError);
  });
});
