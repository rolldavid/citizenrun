// The government units a template is applied to: stage 1's jurisdictions with the listing columns
// the template matches on, and the district each unit's offices stand on.
import type { BDistrict, BDistrictFallback, BJurisdiction } from '@citizenrun/shared';
import type { ParsedListingRow } from '../../sources/census-gus.ts';
import { unitTypeCode } from '../base/listing.ts';

export type ExpandUnitKind =
  'county' | 'city' | 'township' | 'school_district' | 'special_district';

export type ExpandUnit = {
  readonly key: string; // census:<PID6>
  readonly kind: ExpandUnitKind;
  readonly name: string;
  readonly population: number | null;
  readonly censusActive: boolean | null;
  readonly timezone: string | null;
  /** The integer before the first space or hyphen of UNIT_TYPE (general purpose units). */
  readonly unitTypeCode: number | null;
  /** FUNCTION_NAME (special districts). */
  readonly functionName: string | null;
  /** SCHOOL_LEVEL_DESCRIPTION. */
  readonly schoolLevel: string | null;
  /** FIPS_STATE + FIPS_COUNTY. */
  readonly countyGeoid: string | null;
  /** FIPS_STATE + FIPS_PLACE (municipalities). */
  readonly placeGeoid: string | null;
  /** The unit's exact tiger: district, else its county_approx: or parent_fallback:...:all district. */
  readonly ownDistrictKey: string;
  /** [ownDistrictKey] when exact; else the via keys of its fallback rows. */
  readonly exactViaKeys: readonly string[];
};

const UNIT_KINDS: ReadonlySet<string> = new Set([
  'county',
  'city',
  'township',
  'school_district',
  'special_district',
]);

function isUnitKind(kind: BJurisdiction['kind']): kind is ExpandUnitKind {
  return UNIT_KINDS.has(kind);
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** The units of the state, and the number left out because they have no district. */
export function planUnits(
  state: string,
  jurisdictions: readonly BJurisdiction[],
  districts: readonly BDistrict[],
  fallbacks: readonly BDistrictFallback[],
  listing: ReadonlyMap<string, ParsedListingRow>,
): { readonly units: readonly ExpandUnit[]; readonly withoutDistrict: number } {
  const owned = new Map<string, BDistrict[]>();
  for (const district of districts) {
    const list = owned.get(district.jurisdiction_key) ?? [];
    list.push(district);
    owned.set(district.jurisdiction_key, list);
  }
  const viaOf = new Map<string, string[]>();
  for (const row of fallbacks) {
    const list = viaOf.get(row.district_key) ?? [];
    list.push(row.via_district_key);
    viaOf.set(row.district_key, list);
  }
  const units: ExpandUnit[] = [];
  let withoutDistrict = 0;
  for (const jurisdiction of jurisdictions) {
    if (jurisdiction.state !== state || !isUnitKind(jurisdiction.kind)) {
      continue;
    }
    const key = jurisdiction.source_key;
    const own = (owned.get(key) ?? []).sort((a, b) => byteOrder(a.source_key, b.source_key));
    const exact = own.find((d) => d.source_key.startsWith('tiger:'));
    const approx =
      own.find((d) => d.source_key === `county_approx:${key}`) ??
      own.find((d) => d.source_key === `parent_fallback:${key}:all`);
    const ownDistrict = exact ?? approx;
    if (ownDistrict === undefined) {
      withoutDistrict += 1;
      continue;
    }
    const listed = listing.get(key.slice('census:'.length)) ?? null;
    const fipsCounty = listed?.fips_county ?? null;
    const fipsPlace = listed?.fips_place ?? null;
    units.push({
      key,
      kind: jurisdiction.kind,
      name: jurisdiction.name,
      population: jurisdiction.population,
      censusActive: jurisdiction.census_active,
      timezone: jurisdiction.timezone,
      unitTypeCode:
        listed !== null && listed.tab === 'General Purpose' ? unitTypeCode(listed.unit_type) : null,
      functionName: listed?.function_name ?? null,
      schoolLevel: listed?.school_level_description ?? null,
      countyGeoid:
        listed !== null && fipsCounty !== null ? `${listed.fips_state}${fipsCounty}` : null,
      placeGeoid: listed !== null && fipsPlace !== null ? `${listed.fips_state}${fipsPlace}` : null,
      ownDistrictKey: ownDistrict.source_key,
      exactViaKeys:
        exact !== undefined
          ? [exact.source_key]
          : [...(viaOf.get(ownDistrict.source_key) ?? [])].sort(byteOrder),
    });
  }
  units.sort((a, b) => byteOrder(a.key, b.key));
  return { units, withoutDistrict };
}

/**
 * The state's county, city, township, school and special district units with their listing columns
 * (the parsed listing keyed by PID6). A unit with no district of its own is left out.
 */
export function unitsFor(
  state: string,
  jurisdictions: readonly BJurisdiction[],
  districts: readonly BDistrict[],
  fallbacks: readonly BDistrictFallback[],
  listing: ReadonlyMap<string, ParsedListingRow>,
): readonly ExpandUnit[] {
  return planUnits(state, jurisdictions, districts, fallbacks, listing).units;
}
