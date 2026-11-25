// The account age rules (L-account-age). NEW_ACCOUNT_DAYS is the one constant for the 7-day age (D-475).

const HOUR_MS = 60 * 60 * 1000;
const DAY_HOURS = 24;

export const NEW_ACCOUNT_DAYS = 7; // L-account-age
export const FIRST_DAY_HOURS = 24; // L-account-age

/** True while the account is under 7 days old (exactly 7 × 24 hours after createdAt it is not new). */
export function isNewAccount(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < NEW_ACCOUNT_DAYS * DAY_HOURS * HOUR_MS;
}

/** True while the account is under 24 hours old. */
export function isFirstDay(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < FIRST_DAY_HOURS * HOUR_MS;
}
