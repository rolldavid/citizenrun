// Personal-data patterns used by the bundle writer, adapter tests and the loader gate (D-084).
// No global flag: a `g` flag would make `test` stateful between calls.
export const STREET_ADDRESS =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+|(?:north|south|east|west)\s+)?(?:[a-z0-9'.-]+\s+){0,4}(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|pl|place|way|hwy|highway|pkwy|parkway|cir|circle|ter|terrace|trl|trail|loop|pike)\b\.?/i;
export const PO_BOX = /\bp\.?\s?o\.?\s*box\s+\d+/i;
export const PHONE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
export const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** True when the text holds a street address, a post office box, a phone number or an email address. */
export function looksPersonal(s: string): boolean {
  return STREET_ADDRESS.test(s) || PO_BOX.test(s) || PHONE.test(s) || EMAIL.test(s);
}
