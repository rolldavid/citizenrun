import { describe, expect, it } from 'vitest';
import { boardControl } from './board-control.ts';

describe('boardControl', () => {
  it('null for a single-person or unknown body', () => {
    expect(boardControl(null, 3, true, [])).toBeNull();
    expect(boardControl(1, 1, null, [])).toBeNull();
    expect(boardControl(9, null, false, [])).toBeNull();
  });

  it('a nonpartisan board', () => {
    expect(boardControl(7, 4, false, ['democratic', 'republican'])).toEqual({
      seatsUp: 4,
      bodySize: 7,
      majority: 4,
      partySplit: null,
    });
  });

  it('a partisan board counts parties', () => {
    expect(
      boardControl(5, 2, true, ['democratic', 'republican', 'republican', null, 'democratic']),
    ).toEqual({
      seatsUp: 2,
      bodySize: 5,
      majority: 3,
      partySplit: { democratic: 2, republican: 2, unknown: 1 },
    });
  });

  it('a partisan board with no known holders has an empty split', () => {
    expect(boardControl(3, 1, true, [])).toEqual({
      seatsUp: 1,
      bodySize: 3,
      majority: 2,
      partySplit: {},
    });
  });

  it('an even board', () => {
    expect(boardControl(6, 3, null, [])).toEqual({
      seatsUp: 3,
      bodySize: 6,
      majority: 4,
      partySplit: null,
    });
  });

  it('a body of two needs both seats', () => {
    expect(boardControl(2, 1, false, [])?.majority).toBe(2);
  });

  it('impossible sizes are refused', () => {
    expect(() => boardControl(0, 0, false, [])).toThrow(RangeError);
    expect(() => boardControl(-5, 2, false, [])).toThrow(RangeError);
    expect(() => boardControl(5, -1, false, [])).toThrow(RangeError);
    expect(() => boardControl(5.5, 2, false, [])).toThrow(RangeError);
  });
});
