// L-review-signin: an address App Review can sign in with without an inbox, every limit still applied.
// The start-up refusals of the two variables are the env module's.

/** The review addresses of `REVIEW_SIGNIN_EMAILS`: split on commas, trimmed, lower-cased, empties dropped; empty when unset. */
export function parseReviewEmails(raw: string | null): ReadonlySet<string> {
  if (raw === null) {
    return new Set();
  }
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item !== ''),
  );
}

/** Whether `email` is a review address, compared case-insensitively. */
export function isReviewAddress(email: string, reviewEmails: ReadonlySet<string>): boolean {
  return reviewEmails.has(email.trim().toLowerCase());
}
