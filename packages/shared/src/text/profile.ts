// The text fields of the profile (L-profile-text). The name and link rules are L-display-name's and
// L-links' functions (D-473, D-474); lengths are counted in code points after normalisation.
import { BIO_MAX } from '../constants/accounts.ts';
import { codePointCount } from '../policy/code-points.ts';
import { normalizeDisplayName } from '../policy/display-name.ts';
import { parseSafeUrl } from '../policy/links.ts';

export type ProfileTextError = 'too_long' | 'invalid_format';
export type ProfileTextResult =
  { ok: true; value: string | null } | { ok: false; error: ProfileTextError };

// Control characters other than the line feed.
const CONTROL_EXCEPT_LINE_FEED = /(?!\n)\p{Cc}/gu;
const ZERO_WIDTH = /[\u{200B}-\u{200D}\u{2060}\u{FEFF}]/gu;
const BIDI_CONTROLS = /[\u{200E}\u{200F}\u{061C}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;
const LINE_FEED_RUN = /\n{3,}/g;

/** The name rule: normalizeDisplayName, its RangeError('too_long') mapped to too_long; null in gives null out. */
export function normalizeProfileName(raw: string | null): ProfileTextResult {
  if (raw === null) {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: normalizeDisplayName(raw) };
  } catch (error) {
    if (error instanceof RangeError && error.message === 'too_long') {
      return { ok: false, error: 'too_long' };
    }
    throw error;
  }
}

/** The bio rule; over BIO_MAX code points gives too_long; empty gives null; null in gives null out. */
export function normalizeBio(raw: string | null): ProfileTextResult {
  if (raw === null) {
    return { ok: true, value: null };
  }
  const bio = raw
    .normalize('NFC')
    .replace(CONTROL_EXCEPT_LINE_FEED, '')
    .replace(ZERO_WIDTH, '')
    .replace(BIDI_CONTROLS, '')
    .replace(LINE_FEED_RUN, '\n\n')
    .trim();
  if (bio === '') {
    return { ok: true, value: null };
  }
  if (codePointCount(bio) > BIO_MAX) {
    return { ok: false, error: 'too_long' };
  }
  return { ok: true, value: bio };
}

/** The link rule: parseSafeUrl with its default limit; null from it gives invalid_format; null in gives null out. */
export function normalizeProfileLink(raw: string | null): ProfileTextResult {
  if (raw === null) {
    return { ok: true, value: null };
  }
  const parsed = parseSafeUrl(raw);
  if (parsed === null) {
    return { ok: false, error: 'invalid_format' };
  }
  return { ok: true, value: parsed.url };
}

/** Apple's first-authorization name: the non-null parts joined by one space, then the name rule; both null gives null. */
export function appleDisplayName(
  givenName: string | null,
  familyName: string | null,
): ProfileTextResult {
  const parts = [givenName, familyName].filter((part): part is string => part !== null);
  if (parts.length === 0) {
    return { ok: true, value: null };
  }
  return normalizeProfileName(parts.join(' '));
}
