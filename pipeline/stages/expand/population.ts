// A county union's population: the 2020 block sums of its counties, by the county prefix of each
// block's GEOID20, with no geometry join (2020 blocks nest within counties; D-312).
import type { FieldMetaRow } from '@citizenrun/shared';

export type CountyBlockSum = { readonly p1: number; readonly p3: number; readonly blocks: number };

export type BlockSumInput = {
  /** Five-digit county GEOID to the sums of its 2020 blocks. */
  readonly byCounty: ReadonlyMap<string, CountyBlockSum>;
  /** As stage 1 writes it for its own block sums. */
  readonly proof: { readonly source_url: string; readonly checked_at: string };
};

const COUNTY_PREFIX = 5;
const BLOCK_SUM_YEAR = 2020;

/**
 * For every block whose GEOID begins with a county of `counties`, adds its P1, P3 and one block to
 * that county's sums. A county no block carries has no entry.
 */
export function countyBlockSums(
  blocks: Iterable<{ readonly geoid: string; readonly p1: number; readonly p3: number }>,
  counties: ReadonlySet<string>,
): ReadonlyMap<string, CountyBlockSum> {
  const sums = new Map<string, { p1: number; p3: number; blocks: number }>();
  for (const block of blocks) {
    const county = block.geoid.slice(0, COUNTY_PREFIX);
    if (!counties.has(county)) {
      continue;
    }
    const sum = sums.get(county) ?? { p1: 0, p3: 0, blocks: 0 };
    sum.p1 += block.p1;
    sum.p3 += block.p3;
    sum.blocks += 1;
    sums.set(county, sum);
  }
  return sums;
}

/**
 * The union's population and voting-age population with their proof. Null ("not known yet") when
 * there are no sums, or when any listed county has no block: a partial sum is never given.
 */
export function unionPopulation(
  counties: readonly string[],
  sums: BlockSumInput | null,
): {
  readonly population: number | null;
  readonly population_18: number | null;
  readonly field_meta: Readonly<Record<'population' | 'population_18', FieldMetaRow>> | null;
} {
  const unknown = { population: null, population_18: null, field_meta: null };
  if (sums === null) {
    return unknown;
  }
  let p1 = 0;
  let p3 = 0;
  let blocks = 0;
  for (const county of new Set(counties)) {
    const sum = sums.byCounty.get(county);
    if (sum === undefined) {
      return unknown;
    }
    p1 += sum.p1;
    p3 += sum.p3;
    blocks += sum.blocks;
  }
  const meta: FieldMetaRow = {
    source_url: sums.proof.source_url,
    quote: `blocks covered: ${String(blocks)}`,
    confidence: 'medium',
    checked_at: sums.proof.checked_at,
    population_source: 'pl94171-block-sum',
    population_year: BLOCK_SUM_YEAR,
  };
  return {
    population: p1,
    population_18: p3,
    field_meta: { population: meta, population_18: meta },
  };
}
