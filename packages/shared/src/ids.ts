import { v7 } from 'uuid';

/** A new version 7 uuid: sorts by creation time to the millisecond (D-063, D-239). */
export function newId(): string {
  return v7();
}

/**
 * The smallest version 7 uuid of the millisecond of `at` (the uuid floor), which turns "rows since
 * this time" into a primary-key range. Throws RangeError for an invalid date or a time before 1970.
 */
export function uuidFloor(at: Date): string {
  const ms = at.getTime();
  if (Number.isNaN(ms) || ms < 0) {
    throw new RangeError('uuidFloor needs a valid date from 1970 on');
  }
  const hex = ms.toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;
}
