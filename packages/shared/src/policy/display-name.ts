// The display name rule (L-display-name). The profile text rules call it and keep no name rule of their own.
import { codePointCount } from './code-points.ts';

export const DISPLAY_NAME_MAX = 50; // L-display-name

// Control, format, private-use and surrogate characters, and the variation selectors.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u{FE00}-\u{FE0F}]/gu;
// Check, star, lock and shield marks that imitate a verified badge (L-display-name).
const BADGE_GLYPHS =
  /[\u{2611}\u{2605}\u{2606}\u{2705}\u{2713}\u{2714}\u{272A}\u{272F}\u{2730}\u{1F512}\u{1F5F8}\u{1F6E1}]/gu;
const WHITESPACE_RUN = /\s+/gu;

/**
 * NFKC; control, zero-width, bidirectional, private-use, surrogate, variation-selector and badge-like
 * characters removed; spaces collapsed; null when empty; throws RangeError('too_long') over 50 code points.
 */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(BADGE_GLYPHS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
  if (name === '') {
    return null;
  }
  if (codePointCount(name) > DISPLAY_NAME_MAX) {
    throw new RangeError('too_long');
  }
  return name;
}
