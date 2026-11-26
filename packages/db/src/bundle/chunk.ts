// Id lists in bounded pieces: one statement or one job payload per piece.

export const ID_CHUNK = 5000; // J-score.issues

/** `items` in order, `size` at a time; the last piece holds the rest. No items give no pieces. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('A chunk size is a positive integer.');
  }
  const pieces: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    pieces.push(items.slice(start, start + size));
  }
  return pieces;
}
