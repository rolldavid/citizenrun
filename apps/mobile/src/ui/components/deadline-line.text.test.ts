import { createI18n } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import { describe, expect, it, vi } from 'vitest';

import { closingLineText, closingRowText } from './deadline-line';
import type { ClosingInput } from './deadline-line';

// The two functions are pure and live in the component's file. The parts that draw the line load
// modules only a page or a phone can, and this project has neither; the texts need none of them.
vi.mock('./flag', () => ({ Flag: (): null => null }));
vi.mock('./text', () => ({ Text: (): null => null }));

// The typed t accepts catalog keys only; the two functions pass each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;

const OPEN: ClosingInput = { state: 'open', date: 'Fri, Nov 27', time: null };
const OPEN_AT: ClosingInput = { state: 'open', date: 'Fri, Nov 27', time: '5:00 pm Pacific' };
const NOT_OPEN: ClosingInput = { state: 'not_open', date: 'Mon, Nov 23', time: null };
const CLOSED: ClosingInput = { state: 'closed', date: 'Fri, Nov 6', time: null };
const UNKNOWN: ClosingInput = { state: 'unknown', date: null, time: null };
const NONE: ClosingInput = { state: 'none', date: null, time: null };

describe('the closing texts', () => {
  it('closing lines', () => {
    expect(closingLineText(OPEN, t)).toBe(
      'Filing closes Fri, Nov 27. Confirm with your election office.',
    );
    expect(closingLineText(OPEN_AT, t)).toBe(
      'Filing closes Fri, Nov 27 at 5:00 pm Pacific. Confirm with your election office.',
    );
    expect(closingLineText(NOT_OPEN, t)).toBe(
      'Filing opens Mon, Nov 23. Confirm with your election office.',
    );
    expect(closingLineText(CLOSED, t)).toBe('Filing closed Fri, Nov 6.');
    expect(closingLineText(UNKNOWN, t)).toBe(
      'Filing deadline not known yet. Confirm with your election office.',
    );
    expect(closingLineText(NONE, t)).toBe('No election scheduled yet.');
    // A time is said only for an open window: the other states never take one from their input.
    expect(closingLineText({ ...NOT_OPEN, time: '5:00 pm Pacific' }, t)).toBe(
      'Filing opens Mon, Nov 23. Confirm with your election office.',
    );
    expect(closingLineText({ ...CLOSED, time: '5:00 pm Pacific' }, t)).toBe(
      'Filing closed Fri, Nov 6.',
    );
  });

  it('row texts', () => {
    const texts = [
      closingRowText(OPEN, t),
      closingRowText(OPEN_AT, t),
      closingRowText(NOT_OPEN, t),
      closingRowText(CLOSED, t),
      closingRowText(UNKNOWN, t),
      closingRowText(NONE, t),
    ];
    expect(texts).toEqual([
      'closes Fri, Nov 27',
      'closes Fri, Nov 27 at 5:00 pm Pacific',
      'opens Mon, Nov 23',
      'closed Fri, Nov 6',
      'filing deadline not known yet',
      'no election scheduled yet',
    ]);
    // A row never counts the days: it says the date.
    for (const text of texts) {
      expect(text).not.toMatch(/\bdays?\b/i);
    }
    // A row with no stated time says none.
    expect(closingRowText(OPEN, t)).not.toContain(' at ');
  });

  it('a dated state needs its date', () => {
    for (const state of ['open', 'not_open', 'closed'] as const) {
      for (const time of [null, '5:00 pm Pacific']) {
        const input: ClosingInput = { state, date: null, time };
        expect(() => closingLineText(input, t), state).toThrow(RangeError);
        expect(() => closingRowText(input, t), state).toThrow(RangeError);
      }
    }
    // The two states with no date to say take none.
    expect(() => closingLineText(UNKNOWN, t)).not.toThrow();
    expect(() => closingRowText(NONE, t)).not.toThrow();
  });
});
