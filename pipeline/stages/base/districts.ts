// District rows of stage 1 (B-districts, B-district_fallbacks): exact districts from TIGER, and the
// approximate and fallback districts of units with no exact boundary (D-058, D-321, P8-09).
import { BDistrictFallbackSchema, BDistrictSchema, BGeometrySchema } from '@citizenrun/shared';
import type { BDistrict, BDistrictFallback, FieldMetaMap } from '@citizenrun/shared';
import mapshaper from 'mapshaper';
import { listZip, openZipEntry } from '../../lib/zip.ts';
import type { ParsedListingRow } from '../../sources/census-gus.ts';
import { fallbackGeomHash, fallbackGeometry, featuresFromGeoJson } from './geometry.ts';
import type { GeometryRow, LayerFeature, LayerId, MultiPolygonCoords } from './geometry.ts';
import { stateKey, unitKey } from './jurisdictions.ts';
import type { UnitKind } from './listing.ts';
import type { DistrictPopulation } from './population.ts';

export type Level = BDistrict['level'];

export const districtKey = (layer: LayerId, geoid: string): string => `tiger:${layer}:${geoid}`;
export const countyApproxKey = (pid6: string): string => `county_approx:${unitKey(pid6)}`;
export const parentFallbackKey = (pid6: string): string => `parent_fallback:${unitKey(pid6)}:all`;

/** B-districts `level` by layer. */
export function levelFor(layer: LayerId): Level {
  switch (layer) {
    case 'county':
      return 'county';
    case 'cd':
      return 'federal';
    case 'state':
    case 'sldu':
    case 'sldl':
      return 'state';
    case 'place':
    case 'cousub':
    case 'unsd':
    case 'elsd':
    case 'scsd':
    case 'concity':
      return 'local';
  }
}

/** The layers whose every feature is a district of the state (stage 2 builds offices on them). */
export const STATE_WIDE_LAYERS: readonly LayerId[] = ['state', 'cd', 'sldu', 'sldl'];

/** The Census "not defined" code of each district layer, and the field that holds it. */
const UNDEFINED_CODE: Partial<Record<LayerId, { field: string; code: string }>> = {
  cd: { field: 'CD120FP', code: 'ZZ' },
  sldu: { field: 'SLDUST', code: 'ZZZ' },
  sldl: { field: 'SLDLST', code: 'ZZZ' },
};

/** True for a feature whose district code is the "not defined" code: it is not a district. */
export function isUndefinedDistrict(
  layer: LayerId,
  geoid: string,
  feature?: LayerFeature,
): boolean {
  const rule = UNDEFINED_CODE[layer];
  if (rule === undefined) return false;
  const value = feature?.properties[rule.field];
  return value === rule.code || geoid.endsWith(rule.code);
}

export type ExactDistrict = {
  readonly key: string;
  readonly layer: LayerId;
  readonly geoid: string;
  readonly jurisdictionKey: string;
  readonly name: string;
};

/** An exact district's row; its population and proof when it has one. */
export function exactDistrictRow(
  district: { key: string; jurisdictionKey: string; name: string; level: Level },
  geomHash: string,
  population: DistrictPopulation | null,
): BDistrict {
  const fieldMeta: FieldMetaMap = {};
  if (population !== null) {
    fieldMeta['population'] = population.meta;
    fieldMeta['population_18'] = population.meta;
  }
  return BDistrictSchema.parse({
    source_key: district.key,
    jurisdiction_key: district.jurisdictionKey,
    name: district.name,
    level: district.level,
    geometry_quality: 'exact',
    geom_hash: geomHash,
    population: population?.population ?? null,
    population_18: population?.population_18 ?? null,
    lean: null,
    lean_basis: null,
    field_meta: fieldMeta,
  });
}

export type ApproxUnit = Pick<
  ParsedListingRow,
  'pid6' | 'tab' | 'fips_state' | 'fips_county' | 'parent_pid6'
> & {
  readonly kind: UnitKind;
  readonly name: string;
};

export type ApproxDistrict = {
  readonly key: string;
  readonly jurisdictionKey: string;
  readonly name: string;
  readonly level: Level;
  readonly quality: 'county_approx' | 'parent_fallback';
  readonly via: string;
};

/**
 * The stand-in district of each unit with no exact district: a special district, and a school unit
 * with no NCES match or no matched feature, stands in through its county (`county_approx`); a
 * dependent school system whose parent has an exact district stands in through the parent's
 * (`parent_fallback`). A unit whose county is not in the county layer is unplaced.
 */
