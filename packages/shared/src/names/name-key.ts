/**
 * Letters with no decomposition that the database's unaccent rules still map, so the mirror and
 * os_name_key agree (L-name-key-mirror).
 */
const UNACCENT_EXTRA: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ł: 'l',
  þ: 'th',
  ð: 'd',
  ı: 'i',
};

/** lower(unaccent(first || ' ' || last)) with everything but a-z, 0-9 and spaces removed; null when empty or both are null. */
export function nameKey(first: string | null, last: string | null): string | null {
  const key = `${first ?? ''} ${last ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[ßæœøđłþðı]/gu, (letter) => UNACCENT_EXTRA[letter] ?? letter)
    .replace(/[^a-z0-9 ]/gu, '')
    .replace(/ +/gu, ' ')
    .trim();
  return key === '' ? null : key;
}
