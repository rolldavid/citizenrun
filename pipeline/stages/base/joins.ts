// The joins of listing units to TIGER features (D-311, P8-08): by codes, never by names.
import type { ParsedListingRow } from '../../sources/census-gus.ts';
import type { Check, UnitKind } from './listing.ts';

export type JoinLayer = 'county' | 'place' | 'cousub' | 'concity' | 'unsd' | 'elsd' | 'scsd';

/** The GEOIDs of each layer's features in the state (the attribute tables). */
export type TigerGeoids = Readonly<Record<JoinLayer, ReadonlySet<string>>>;

export type JoinUnit = Pick<
  ParsedListingRow,
  'pid6' | 'tab' | 'fips_state' | 'fips_county' | 'fips_place'
> & { readonly kind: UnitKind };

export type FeatureRef = { readonly layer: JoinLayer; readonly geoid: string };

/** The kinds whose join rate is counted: the three general-purpose kinds and school districts. */
export type JoinKind = 'county' | 'city' | 'township' | 'school_district';
export const JOIN_KINDS: readonly JoinKind[] = ['county', 'city', 'township', 'school_district'];

export type JoinResult = {
  /** Each joined unit's feature, by PID6. */
  readonly joins: ReadonlyMap<string, FeatureRef>;
  /** The unit that owns each joined feature (`<layer>:<GEOID>`): the smallest PID6 that joins it. */
  readonly owners: ReadonlyMap<string, string>;
  /** The PID6s that joined a feature a unit with a smaller PID6 owns. */
  readonly shared: readonly string[];
  readonly counts: Readonly<Record<JoinKind, { units: number; matched: number }>>;
};

export const featureId = (ref: FeatureRef): string => `${ref.layer}:${ref.geoid}`;

const SCHOOL_LAYERS: readonly JoinLayer[] = ['unsd', 'elsd', 'scsd'];

function findFeature(
  unit: JoinUnit,
  tiger: TigerGeoids,
  ncesByPid6: ReadonlyMap<string, string>,
): FeatureRef | null {
  const { fips_state: st, fips_county: county, fips_place: place } = unit;
  switch (unit.kind) {
    case 'county': {
      // FIPS_PLACE on a county row is a placeholder, so counties join through the county code only.
      if (county === null) return null;
      const geoid = `${st}${county}`;
      return tiger.county.has(geoid) ? { layer: 'county', geoid } : null;
    }
    case 'city': {
      if (place === null) return null;
      const geoid = `${st}${place}`;
      if (tiger.place.has(geoid)) return { layer: 'place', geoid };
      return tiger.concity.has(geoid) ? { layer: 'concity', geoid } : null;
    }
    case 'township': {
      if (county === null || place === null) return null;
      const geoid = `${st}${county}${place}`;
      return tiger.cousub.has(geoid) ? { layer: 'cousub', geoid } : null;
    }
    case 'school_district': {
      const nces = ncesByPid6.get(unit.pid6);
      if (nces === undefined) return null;
      for (const layer of SCHOOL_LAYERS) {
        if (tiger[layer].has(nces)) return { layer, geoid: nces };
      }
      return null;
    }
    case 'special_district':
      return null;
  }
}

/**
 * Joins each unit to at most one feature: counties by `FIPS_STATE + FIPS_COUNTY`; municipalities
 * by `FIPS_STATE + FIPS_PLACE` in PLACE, else CONCITY; townships by `FIPS_STATE + FIPS_COUNTY +
 * FIPS_PLACE` in COUSUB; school districts by PID6 to NCESID in UNSD, then ELSD, then SCSD. When
 * two units join one feature the smaller PID6 owns it.
 */
export function joinUnits(
  units: readonly JoinUnit[],
  tiger: TigerGeoids,
  ncesByPid6: ReadonlyMap<string, string>,
): JoinResult {
  const joins = new Map<string, FeatureRef>();
  const owners = new Map<string, string>();
  const counts: Record<JoinKind, { units: number; matched: number }> = {
    county: { units: 0, matched: 0 },
    city: { units: 0, matched: 0 },
    township: { units: 0, matched: 0 },
    school_district: { units: 0, matched: 0 },
  };
  for (const unit of units) {
    const ref = findFeature(unit, tiger, ncesByPid6);
    if (unit.kind !== 'special_district') {
      counts[unit.kind].units += 1;
      if (ref !== null) counts[unit.kind].matched += 1;
    }
    if (ref === null) continue;
    joins.set(unit.pid6, ref);
    const id = featureId(ref);
    const owner = owners.get(id);
    if (owner === undefined || unit.pid6 < owner) {
      owners.set(id, unit.pid6);
    }
  }
  const shared = [...joins]
    .filter(([pid6, ref]) => owners.get(featureId(ref)) !== pid6)
    .map(([pid6]) => pid6)
    .sort();
  return { joins, owners, shared, counts };
}

/** True when `matched` is at least `permille` thousandths of `units`; a kind with no units passes. */
export function rateAtLeast(matched: number, units: number, permille: number): boolean {
  return matched * 1000 >= units * permille;
}

export const JOIN_RATE_PERMILLE = 990;
export const SCHOOL_WARN_PERMILLE = 950;

/** The school-district join rate in thousandths, or null when the state has no school units. */
export function schoolJoinPermille(result: JoinResult): number | null {
  const { units, matched } = result.counts.school_district;
  return units === 0 ? null : Math.floor((matched * 1000) / units);
}

function describe(kind: JoinKind, count: { units: number; matched: number }): string {
  return `${kind} ${String(count.matched)}/${String(count.units)}`;
}

/**
 * The blocking check `join_rate` (counties, places with CONCITY matches, county subdivisions each at
 * least 99.0%) and the reported `school_join_rate` (passed at 95.0% and above; never blocking).
 */
export function joinRateCheck(result: JoinResult): { joinRate: Check; schoolRate: Check } {
  const blocking: JoinKind[] = ['county', 'city', 'township'];
  const low = blocking.filter((kind) => {
    const { units, matched } = result.counts[kind];
    return !rateAtLeast(matched, units, JOIN_RATE_PERMILLE);
  });
  const school = result.counts.school_district;
  const schoolDetail = describe('school_district', school);
  const detail = [
    ...blocking.map((kind) => describe(kind, result.counts[kind])),
    schoolDetail,
  ].join(', ');
  return {
    joinRate: {
      name: 'join_rate',
      passed: low.length === 0,
      detail: low.length === 0 ? detail : `${detail}; below 99.0%: ${low.join(', ')}`,
    },
    schoolRate: {
      name: 'school_join_rate',
      passed: rateAtLeast(school.matched, school.units, SCHOOL_WARN_PERMILLE),
      detail: schoolDetail,
    },
  };
}
