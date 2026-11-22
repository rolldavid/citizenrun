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
