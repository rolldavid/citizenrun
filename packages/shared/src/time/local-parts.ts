import type { LocalDateTime } from './days-until.ts';

type Form = 'parts' | 'year' | 'month' | 'day' | 'hour' | 'minute';

const OPTIONS: Readonly<Record<Form, Intl.DateTimeFormatOptions>> = {
  parts: {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  },
  year: { year: 'numeric' },
  month: { month: '2-digit' },
  day: { day: '2-digit' },
  hour: { hour: '2-digit', hourCycle: 'h23' },
  minute: { minute: '2-digit' },
};

// Filled on first use, so importing this module does no work. A zone Intl refused is kept as null.
const formatters = new Map<string, Intl.DateTimeFormat | null>();

/** The cached formatter of one form in `zone`; RangeError when Intl does not know the zone. */
function formatterFor(zone: string, form: Form): Intl.DateTimeFormat {
  const cacheKey = `${form} ${zone}`;
  let formatter = formatters.get(cacheKey);
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', { ...OPTIONS[form], timeZone: zone });
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      formatter = null;
    }
    formatters.set(cacheKey, formatter);
  }
  if (formatter === null) {
    throw new RangeError('Unknown time zone.');
  }
  return formatter;
}

const pad = (digits: string): string => digits.padStart(2, '0');

function assemble(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
): LocalDateTime {
  return { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}` };
}

/** The local date and HH:MM time at `now` in `zone`, read with formatToParts; RangeError for a zone Intl refuses. */
export function localPartsByFormatToParts(zone: string, now: Date): LocalDateTime {
  const found: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatterFor(zone, 'parts').formatToParts(now)) {
    found[part.type] = part.value;
  }
  return assemble(
    found.year ?? '',
    found.month ?? '',
    found.day ?? '',
    found.hour ?? '',
    found.minute ?? '',
  );
}

function digitsOf(zone: string, form: Form, now: Date): string {
  return /\d+/.exec(formatterFor(zone, form).format(now))?.[0] ?? '';
}

/**
 * The same as localPartsByFormatToParts, from five formatters of one field each, for engines that
 * have no formatToParts (Hermes on iOS); RangeError for a zone Intl refuses.
 */
export function localPartsByFields(zone: string, now: Date): LocalDateTime {
  return assemble(
    digitsOf(zone, 'year', now),
    digitsOf(zone, 'month', now),
    digitsOf(zone, 'day', now),
    digitsOf(zone, 'hour', now),
    digitsOf(zone, 'minute', now),
  );
}
