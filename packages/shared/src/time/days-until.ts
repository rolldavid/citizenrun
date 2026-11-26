import { localPartsByFields, localPartsByFormatToParts } from './local-parts.ts';

/** The zone used when a jurisdiction has none, so time left is never overstated (L-days-until). */
export const FALLBACK_TIME_ZONE = 'America/New_York';

/** A calendar date `YYYY-MM-DD` and a 24-hour time of day `HH:MM`. */
export type LocalDateTime = { date: string; time: string };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// formatToParts when the engine has it, else one field at a time: a capability check, not a platform check.
function readLocalParts(zone: string, now: Date): LocalDateTime {
  return typeof Intl.DateTimeFormat.prototype.formatToParts === 'function'
    ? localPartsByFormatToParts(zone, now)
    : localPartsByFields(zone, now);
}

/** The calendar date and the HH:MM time of day at `now` in the IANA zone; the fallback zone when the zone is null or not a zone Intl knows. */
export function localDateTimeIn(zone: string | null, now: Date): LocalDateTime {
  if (zone !== null && zone !== FALLBACK_TIME_ZONE) {
    try {
      return readLocalParts(zone, now);
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
    }
  }
  return readLocalParts(FALLBACK_TIME_ZONE, now);
}

/** Midnight UTC of a real YYYY-MM-DD date, in milliseconds; RangeError for anything else. */
function utcMidnight(date: string): number {
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
  return instant.getTime();
}

/** Whole calendar days from today in `zone` to `date`: 0 on the day itself, negative after it; the fallback zone when null. */
export function daysUntil(date: string, zone: string | null, now: Date): number {
  const target = utcMidnight(date);
  const today = utcMidnight(localDateTimeIn(zone, now).date);
  // Both are midnights in UTC, so the quotient is a whole number.
  return (target - today) / 86_400_000;
}
