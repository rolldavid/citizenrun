import { describe, expect, it } from 'vitest';
import { STATE_CODES } from './geo.ts';

describe('STATE_CODES', () => {
  it('56 unique codes', () => {
    expect(STATE_CODES).toHaveLength(56);
    expect(new Set(STATE_CODES).size).toBe(56);
  });

  it('the six non-state codes close the list in order', () => {
    expect(STATE_CODES.slice(50)).toEqual(['DC', 'PR', 'GU', 'VI', 'AS', 'MP']);
    expect(STATE_CODES.slice(0, 3)).toEqual(['AL', 'AK', 'AZ']);
    expect(STATE_CODES[49]).toBe('WY');
  });

  it('every code is two upper-case letters', () => {
    for (const code of STATE_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });
});
