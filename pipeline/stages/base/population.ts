// Populations of stage 1 (D-312, P8-10, P8-11): the listing's POPULATION for general-purpose units,
// ACS B01001 for districts whose vintage matches, and 2020 block sums for the rest.
import type { FieldMetaRow } from '@citizenrun/shared';
import type { AcsRow } from '../../sources/acs.ts';
import { LISTING_URL } from '../../sources/census-gus.ts';
import type { ParsedListingRow } from '../../sources/census-gus.ts';
import type { LayerId } from './geometry.ts';

export const ACS_POPULATION_YEAR = 2024;
export const BLOCK_SUM_POPULATION_YEAR = 2020;

/**
 * The ACS summary level of each layer; null where the ACS rows describe another vintage (cd120,
 * the 2026 legislative maps) or no level exists (CONCITY), so the district takes a block sum.
 */
export const ACS_LEVEL: Readonly<Record<LayerId, string | null>> = Object.freeze({
  state: '040',
  county: '050',
  cousub: '060',
  place: '160',
  unsd: '970',
  elsd: '950',
  scsd: '960',
  cd: null,
  sldu: null,
  sldl: null,
  concity: null,
});

export type AcsIndex = ReadonlyMap<string, AcsRow>;

const acsKey = (sumlev: string, geoid: string): string => `${sumlev}:${geoid}`;

/** The ACS rows of one state (GEOIDs that begin with its FIPS code), by summary level and GEOID. */
export function acsIndex(rows: Iterable<AcsRow>, stateFips: string): AcsIndex {
  const out = new Map<string, AcsRow>();
  for (const row of rows) {
    if (row.geoid.startsWith(stateFips)) {
      out.set(acsKey(row.sumlev, row.geoid), row);
    }
  }
  return out;
}

export type DistrictPopulation = {
  readonly population: number;
  readonly population_18: number;
  readonly meta: FieldMetaRow;
};

/** The ACS population of a layer's feature, or null when its layer takes a block sum or it has no row. */
export function acsPopulation(
  index: AcsIndex,
  layer: LayerId,
  geoid: string,
  fileUrl: string,
  checkedAt: string,
): DistrictPopulation | null {
  const level = ACS_LEVEL[layer];
  if (level === null) {
    return null;
  }
  const row = index.get(acsKey(level, geoid));
  if (row === undefined) {
    return null;
  }
  return {
    population: row.total,
    population_18: row.age18,
    meta: {
      source_url: fileUrl,
      quote: `GEO_ID ${row.geo_id}: B01001`,
      confidence: 'medium',
      checked_at: checkedAt,
      population_source: 'acs5',
      population_year: ACS_POPULATION_YEAR,
    },
  };
}

/** The block-sum population of a district: P1 and P3 summed over the blocks its geometry covers. */
export function blockSumPopulation(
  sum: { p1: number; p3: number; blocks: number },
  plFileUrl: string,
  checkedAt: string,
): DistrictPopulation {
  return {
    population: sum.p1,
    population_18: sum.p3,
    meta: {
      source_url: plFileUrl,
      quote: `blocks covered: ${String(sum.blocks)}`,
      confidence: 'medium',
      checked_at: checkedAt,
      population_source: 'pl94171-block-sum',
      population_year: BLOCK_SUM_POPULATION_YEAR,
    },
  };
}

/** A general-purpose unit's listing POPULATION and its proof; null for other tabs or no value. */
export function listingPopulation(
  row: Pick<
    ParsedListingRow,
    'tab' | 'pid6' | 'unit_name' | 'population' | 'population_source_year'
  >,
  checkedAt: string,
): { population: number; meta: FieldMetaRow } | null {
  if (row.tab !== 'General Purpose' || row.population === null) {
    return null;
  }
  const year = row.population_source_year;
  return {
    population: row.population,
    meta: {
      source_url: LISTING_URL,
      quote: `PID6 ${row.pid6}: ${row.unit_name}`,
      confidence: 'medium',
      checked_at: checkedAt,
      population_source: 'census-gus',
      ...(year !== null && year >= 2000 && year <= 2100 ? { population_year: year } : {}),
    },
  };
}
