// Election night (D-331; D-882 removed the business-hours rule).

/** The zone of a request with no state, or a state with no zone entry. */
export const FALLBACK_ZONE = 'America/New_York';

const ELECTION_NIGHT_START_HOUR = 17; // D-331
const ELECTION_NIGHT_END_HOUR = 6; // D-331

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
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

type LocalTime = { date: string; hour: number };

function localTime(nowMs: number, zone: string): LocalTime {
  const parts = new Map<string, string>();
  for (const part of formatter(zone).formatToParts(new Date(nowMs))) {
    parts.set(part.type, part.value);
  }
  return {
    date: `${parts.get('year') ?? ''}-${parts.get('month') ?? ''}-${parts.get('day') ?? ''}`,
    hour: Number(parts.get('hour') ?? '0') % 24,
  };
}

function dayBefore(date: string): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
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
