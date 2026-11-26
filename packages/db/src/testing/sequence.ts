let current = 0;

/** The next number of the factory sequence: 1, 2, 3, ... until resetSequence(). */
export function nextSequence(): number {
  current += 1;
  return current;
}

/** Restarts the factory sequence, so the next nextSequence() is 1. */
export function resetSequence(): void {
  current = 0;
}

let districtOrdinal = 0;

/** The ordinal of the next fixture district in the test: 0, 1, 2, ... until resetDistrictOrdinal(). */
export function nextDistrictOrdinal(): number {
  const ordinal = districtOrdinal;
  districtOrdinal += 1;
  return ordinal;
}

/** Restarts the district ordinal, so the next fixture district is number 0 again. */
export function resetDistrictOrdinal(): void {
  districtOrdinal = 0;
}
