import { filingWindowState, localDateTimeIn } from '@citizenrun/shared';
import type { FilingStatus, FilingWindowInput } from '@citizenrun/shared';

// L-filing-status (PB-07, D-477): the six statuses, mapped from filingWindowState alone. No date is
// counted here.

/** The six-value FilingStatus of one window; no_election for a null input. */
export function filingStatusFor(window: FilingWindowInput | null, now: Date): FilingStatus {
  if (window === null) {
    return 'no_election';
  }
  const state = filingWindowState(window, now);
  switch (state.state) {
    case 'unknown':
      return 'dates_not_known';
    case 'closed':
      return 'closed';
    case 'not_open':
      return 'not_open_yet';
    case 'open':
      return window.opensOn === null ? 'opens_not_known' : 'open';
  }
}

/** An office's status: its next fileable election's, else closed when a non-retired election is still to come in the office's zone, else no_election. */
export function officeFilingStatus(
  input: { next: FilingWindowInput | null; lastElectionDate: string | null; zone: string | null },
  now: Date,
): FilingStatus {
  if (input.next !== null) {
    return filingStatusFor(input.next, now);
  }
  // R-161: an office with an election still to come but nothing left to file for is closed.
  // YYYY-MM-DD strings compare as dates.
  if (
    input.lastElectionDate !== null &&
    input.lastElectionDate >= localDateTimeIn(input.zone, now).date
  ) {
    return 'closed';
  }
  return 'no_election';
}
