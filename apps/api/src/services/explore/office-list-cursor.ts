import { ApiError, OfficeSortSchema } from '@citizenrun/shared';
import type { OfficeSort } from '@citizenrun/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../lib/cursor.ts';

/**
 * The cursor of the office list (L-office-list step 5, L-cursor): the sort, the last row's key (a
 * number, a `YYYY-MM-DD` date or null), its id, and its placeholder flag (false on the ranked path).
 */
export const OfficeListCursorSchema = z.object({
  v: z.literal(1),
  s: OfficeSortSchema,
  k: z.union([z.number(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]),
  id: z.uuid(),
  p: z.boolean(),
});

export type OfficeListCursor = z.infer<typeof OfficeListCursorSchema>;

/** Reads a cursor of `sort`; one that fails to parse or names another sort is 400 `invalid_cursor`. */
export function readOfficeListCursor(raw: string, sort: OfficeSort): OfficeListCursor {
  const cursor = decodeCursor(OfficeListCursorSchema, raw);
  if (cursor.s !== sort) {
    throw new ApiError('invalid_cursor');
  }
  return cursor;
}

/** The cursor after the given row of a page of `sort`. */
export function officeListCursorOf(
  sort: OfficeSort,
  row: { k: number | string | null; id: string; p: boolean },
): string {
  return encodeCursor(OfficeListCursorSchema, { v: 1, s: sort, k: row.k, id: row.id, p: row.p });
}
