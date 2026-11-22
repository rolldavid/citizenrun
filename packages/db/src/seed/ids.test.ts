import { describe, expect, it } from 'vitest';
import { seedId } from './ids.ts';

const AT = new Date('2027-03-05T22:00:00.000Z');
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('seedId', () => {
  it('seedId is deterministic and time-ordered', () => {
    const first = seedId('post', 1, AT);
    const second = seedId('post', 2, AT);
    expect(first).toBe('01a417b4-f700-7fd9-964f-5a5a8c94cc4b');
    expect(second).toBe('01a417b4-f700-7de1-9a43-fe5628346904');
    expect(seedId('post', 1, AT)).toBe(first);

    const later = seedId('post', 1, new Date(AT.getTime() + 1));
    for (const id of [first, second, later]) {
      expect(id).toMatch(UUID_V7);
    }
    expect([later, second, first].sort()).toEqual([first, second, later].sort());
    expect(later > first && later > second).toBe(true);
  });

  it('gives different kinds different random bits at the same time', () => {
    expect(seedId('comment', 1, AT)).not.toBe(seedId('post', 1, AT));
    expect(seedId('comment', 1, AT).slice(0, 13)).toBe(seedId('post', 1, AT).slice(0, 13));
  });

  it('refuses an invalid date and a negative or fractional ordinal', () => {
    expect(() => seedId('post', 1, new Date('not a date'))).toThrow(RangeError);
    expect(() => seedId('post', 1, new Date(-1))).toThrow(RangeError);
    expect(() => seedId('post', -1, AT)).toThrow(RangeError);
    expect(() => seedId('post', 1.5, AT)).toThrow(RangeError);
  });
});
