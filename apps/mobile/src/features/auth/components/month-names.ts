/** Any year does: every year has the same twelve months. */
const YEAR = 2024;

/** The twelve long month names of a locale, January first (C-AgeGate). */
export function monthNames(locale: string): readonly string[] {
  const format = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, month) =>
    format.format(new Date(Date.UTC(YEAR, month, 1))),
  );
}
