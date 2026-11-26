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
