import { describe, expect, it } from 'vitest';

// A specimen is what the next screen's words are modelled on, so the gallery writes numbers and
// dates as the product does: numerals with their unit, a date with its weekday ("Fri, Nov 27"),
// and never a day count without its date.

// Read as text: a fixtures file loaded as a module would draw its components.
const FIXTURES = import.meta.glob('./**/*.fixtures.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const SPELLED = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
const DAY_COUNT = /\bin \d+ days?\b/i;
const WEEKDAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const LONG_MONTH =
  '(?:January|February|March|April|June|July|August|September|October|November|December)';
const DATED = new RegExp(`${WEEKDAY}, ${MONTH} \\d{1,2}\\b`);
/** A month and a day with no weekday before them, or with the month spelled out. */
const BARE_DATE = new RegExp(
  `(?<!${WEEKDAY}, )\\b${MONTH} \\d{1,2}\\b|\\b${LONG_MONTH} \\d{1,2}\\b`,
);

/** The words a fixtures file gives a specimen: its quoted strings and its JSX text, comments left out. */
function wordsOf(source: string): string[] {
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .join('\n');
  const quoted = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map(
    (match) => match[1] ?? match[2] ?? '',
  );
  const betweenTags = [...code.matchAll(/>([^<>{}]+)</g)].map((match) => match[1] ?? '');
  // A phrase has a space; an id, a variant name or a path has none.
  return [...quoted, ...betweenTags]
    .map((words) => words.trim())
    .filter((words) => words.includes(' '));
}

/** What a phrase gets wrong, or null. */
function faultOf(words: string): string | null {
  if (SPELLED.test(words)) return 'spells a number out';
  if (DAY_COUNT.test(words) && !DATED.test(words)) return 'counts days and gives no date';
  if (BARE_DATE.test(words)) return 'writes a date without its weekday';
  return null;
}

describe('the specimens’ words', () => {
  it('faultOf knows the three faults', () => {
    expect(faultOf('Closes in five days')).toBe('spells a number out');
    expect(faultOf('Filing closes in 3 days.')).toBe('counts days and gives no date');
    expect(faultOf('Filing closes May 14')).toBe('writes a date without its weekday');
    expect(faultOf('Filing opens on January 12.')).toBe('writes a date without its weekday');
    expect(faultOf('Filing closes in 3 days, on Fri, Nov 27.')).toBeNull();
    expect(faultOf('Filing closes Fri, Nov 27')).toBeNull();
    expect(faultOf('Filing opens in March and closes in May.')).toBeNull();
    expect(faultOf('The steps you ticked are kept for 30 days.')).toBeNull();
  });

  it('wordsOf reads quoted strings and JSX text, and leaves comments and ids out', () => {
    const source = [
      '// Three sentences: the block grows.',
      "  warning: { kind: 'warning', text: 'Closes in 3 days.', testID: 'gallery.two-lines' },",
      '  <Text role="body">Carol Wynn holds the office.</Text>',
      '      <Text role="body">',
      '        The term is 4 years.',
      '      </Text>',
    ].join('\n');
    expect(wordsOf(source)).toEqual([
      'Closes in 3 days.',
      'Carol Wynn holds the office.',
      'The term is 4 years.',
    ]);
  });

  it('every fixtures file writes numerals, dated day counts and dates with their weekday', () => {
    const files = Object.entries(FIXTURES);
    expect(files.length).toBeGreaterThan(20);
    const faults = files.flatMap(([file, source]) =>
      wordsOf(source).flatMap((words) => {
        const fault = faultOf(words);
        return fault === null ? [] : [`${file}: "${words}" ${fault}`];
      }),
    );
    expect(faults).toEqual([]);
  });
});
