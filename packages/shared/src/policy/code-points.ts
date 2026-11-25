/** The length of `text` in Unicode code points, the unit every handle, name and bio limit counts in. */
export function codePointCount(text: string): number {
  return Array.from(text).length;
}
