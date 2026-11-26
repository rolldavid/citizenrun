// Fixture values for the placeholders of the worked Washington example, one YAML text per
// occurrence in file order. Every URL is under example.test and every quote is visibly fake.

const PLACEHOLDER = /<<placeholder[^>]*>>/g;

const url = (slug: string) => `https://example.test/wa/${slug}`;
const quote = (text: string) => `"Fixture text: ${text}"`;
const citation = (section: string) => `"Fixture RCW ${section}"`;
const cited = (value: string, slug: string, text: string) =>
  `{ value: ${value}, source_url: ${url(slug)}, quote: ${quote(text)}, citation: ${citation(slug)} }`;
/** source_url, quote and citation of one cited value, in that order. */
const proof = (slug: string, text: string) => [url(slug), quote(text), citation(slug)];

export const WA_FIXTURE_VALUES: readonly string[] = [
  'local',
  ...proof('county-elected', 'each county is governed by elected commissioners.'),
  '3',
  ...proof('county-districts', 'the board has three commissioners, one from each district.'),
  '4',
  ...proof('county-term', 'commissioners serve terms of four years.'),
  'false',
  ...proof('county-partisan', 'county commissioners are elected on a nonpartisan ballot.'),
  ...proof('governor-seat', 'the executive power is vested in one governor.'),
  '4',
  ...proof('governor-term', 'the governor serves a term of four years.'),
  'true',
  ...proof('governor-partisan', 'the governor states a party preference.'),
  `{ kind: salary, amount_cents: 20000000, period: year, source_url: ${url('governor-pay')}, quote: ${quote('the governor receives an annual salary of 200,000 dollars.')}, citation: ${citation('governor-pay')} }`,
  'odd',
  '4',
  '2026',
  '4',
  ...proof('senate-term', 'senators serve terms of four years.'),
  'true',
  ...proof('senate-partisan', 'senators state a party preference.'),
  'null',
  '2',
  ...proof('house-seats', 'each district elects two representatives.'),
  'positions',
  '"Position {n}"',
  '2',
  '2026',
  '2',
  ...proof('house-term', 'representatives serve terms of two years.'),
  'true',
  ...proof('house-partisan', 'representatives state a party preference.'),
  'null',
  cited('true', 'congress-partisan', 'candidates for Congress state a party preference.'),
  cited('true', 'congress-partisan', 'candidates for Congress state a party preference.'),
  '"Fixture RCW 54"',
  ...proof('pud-chapter', 'public utility districts are formed under this chapter.'),
  ...proof('pud-elected', 'the commissioners of a public utility district are elected by its voters.'),
  cited('3', 'pud-districts', 'the commission has three members, one from each district.'),
  cited('6', 'pud-term', 'commissioners serve terms of six years.'),
  cited('false', 'pud-partisan', 'district commissioners are elected on a nonpartisan ballot.'),
  ...proof('pco-elected', 'precinct committee officers are elected at the primary.'),
  '"one per precinct per party"',
  ...proof('pco-seats', 'each party elects one precinct committee officer in each precinct.'),
  cited('1', 'pco-seats', 'each party elects one precinct committee officer in each precinct.'),
  ...proof('pco-partisan', 'precinct committee officers are party offices.'),
];

/** A placeholder count that differs from the list of fixture values. */
export class FixtureValuesMismatch extends Error {
  override readonly name = 'FixtureValuesMismatch';
}

/** Puts each fixture value in place of its placeholder; throws when the counts differ. */
export function fillWaExample(text: string): string {
  const found = text.match(PLACEHOLDER)?.length ?? 0;
  if (found !== WA_FIXTURE_VALUES.length) {
    throw new FixtureValuesMismatch(
      `the example has ${String(found)} placeholders and the list ${String(WA_FIXTURE_VALUES.length)} values`,
    );
  }
  let index = 0;
  return text.replace(PLACEHOLDER, () => {
    const value = WA_FIXTURE_VALUES[index] ?? '';
    index += 1;
    return value;
  });
}
