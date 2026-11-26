import { describe, expect, it } from 'vitest';
import { ID_CHUNK, chunk } from './chunk.ts';

describe('chunk', () => {
  it('splits at 5,000', () => {
    const ids = Array.from({ length: 5001 }, (_, index) => index);
    const pieces = chunk(ids, ID_CHUNK);
    expect(ID_CHUNK).toBe(5000);
    expect(pieces.map((piece) => piece.length)).toEqual([5000, 1]);
    expect(pieces.flat()).toEqual(ids);
    expect(chunk([], ID_CHUNK)).toEqual([]);
  });

  it('refuses a size that is not a positive integer', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
    expect(() => chunk([1], 1.5)).toThrow(RangeError);
  });
});
