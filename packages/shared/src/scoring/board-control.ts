/** Seats up, body size, the majority and, for a partisan body, its current seats by party. */
export type BoardControl = {
  seatsUp: number;
  bodySize: number;
  majority: number;
  partySplit: Record<string, number> | null;
};

/** The key a null party is counted under (L-board-control). */
const UNKNOWN_PARTY = 'unknown';

/**
 * "N of M seats are up; K make a majority" (L-board-control); null for a single-person office, an unknown
 * body size or unknown seats up. RangeError for a body size below 1 or negative seats up.
 */
export function boardControl(
  bodySize: number | null,
  seatsUpNext: number | null,
  partisan: boolean | null,
  holderParties: readonly (string | null)[],
): BoardControl | null {
  if (bodySize !== null && !(Number.isInteger(bodySize) && bodySize >= 1)) {
    throw new RangeError('A body has at least one seat.');
  }
  if (seatsUpNext !== null && !(Number.isInteger(seatsUpNext) && seatsUpNext >= 0)) {
    throw new RangeError('Seats up is a whole number, never negative.');
  }
  if (bodySize === null || bodySize === 1 || seatsUpNext === null) {
    return null;
  }
  const majority = Math.floor(bodySize / 2) + 1;
  let partySplit: Record<string, number> | null = null;
  if (partisan === true) {
    const counts = new Map<string, number>();
    for (const party of holderParties) {
      const key = party ?? UNKNOWN_PARTY;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // fromEntries defines own properties, so a party key can never reach the prototype.
    partySplit = Object.fromEntries(counts);
  }
  return { seatsUp: seatsUpNext, bodySize, majority, partySplit };
}