export function planApproxDistricts(input: {
  readonly units: readonly ApproxUnit[];
  /** The exact district of each unit that has one, by PID6. */
  readonly exactByPid6: ReadonlyMap<string, string>;
  /** The GEOIDs of the state's county layer. */
  readonly countyGeoids: ReadonlySet<string>;
}): { approx: ApproxDistrict[]; unplaced: string[] } {
  const approx: ApproxDistrict[] = [];
  const unplaced: string[] = [];
  for (const unit of input.units) {
    if (input.exactByPid6.has(unit.pid6)) continue;
    if (unit.kind !== 'special_district' && unit.kind !== 'school_district') continue;
    const jurisdictionKey = unitKey(unit.pid6);
    if (unit.tab === 'DEP School Dist' && unit.parent_pid6 !== null) {
      const parentDistrict = input.exactByPid6.get(unit.parent_pid6);
      if (parentDistrict !== undefined) {
        approx.push({
          key: parentFallbackKey(unit.pid6),
          jurisdictionKey,
          name: unit.name,
          level: 'local',
          quality: 'parent_fallback',
          via: parentDistrict,
        });
        continue;
      }
    }
    const county = unit.fips_county === null ? null : `${unit.fips_state}${unit.fips_county}`;
    if (county === null || !input.countyGeoids.has(county)) {
      unplaced.push(unit.pid6);
      continue;
    }
    approx.push({
      key: countyApproxKey(unit.pid6),
      jurisdictionKey,
      name: unit.name,
      level: unit.kind === 'special_district' ? 'special' : 'local',
      quality: 'county_approx',
      via: districtKey('county', county),
    });
  }
  return { approx, unplaced };
}

/** An approximate or fallback district's row: no population of its own ("not known yet"). */
export function approxDistrictRow(district: ApproxDistrict): BDistrict {
  return BDistrictSchema.parse({
    source_key: district.key,
    jurisdiction_key: district.jurisdictionKey,
    name: district.name,
    level: district.level,
    geometry_quality: district.quality,
    geom_hash: fallbackGeomHash([district.via]),
    population: null,
    population_18: null,
    lean: null,
    lean_basis: null,
    field_meta: {},
  });
}

export function fallbackRow(district: ApproxDistrict): BDistrictFallback {
  return BDistrictFallbackSchema.parse({
    source_key: `${district.key}|${district.via}`,
    district_key: district.key,
    via_district_key: district.via,
  });
}

/** The geometry row of an approximate district: no WKB, the via district's outline and label point. */
export async function approxGeometryRow(
  district: ApproxDistrict,
  via: GeometryRow,
  viaDisplay: MultiPolygonCoords,
): Promise<GeometryRow> {
  const stand = await fallbackGeometry([via], [viaDisplay]);
  return BGeometrySchema.parse({
    source_key: district.key,
    lookup_wkb: null,
    display_wkb: null,
    label_point: stand.label_point,
    outline_svg: stand.outline_svg,
    outline_bbox: stand.outline_bbox,
    geom_hash: fallbackGeomHash([district.via]),
  });
}

/** The state-wide districts' jurisdiction. */
export const stateWideJurisdiction = stateKey;

/** A TIGER file the reader cannot open as a shapefile. */
export class LayerFileError extends Error {
  override readonly name = 'LayerFileError';
}

const SHAPEFILE_PARTS = ['shp', 'shx', 'dbf', 'prj', 'cpg'] as const;

/**
 * The layers whose features have `NAME` and no `NAMELSAD` (STATE and the three school district
 * layers); their district name is `NAME`.
 */
export const NAME_ONLY_LAYERS: ReadonlySet<LayerId> = new Set(['state', 'unsd', 'elsd', 'scsd']);

async function entryBytes(zipPath: string, name: string): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of await openZipEntry(zipPath, name)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * A layer whose features name themselves in `NAME`, read and cleaned as the geometry steps 1 and
 * 2 read the other layers (`-clean`, EPSG:4326 coordinates at 7 decimals), filtered to the state
 * when `stateFips` is given (a national file).
 */
export async function readNameLayer(
  zipPath: string,
  layer: LayerId,
  opts: { stateFips: string | null },
): Promise<{ features: LayerFeature[]; invalid: string[] }> {
  if (opts.stateFips !== null && !/^\d{2}$/.test(opts.stateFips)) {
    throw new TypeError('a state FIPS code is two digits');
  }
  const names = (await listZip(zipPath)).map((entry) => entry.name);
  const shp = names.filter((name) => name.toLowerCase().endsWith('.shp'));
  const [only] = shp;
  if (only === undefined || shp.length !== 1) {
    throw new LayerFileError(`the ${layer} archive does not hold one .shp file`);
  }
  const base = only.slice(0, -'.shp'.length).toLowerCase();
  const inputs: Record<string, Uint8Array> = {};
  for (const part of SHAPEFILE_PARTS) {
    const name = names.find((entry) => entry.toLowerCase() === `${base}.${part}`);
    if (name !== undefined) inputs[`in.${part}`] = await entryBytes(zipPath, name);
  }
  if (inputs['in.shx'] === undefined || inputs['in.dbf'] === undefined) {
    throw new LayerFileError(`the ${layer} archive lacks its .shx or .dbf file`);
  }
  const filter = opts.stateFips === null ? '' : ` -filter "STATEFP=='${opts.stateFips}'"`;
  const output = await mapshaper.applyCommands(
    `-i in.shp encoding=utf8${filter} -clean -o out.json format=geojson precision=0.0000001`,
    inputs,
  );
  const out = output['out.json'];
  if (out === undefined) {
    throw new LayerFileError(`the ${layer} layer gave no output`);
  }
  const json: unknown = JSON.parse(
    typeof out === 'string' ? out : Buffer.from(out).toString('utf8'),
  );
  return featuresFromGeoJson(json, { layer, fields: { id: 'GEOID', name: 'NAME' } });
}
