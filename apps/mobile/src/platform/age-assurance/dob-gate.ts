// PM-age-assurance: the month-and-year gate, shared by both index files. Pure: the month and year are read
// to answer and never kept (D-350).

export const GATE_BLOCK_MS = 24 * 60 * 60 * 1000; // CTL-75: the block lasts 24 hours

const FIRST_YEAR = 1900;
const UTC_DATE = /^(\d{4})-\d{2}-\d{2}$/;

/**
 * 'adult' when `today` (a UTC date, 'YYYY-MM-DD') is on or after the first day of the month after the given
 * month, 18 years later. An impossible month or year, or a malformed `today`, answers 'minor'.
 */
export function evaluateBirthMonth(
  birth: { year: number; month: number },
  today: string,
): 'adult' | 'minor' {
  const match = UTC_DATE.exec(today);
  if (match === null) {
    return 'minor';
  }
  const todayYear = Number(match[1]);
  const { year, month } = birth;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return 'minor';
  }
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > todayYear) {
    return 'minor';
  }
  const targetYear = month === 12 ? year + 19 : year + 18;
  const targetMonth = month === 12 ? 1 : month + 1;
  const threshold = `${String(targetYear)}-${String(targetMonth).padStart(2, '0')}-01`;
  return today >= threshold ? 'adult' : 'minor';
}

/** The instant the gate's lock ends: `now` plus 24 hours, as an ISO string. */
export function blockedUntilFrom(now: Date): string {
  return new Date(now.getTime() + GATE_BLOCK_MS).toISOString();
}
