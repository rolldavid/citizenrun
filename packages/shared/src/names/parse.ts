export type Suffix = 'jr' | 'sr' | 'ii' | 'iii' | 'iv' | 'v' | 'vi';

export type NameParts = {
  first: string | null;
  middle: string | null;
  last: string | null;
  suffix: Suffix | null;
  nickname: string | null;
};

/** Surname particles a last name extends backwards over (L-name-parse). */
export const NAME_PARTICLES: ReadonlySet<string> = new Set([
  'da',
  'das',
  'de',
  'del',
  'della',
  'der',
  'di',
  'dos',
  'du',
  'la',
  'le',
  'van',
  'von',
  'st',
  'ter',
  'ten',
  'bin',
  'ibn',
  'al',
  'mac',
]);

/** Titles removed from the front of a name (L-name-parse). */
export const NAME_PREFIXES: ReadonlySet<string> = new Set([
  'dr',
  'mr',
  'mrs',
  'ms',
  'mx',
  'miss',
  'rev',
  'hon',
  'judge',
  'sen',
  'rep',
  'gov',
  'prof',
]);

/** Credentials dropped wherever they stand (L-name-parse). */
export const NAME_CREDENTIALS: ReadonlySet<string> = new Set(['esq', 'md', 'phd', 'cpa', 'jd']);

/** The written forms of each suffix (L-name-parse). */
const SUFFIXES: ReadonlyMap<string, Suffix> = new Map<string, Suffix>([
  ['jr', 'jr'],
  ['junior', 'jr'],
  ['sr', 'sr'],
  ['senior', 'sr'],
  ['ii', 'ii'],
  ['2nd', 'ii'],
  ['iii', 'iii'],
  ['3rd', 'iii'],
  ['iv', 'iv'],
  ['4th', 'iv'],
  ['v', 'v'],
  ['5th', 'v'],
  ['vi', 'vi'],
]);

/**
 * Nickname quotes: double quotes, curly double quotes, parentheses and single quotes, each with a
 * space or an end of the string on both outer sides, so an apostrophe inside a word never opens one.
 */
const NICKNAME_PATTERNS: readonly RegExp[] = [
  /(?<=^|\s)"([^"]*)"(?=\s|$)/u,
  /(?<=^|\s)“([^”]*)”(?=\s|$)/u,
  /(?<=^|\s)\(([^)]*)\)(?=\s|$)/u,
  /(?<=^|\s)'([^']*)'(?=\s|$)/u,
];

const EMPTY: NameParts = { first: null, middle: null, last: null, suffix: null, nickname: null };

function collapse(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function tokensOf(text: string): string[] {
  const collapsed = collapse(text);
  return collapsed === '' ? [] : collapsed.split(' ');
}

function normalised(token: string): string {
  return token.toLowerCase().replace(/[.,]/gu, '');
}

function suffixOf(token: string | undefined): Suffix | null {
  return token === undefined ? null : (SUFFIXES.get(normalised(token)) ?? null);
}

function isParticle(token: string): boolean {
  return NAME_PARTICLES.has(token.toLowerCase().replace(/\./gu, ''));
}

function withoutPrefixes(tokens: readonly string[]): string[] {
  const rest = [...tokens];
  for (;;) {
    const [one, two] = rest;
    if (one?.toLowerCase() === 'the' && two?.toLowerCase() === 'honorable') {
      rest.splice(0, 2);
    } else if (one !== undefined && NAME_PREFIXES.has(one.toLowerCase().replace(/\.$/u, ''))) {
      rest.shift();
    } else {
      return rest;
    }
  }
}

function joined(tokens: readonly string[]): string | null {
  return tokens.length === 0 ? null : tokens.join(' ');
}

/** The space form: first token, middle tokens, and a last name extended over particles. */
function spaceForm(tokens: readonly string[]): Omit<NameParts, 'nickname'> {
  const rest = [...tokens];
  let suffix: Suffix | null = null;
  // A trailing suffix needs two other tokens, so "Mary V" keeps V as the last name.
  const trailing = suffixOf(rest.at(-1));
  if (trailing !== null && rest.length >= 3) {
    suffix = trailing;
    rest.pop();
  }
  if (rest.length === 0) {
    return { first: null, middle: null, last: null, suffix };
  }
  if (rest.length === 1) {
    return { first: null, middle: null, last: rest[0] ?? null, suffix };
  }
  let lastStart = rest.length - 1;
  while (lastStart > 1 && isParticle(rest[lastStart - 1] ?? '')) {
    lastStart -= 1;
  }
  return {
    first: rest[0] ?? null,
    middle: joined(rest.slice(1, lastStart)),
    last: joined(rest.slice(lastStart)),
    suffix,
  };
}

/** The comma form, "LAST, FIRST MIDDLE SUFFIX". */
function commaForm(text: string): Omit<NameParts, 'nickname'> {
  const comma = text.indexOf(',');
  const left = comma === -1 ? text : text.slice(0, comma);
  const right = comma === -1 ? '' : text.slice(comma + 1).replace(/,/gu, ' ');
  const leftTokens = tokensOf(left);
  const rightTokens = withoutPrefixes(tokensOf(right));

  const onlySuffix = rightTokens.length === 1 ? suffixOf(rightTokens[0]) : null;
  if (rightTokens.length === 0 || onlySuffix !== null) {
    const parts = spaceForm(leftTokens);
    return { ...parts, suffix: onlySuffix ?? parts.suffix };
  }

  let suffix: Suffix | null = null;
  const leftTrailing = suffixOf(leftTokens.at(-1));
  if (leftTrailing !== null && leftTokens.length >= 2) {
    suffix = leftTrailing;
    leftTokens.pop();
  }
  // The surname is already the left side, so one other token is enough here.
  const rightTrailing = suffixOf(rightTokens.at(-1));
  if (rightTrailing !== null && rightTokens.length >= 2) {
    suffix ??= rightTrailing;
    rightTokens.pop();
  }
  return {
    first: rightTokens[0] ?? null,
    middle: joined(rightTokens.slice(1)),
    last: joined(leftTokens),
    suffix,
  };
}

/**
 * Splits a person's name into parts, keeping the case they were written in; every part null for an
 * empty name. `last_first` reads lists written "LAST, FIRST MIDDLE SUFFIX"; `auto` reads a comma so.
 */
export function parseName(
  raw: string,
  format: 'auto' | 'last_first' | 'first_last' = 'auto',
): NameParts {
  let text = collapse(raw.normalize('NFKC'));
  if (text === '') {
    return { ...EMPTY };
  }

  let nickname: string | null = null;
  let earliest: RegExpExecArray | null = null;
  for (const pattern of NICKNAME_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null && (earliest === null || match.index < earliest.index)) {
      earliest = match;
    }
  }
  if (earliest !== null) {
    const inner = collapse(earliest[1] ?? '');
    nickname = inner === '' ? null : inner;
    text = collapse(
      text.slice(0, earliest.index) + ' ' + text.slice(earliest.index + earliest[0].length),
    );
  }

  // A dropped credential leaves its comma behind, so "Doe Esq., Jane" still reads as the comma form.
  const tokens = withoutPrefixes(tokensOf(text)).map((token) =>
    NAME_CREDENTIALS.has(normalised(token)) ? token.replace(/[^,]/gu, '') : token,
  );
  const remaining = collapse(tokens.join(' '));
  const parts =
    format === 'last_first' || (format === 'auto' && remaining.includes(','))
      ? commaForm(remaining)
      : spaceForm(tokensOf(remaining.replace(/,/gu, ' ')));
  return { ...parts, nickname };
}
