import { describe, expect, it } from 'vitest';
import { ZZ_BLOCKS } from '../../__fixtures__/s04/zz-blocks.ts';
import { countyBlockSums, unionPopulation } from './population.ts';

const PROOF = {
  source_url: 'https://example.test/zz/pl94171.zip',
  checked_at: '2026-11-01T00:00:00.000Z',
};

describe('county union population', () => {
  it('a two-county union over a fixture block list gets the hand-summed P1 and P3', () => {
    const byCounty = countyBlockSums(ZZ_BLOCKS, new Set(['99001', '99003']));
    expect([...byCounty]).toEqual([
      ['99001', { p1: 150, p3: 115, blocks: 2 }],
      ['99003', { p1: 200, p3: 150, blocks: 1 }],
    ]);
    expect(byCounty.has('99005')).toBe(false);
    const meta = {
      source_url: PROOF.source_url,
      quote: 'blocks covered: 3',
      confidence: 'medium',
      checked_at: PROOF.checked_at,
      population_source: 'pl94171-block-sum',
      population_year: 2020,
    };
    expect(unionPopulation(['99001', '99003'], { byCounty, proof: PROOF })).toEqual({
      population: 350,
      population_18: 265,
      field_meta: { population: meta, population_18: meta },
    });
  });

  it('a county listed twice is counted once', () => {
    const byCounty = countyBlockSums(ZZ_BLOCKS, new Set(['99001', '99003']));
    const result = unionPopulation(['99001', '99001', '99003'], { byCounty, proof: PROOF });
    expect([result.population, result.population_18]).toEqual([350, 265]);
    expect(result.field_meta?.population.quote).toBe('blocks covered: 3');
  });

  it('a county with no block gives null', () => {
    const byCounty = countyBlockSums(ZZ_BLOCKS, new Set(['99001', '99007']));
    expect(unionPopulation(['99001', '99007'], { byCounty, proof: PROOF })).toEqual({
      population: null,
      population_18: null,
      field_meta: null,
    });
    expect(unionPopulation(['99001'], null)).toEqual({
      population: null,
      population_18: null,
      field_meta: null,
    });
  });
});
