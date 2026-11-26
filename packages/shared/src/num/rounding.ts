function assertDivisionArguments(n: number, d: number): void {
  if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(d) || d <= 0) {
    throw new RangeError('Expected a non-negative safe integer and a positive safe integer.');
  }
}

/** x rounded half away from zero to `digits` decimal places; never negative zero. */
export function roundHalfAwayFromZero(x: number, digits = 0): number {
  const scale = 10 ** digits;
  const rounded = (Math.sign(x) * Math.floor(Math.abs(x) * scale + 0.5)) / scale;
  // Math.sign(-0.4) * 0 is -0; a rounded zero is always written as 0.
  return rounded === 0 ? 0 : rounded;
}

/** ceil(n / d) for integers n >= 0 and d > 0, exact while n + d < 2^53; RangeError otherwise. */
export function ceilDiv(n: number, d: number): number {
  assertDivisionArguments(n, d);
  return Math.floor((n + d - 1) / d);
}

/** round(n / d) half up, for integers n >= 0 and d > 0, exact while 2n + d < 2^53; RangeError otherwise. */
export function roundDiv(n: number, d: number): number {
  assertDivisionArguments(n, d);
  return Math.floor((2 * n + d) / (2 * d));
}

/** x limited to [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}
