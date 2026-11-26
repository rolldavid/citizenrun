function padded(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

/**
 * The calendar date of an instant where the device is, as YYYY-MM-DD; null for a string that is
 * no instant.
 */
export function localDateOf(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  return `${padded(at.getFullYear(), 4)}-${padded(at.getMonth() + 1, 2)}-${padded(at.getDate(), 2)}`;
}

/**
 * The day and the time of an instant where the device is ("Mar 5, 5:04 PM"), written with the
 * options of L-format-instant's `dateTime`; null for a string that is no instant.
 */
export function instantDateTime(iso: string, locale: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}
