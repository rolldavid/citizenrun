// Numbered legislative districts (D-313): the TIGER GEOID is the state FIPS code and the Open
// States label left-padded with zeros to three characters.

const NUMBERED_LABEL = /^[0-9A-Z]{1,3}$/;

/**
 * `stateFips` plus the trimmed, upper-cased label padded to three characters; null for a label
 * that is not one to three letters and digits.
 */
export function numberedGeoid(stateFips: string, label: string): string | null {
  const code = label.trim().toUpperCase();
  return NUMBERED_LABEL.test(code) ? stateFips + code.padStart(3, '0') : null;
}
