import { describe, expect, it } from 'vitest';
import { englishT } from '../i18n/format/english-t.fixtures.ts';
import { deadlineLabel } from './deadline-label.ts';

const t = englishT();
const NEW_YORK = 'America/New_York';

describe('deadlineLabel', () => {
  it('unknown', () => {
    expect(deadlineLabel({ state: 'unknown' }, NEW_YORK, t)).toBe('Filing deadline not known yet');
  });

  it('not open counts the days until it opens', () => {
    expect(
      deadlineLabel({ state: 'not_open', opensInDays: 1, closesInDays: 20 }, NEW_YORK, t),
    ).toBe('Filing opens in 1 day');
    expect(
      deadlineLabel({ state: 'not_open', opensInDays: 9, closesInDays: 20 }, NEW_YORK, t),
    ).toBe('Filing opens in 9 days');
  });

  it('closes today with no time', () => {
    expect(deadlineLabel({ state: 'open', daysLeft: 0, closesTime: null }, NEW_YORK, t)).toBe(
      'Filing closes today',
    );
  });

  it('closes today at a time, named with its zone', () => {
    expect(deadlineLabel({ state: 'open', daysLeft: 0, closesTime: '12:00' }, NEW_YORK, t)).toBe(
      'Filing closes today at 12:00 noon Eastern',
    );
  });

  it('closes in some days', () => {
    expect(deadlineLabel({ state: 'open', daysLeft: 1, closesTime: '17:00' }, NEW_YORK, t)).toBe(
      'Filing closes in 1 day',
    );
    expect(deadlineLabel({ state: 'open', daysLeft: 12, closesTime: null }, NEW_YORK, t)).toBe(
      'Filing closes in 12 days',
    );
  });

  it('closed', () => {
    expect(deadlineLabel({ state: 'closed', closedDaysAgo: 3 }, NEW_YORK, t)).toBe('Filing closed');
  });

  it('negative days left are refused', () => {
    expect(() =>
      deadlineLabel({ state: 'open', daysLeft: -1, closesTime: null }, NEW_YORK, t),
    ).toThrow(RangeError);
  });
});
