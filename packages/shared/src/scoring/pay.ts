import { roundHalfAwayFromZero } from '../num/rounding.ts';

/** Weeks in a year of effective hourly pay (L-pay-derived). */
const WEEKS_PER_YEAR = 52;

function assertNotNegative(value: number | null): void {
  if (value !== null && !(value >= 0)) {
    throw new RangeError('Pay and time are never negative.');
  }
}

/** Term pay in whole cents: annual pay × term length in years; null when either is null. RangeError for a negative input. */
export function termPayCents(
  payAnnualCents: number | null,
  termYears: number | null,
): number | null {
  assertNotNegative(payAnnualCents);
  assertNotNegative(termYears);
  if (payAnnualCents === null || termYears === null) {
    return null;
  }
  return roundHalfAwayFromZero(payAnnualCents * termYears);
}

/** Effective hourly pay in whole cents: annual pay ÷ (hours per week × 52); null unless both are known and hours > 0. RangeError for a negative input. */
export function effectiveHourlyCents(
  payAnnualCents: number | null,
  hoursPerWeek: number | null,
): number | null {
  assertNotNegative(payAnnualCents);
  assertNotNegative(hoursPerWeek);
  if (payAnnualCents === null || hoursPerWeek === null || hoursPerWeek === 0) {
    return null;
  }
  return roundHalfAwayFromZero(payAnnualCents / (hoursPerWeek * WEEKS_PER_YEAR));
}
