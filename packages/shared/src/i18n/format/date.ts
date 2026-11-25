/** The ways a calendar date is written (L-format-date). */
export type DateStyle = 'long' | 'medium' | 'short' | 'weekday' | 'weekdayShort';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const STYLE_OPTIONS: Readonly<Record<DateStyle, Intl.DateTimeFormatOptions>> = {
  long: { year: 'numeric', month: 'long', day: 'numeric' },
  medium: { year: 'numeric', month: 'short', day: 'numeric' },
  short: { month: 'short', day: 'numeric' },
  weekday: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
  weekdayShort: { weekday: 'short', month: 'short', day: 'numeric' },
};

/**
 * A YYYY-MM-DD calendar date as written, with no time-zone conversion: the date is built with
 * `Date.UTC` and formatted in UTC, so no zone shifts the day. A string that is not a real date
 * throws RangeError.
 */
export function formatDate(date: string, locale: string, style: DateStyle): string {
  const match = DATE_PATTERN.exec(date);
  if (match === null) {
    throw new RangeError('Not a calendar date.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls an impossible day over into the next month; a real date reads back unchanged.
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new RangeError('Not a calendar date.');
  }
  return new Intl.DateTimeFormat(locale, { ...STYLE_OPTIONS[style], timeZone: 'UTC' }).format(
    instant,
  );
}
