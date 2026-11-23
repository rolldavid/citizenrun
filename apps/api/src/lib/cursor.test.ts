import { ApiError } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from './cursor.ts';

const CursorSchema = z.object({ s: z.array(z.string().max(32)).max(4), i: z.uuid() });
const VALUE = { s: ['2027-03-05'], i: '0195d2c4-7b3a-7c00-8a00-000000000001' };

function expectInvalidCursor(run: () => unknown): void {
  let thrown: unknown = null;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ApiError);
  expect((thrown as ApiError).code).toBe('invalid_cursor'); // checked to be an ApiError above
}

describe('L-cursor', () => {
  it('a cursor round-trips', () => {
    expect(decodeCursor(CursorSchema, encodeCursor(CursorSchema, VALUE))).toEqual(VALUE);
  });

  it('cursors carry no padding', () => {
    // Lengths that would need one and two padding characters in standard base64.
    for (const value of [
      VALUE,
      { s: ['2027-03-0'], i: VALUE.i },
      { s: ['2027-03-'], i: VALUE.i },
    ]) {
      const cursor = encodeCursor(CursorSchema, value);
      expect(cursor).not.toContain('=');
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('encoding parses the value with the schema', () => {
    expect(() => encodeCursor(CursorSchema, { s: ['x'], i: 'not-a-uuid' })).toThrow();
  });

  it('a cursor over 512 characters is invalid_cursor', () => {
    const long = Buffer.from(JSON.stringify({ s: ['a'.repeat(400)], i: VALUE.i })).toString(
      'base64url',
    );
    expect(long.length).toBeGreaterThan(512);
    const loose = z.object({ s: z.array(z.string()), i: z.uuid() });
    expectInvalidCursor(() => decodeCursor(loose, long));
  });

  it('a non-base64url character is invalid_cursor', () => {
    const cursor = encodeCursor(CursorSchema, VALUE);
    expectInvalidCursor(() => decodeCursor(CursorSchema, `${cursor}=`));
    expectInvalidCursor(() => decodeCursor(CursorSchema, cursor.replace(/.$/, '+')));
    expectInvalidCursor(() =>
      decodeCursor(CursorSchema, `${cursor.slice(0, 4)}/${cursor.slice(5)}`),
    );
  });

  it('base64url of non-JSON is invalid_cursor', () => {
    expectInvalidCursor(() =>
      decodeCursor(CursorSchema, Buffer.from('{not json', 'utf8').toString('base64url')),
    );
    expectInvalidCursor(() => decodeCursor(CursorSchema, ''));
  });

  it('JSON that fails the schema is invalid_cursor', () => {
    const wrong = Buffer.from(JSON.stringify({ s: '2027-03-05', i: 7 }), 'utf8').toString(
      'base64url',
    );
    expectInvalidCursor(() => decodeCursor(CursorSchema, wrong));
  });
});
