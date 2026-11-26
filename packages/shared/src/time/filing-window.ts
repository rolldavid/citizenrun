import { daysUntil, localDateTimeIn } from './days-until.ts';

/** One filing window: a track's dates and closing time, or an election's headline ones. */
export type FilingWindowInput = {
  opensOn: string | null;
  closesOn: string | null;
  closesTime: string | null;
  zone: string | null;
};

/** Where a filing window stands. */
export type FilingWindowState =
  | { state: 'unknown' }
  | { state: 'not_open'; opensInDays: number; closesInDays: number }
  | { state: 'open'; daysLeft: number; closesTime: string | null }
  | { state: 'closed'; closedDaysAgo: number };

/** Where a filing window stands at `now`, counted in the jurisdiction's zone; `unknown` when the closing date is null. */
export function filingWindowState(input: FilingWindowInput, now: Date): FilingWindowState {
  const { opensOn, closesOn, closesTime, zone } = input;
  if (closesOn === null) {
    return { state: 'unknown' };
  }
  const d = daysUntil(closesOn, zone, now);
  if (d < 0) {
    return { state: 'closed', closedDaysAgo: -d };
  }
  // A null closing time keeps the window open all of its last day: no closing hour is assumed (D-081).
  if (d === 0 && closesTime !== null && localDateTimeIn(zone, now).time >= closesTime) {
    return { state: 'closed', closedDaysAgo: 0 };
  }
  if (opensOn !== null) {
    const opensInDays = daysUntil(opensOn, zone, now);
    if (opensInDays > 0) {
      return { state: 'not_open', opensInDays, closesInDays: d };
    }
  }
  return { state: 'open', daysLeft: d, closesTime };
}
