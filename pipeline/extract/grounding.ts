// PIPE-grounding: the quote rule of D-286 rule 2. No fuzzy matching (D-286 rule 4).

// Built from a string: two of these code points are irregular whitespace, which a pattern literal
// may not name.
const DELETED = new RegExp('\\u00AD|\\u200B|\\u200C|\\u200D|\\u2060|\\uFEFF', 'g');
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u2039\u203A`]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;
const WHITESPACE = /\s+/gu;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]/gu;
/** A skeleton key shorter than this never grounds a quote on its own. */
const SKELETON_MIN = 20;

/** NFKC; invisible characters deleted; quotes and dashes mapped to ASCII; whitespace collapsed; lower case. */
export function tightKey(s: string): string {
  return s
    .normalize('NFKC')
    .replace(DELETED, '')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(WHITESPACE, ' ')
    .trim()
    .toLowerCase();
}

/** The tight key with everything but letters and digits removed. */
export function skeletonKey(s: string): string {
  return tightKey(s).replace(NOT_LETTER_OR_DIGIT, '');
}

export type TextKeys = { readonly tight: string; readonly skeleton: string };

/** Both keys of a text, computed once per text. */
export function textKeys(text: string): TextKeys {
  const tight = tightKey(text);
  return { tight, skeleton: tight.replace(NOT_LETTER_OR_DIGIT, '') };
}

/**
 * True when the quote's tight key is in the text's tight key, or its skeleton has at least 20
 * characters and is in the text's skeleton.
 */
export function isQuoteGrounded(quote: string, keys: TextKeys): boolean {
  const tight = tightKey(quote);
  if (tight !== '' && keys.tight.includes(tight)) {
    return true;
  }
  const skeleton = skeletonKey(quote);
  return skeleton.length >= SKELETON_MIN && keys.skeleton.includes(skeleton);
}
