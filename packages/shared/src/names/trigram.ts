/** The padded word trigrams of a string, as pg_trgm forms them: two spaces before each word, one after. */
function trigrams(text: string): Set<string> {
  const found = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    // pg_trgm counts characters, so the word is split into code points, not UTF-16 units.
    const padded = Array.from(`  ${word} `);
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      found.add(padded.slice(i, i + 3).join(''));
    }
  }
  return found;
}

/** pg_trgm similarity, from 0 to 1: |A ∩ B| / |A ∪ B| over the padded word trigrams of each string; 0 when both have none. */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  let shared = 0;
  for (const trigram of left) {
    if (right.has(trigram)) {
      shared += 1;
    }
  }
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}
