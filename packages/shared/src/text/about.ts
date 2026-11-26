/** True when a known value takes the "about" form: its confidence is low or it is an estimate; false for a null value. */
export function isAbout(
  value: unknown,
  meta: { confidence: 'high' | 'medium' | 'low' } | null,
  estimated: boolean | null,
): boolean {
  if (value === null) {
    return false;
  }
  return meta?.confidence === 'low' || estimated === true;
}
