import { describe, expect, it } from 'vitest';
import { trigramSimilarity } from './trigram.ts';

const MEASURED: readonly (readonly [string, string, number])[] = [
  ['John Smith', 'Smith, John', 1.0],
  ['John Smith', 'John A. Smith', 0.846],
  ['John Smith', 'John Smith III', 0.733],
  ['Ann Lee', 'Anne Lee', 0.7],
  ['James Miller', 'James Milner', 0.625],
  ['John Smith', 'Jon Smith', 0.615],
  ['John Smith', 'Joan Smith', 0.571],
  ['William Johnson', 'Bill Johnson', 0.45],
  ['Robert Smith', 'Bob Smith', 0.353],
];

describe('trigramSimilarity', () => {
  for (const [a, b, expected] of MEASURED) {
    it(`${a} and ${b} is ${expected.toFixed(3)}`, () => {
      expect(trigramSimilarity(a, b).toFixed(3)).toBe(expected.toFixed(3));
    });
  }

  it('two empty strings give 0', () => {
    expect(trigramSimilarity('', '')).toBe(0);
    expect(trigramSimilarity('--', '. ,')).toBe(0);
  });

  it('a string with no words against a name gives 0', () => {
    expect(trigramSimilarity('', 'John Smith')).toBe(0);
  });

  it('the measure is symmetric', () => {
    for (const [a, b] of MEASURED) {
      expect(trigramSimilarity(b, a)).toBe(trigramSimilarity(a, b));
    }
  });

  it('case does not matter', () => {
    expect(trigramSimilarity('JOHN SMITH', 'john smith')).toBe(1);
  });
});
