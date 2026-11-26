// Business hours and election night (D-331).

/** The zone of a request with no state, or a state with no zone entry. */
export const FALLBACK_ZONE = 'America/New_York';

const BUSINESS_START_HOUR = 8; // D-331
const BUSINESS_END_HOUR = 18; // D-331
const ELECTION_NIGHT_START_HOUR = 17; // D-331
const ELECTION_NIGHT_END_HOUR = 6; // D-331
const WEEKDAYS: ReadonlySet<string> = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, found);
  }
  return found;
}

type LocalTime = { weekday: string; date: string; hour: number };

function localTime(nowMs: number, zone: string): LocalTime {
  const parts = new Map<string, string>();
  for (const part of formatter(zone).formatToParts(new Date(nowMs))) {
    parts.set(part.type, part.value);
  }
  return {
    weekday: parts.get('weekday') ?? '',
    date: `${parts.get('year') ?? ''}-${parts.get('month') ?? ''}-${parts.get('day') ?? ''}`,
    hour: Number(parts.get('hour') ?? '0') % 24,
  };
}

function dayBefore(date: string): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}

/** Monday to Friday, from 08:00 up to but not including 18:00, local time in `zone`. */
export function isBusinessHours(nowMs: number, zone: string): boolean {
  const local = localTime(nowMs, zone);
  return (
    WEEKDAYS.has(local.weekday) &&
    local.hour >= BUSINESS_START_HOUR &&
    local.hour < BUSINESS_END_HOUR
  );
}

/** From 17:00 local on a listed election date until 06:00 local the next day. */
export function isElectionNight(
  nowMs: number,
  zone: string,
  electionDates: readonly string[],
): boolean {
  if (electionDates.length === 0) {
    return false;
  }
  const local = localTime(nowMs, zone);
  if (local.hour >= ELECTION_NIGHT_START_HOUR && electionDates.includes(local.date)) {
    return true;
  }
  return local.hour < ELECTION_NIGHT_END_HOUR && electionDates.includes(dayBefore(local.date));
}
