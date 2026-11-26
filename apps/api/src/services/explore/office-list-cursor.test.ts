import { ApiError } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { encodeCursor } from '../../lib/cursor.ts';
import {
  OfficeListCursorSchema,
  officeListCursorOf,
  readOfficeListCursor,
} from './office-list-cursor.ts';

const ID = '01890a5d-ac96-7b3e-9c1d-1f2e3d4c5b6a';

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function expectInvalidCursor(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_cursor'); // checked to be an ApiError above
    return;
  }
  throw new Error('The cursor was accepted.');
}

describe('the office list cursor', () => {
  it('a cursor round-trips', () => {
    const raw = officeListCursorOf('pay', { k: 500, id: ID, p: false });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readOfficeListCursor(raw, 'pay')).toEqual({ v: 1, s: 'pay', k: 500, id: ID, p: false });
    const placeholder = officeListCursorOf('opportunity', { k: null, id: ID, p: true });
    expect(readOfficeListCursor(placeholder, 'opportunity')).toEqual({
      v: 1,
      s: 'opportunity',
      k: null,
      id: ID,
      p: true,
    });
  });

  it("another sort's cursor is refused", () => {
    const raw = officeListCursorOf('ease', { k: 42.5, id: ID, p: false });
    expectInvalidCursor(() => readOfficeListCursor(raw, 'pay'));
  });

  it('a date key and a number key parse', () => {
    const date = officeListCursorOf('deadline', { k: '2027-03-19', id: ID, p: false });
    expect(readOfficeListCursor(date, 'deadline').k).toBe('2027-03-19');
    const number = officeListCursorOf('ease', { k: 61.25, id: ID, p: false });
    expect(readOfficeListCursor(number, 'ease').k).toBe(61.25);
    // A key that is neither is refused.
    expectInvalidCursor(() =>
      readOfficeListCursor(
        base64Url({ v: 1, s: 'deadline', k: 'soon', id: ID, p: false }),
        'deadline',
      ),
    );
    expect(() =>
      encodeCursor(OfficeListCursorSchema, { v: 1, s: 'pay', k: '19 March', id: ID, p: false }),
    ).toThrow();
  });

  it('an unknown version is refused', () => {
    expectInvalidCursor(() =>
      readOfficeListCursor(base64Url({ v: 2, s: 'pay', k: 500, id: ID, p: false }), 'pay'),
    );
    expectInvalidCursor(() =>
      readOfficeListCursor(base64Url({ s: 'pay', k: 500, id: ID, p: false }), 'pay'),
    );
    expectInvalidCursor(() => readOfficeListCursor('not a cursor', 'pay'));
  });
});
