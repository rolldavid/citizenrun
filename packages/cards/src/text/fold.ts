import { faceAdvances } from '../layout-text.ts';
import type { FontFace } from '../primitives/types.ts';

// CARD-text-fold (D-271): what a canvas draws for a character its face lacks, because the server has
// no other font to fall back to. A character the face has is never changed.

const MARKS = { first: 0x0300, last: 0x036f } as const;
const LETTER = /^\p{L}$/u;
const SPACE = /^\s$/u;

/** True when every code point of the NFC text has an advance in the face; true for an empty string. */
export function canDraw(text: string, face: FontFace): boolean {
  const advances = faceAdvances(face);
  for (const ch of text.normalize('NFC')) {
    if (!Object.hasOwn(advances, ch)) return false;
  }
  return true;
}

/** What one missing code point becomes, or null when it is removed. */
function foldOne(ch: string, has: (ch: string) => boolean): string | null {
  if (ch === 'ʻ') return has('‘') ? '‘' : null;
  if (ch === 'ʼ') return has('’') ? '’' : null;
  const [base, ...marks] = Array.from(ch.normalize('NFD'));
  if (
    base !== undefined &&
    marks.length > 0 &&
    LETTER.test(base) &&
    marks.every((mark) => {
      const point = mark.codePointAt(0) ?? 0;
      return point >= MARKS.first && point <= MARKS.last;
    }) &&
    has(base)
  ) {
    return base;
  }
  return null;
}

/**
 * The text with each code point the face lacks folded (the okina and the modifier apostrophe to
 * quotation marks, an accented letter to its base letter) or removed, then its white space collapsed
 * to single spaces and trimmed. An empty string, or one with nothing drawable, gives ''.
 */
export function foldForCanvas(text: string, face: FontFace): string {
  const advances = faceAdvances(face);
  const has = (ch: string): boolean => Object.hasOwn(advances, ch);
  let folded = '';
  for (const ch of text.normalize('NFC')) {
    // White space is kept for the collapse below, so a removed tab or line break never joins two words.
    if (has(ch) || SPACE.test(ch)) {
      folded += ch;
      continue;
    }
    folded += foldOne(ch, has) ?? '';
  }
  return folded.replace(/\s+/gu, ' ').trim();
}
