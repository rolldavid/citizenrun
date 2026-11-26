// Made-up stage 1 rows for the fixture state ZZ: jurisdictions, districts, fallback rows, geometry
// rows and the parsed listing rows of its units. Every name starts with "Fixture".
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BGeometrySchema,
  BJurisdictionSchema,
} from '@citizenrun/shared';
import type {
  BDistrict,
  BDistrictFallback,
  BGeometry,
  BJurisdiction,
  FieldMetaRow,
} from '@citizenrun/shared';
import { geomHash, multiPolygonToWkb, toHex } from '../../lib/wkb.ts';
import type { Position } from '../../lib/wkb.ts';
import type { ParsedListingRow } from '../../sources/census-gus.ts';
import { fallbackGeomHash } from '../../stages/base/geometry.ts';

export const ZZ_STATE = 'ZZ';
export const ZZ_FIPS = '99';
export const ZZ_STATE_NAME = 'Fixture State';
export const ZZ_PL_URL = 'https://example.test/zz/pl94171.zip';
export const ZZ_STAGE1_CHECKED = '2026-11-01T00:00:00.000Z';

/** An axis-aligned square ring set, `[minLng, minLat]` to `[maxLng, maxLat]`. */
export function box(minLng: number, minLat: number, maxLng: number, maxLat: number): Position[][][] {
  return [
    [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  ];
}

const OUTLINE = 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z';

export function exactGeometry(key: string, shape: Position[][][]): BGeometry {
  const wkb = multiPolygonToWkb(shape);
  const ring = shape[0]?.[0] ?? [];
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  return BGeometrySchema.parse({
    source_key: key,
    lookup_wkb: toHex(wkb),
    display_wkb: toHex(wkb),
    label_point: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
    outline_svg: OUTLINE,
    outline_bbox: [minLng * 1000, minLat * 1000, maxLng * 1000, maxLat * 1000],
    geom_hash: geomHash(wkb),
  });
}

function approxGeometry(key: string, via: BGeometry): BGeometry {
  return BGeometrySchema.parse({
    source_key: key,
    lookup_wkb: null,
    display_wkb: null,
    label_point: via.label_point,
    outline_svg: via.outline_svg,
    outline_bbox: via.outline_bbox,
    geom_hash: fallbackGeomHash([via.source_key]),
  });
}

function jurisdiction(
  key: string,
  kind: BJurisdiction['kind'],
  name: string,
  population: number | null,
): BJurisdiction {
  return BJurisdictionSchema.parse({
    source_key: key,
    kind,
    name,
    state: ZZ_STATE,
    census_id: key.startsWith('census:') ? key.slice('census:'.length) : null,
    parent_key: null,
    population,
    website: null,
    timezone: null,
    budget_cents: null,
    budget_year: null,
    census_active: kind === 'state' ? null : true,
    label_lng: null,
    label_lat: null,
    field_meta: {},
  });
}

function district(
  key: string,
  jurisdictionKey: string,
  name: string,
  level: BDistrict['level'],
  quality: BDistrict['geometry_quality'],
  geometry: BGeometry,
  extra: { population?: number; population_18?: number; field_meta?: Record<string, FieldMetaRow> } = {},
): BDistrict {
  return BDistrictSchema.parse({
    source_key: key,
    jurisdiction_key: jurisdictionKey,
    name,
    level,
    geometry_quality: quality,
    geom_hash: geometry.geom_hash,
    population: extra.population ?? null,
    population_18: extra.population_18 ?? null,
    lean: null,
    lean_basis: null,
    field_meta: extra.field_meta ?? {},
  });
}

function listed(
  pid6: string,
  tab: ParsedListingRow['tab'],
  name: string,
  fields: Partial<ParsedListingRow>,
): ParsedListingRow {
  return {
    tab,
    pid6,
    unit_name: name.toUpperCase(),
    unit_type: null,
    title: null,
    city: null,
    state: ZZ_STATE,
    zip: null,
    web_address: null,
    political_code_description: null,
    population: null,
    population_source_year: null,
    fips_state: ZZ_FIPS,
    fips_county: '001',
    fips_place: null,
    county_area_name: null,
    active: true,
    function_name: null,
    school_enrollment: null,
    enrollment_year: null,
    school_level_description: null,
    parent_pid6: null,
    parent_unit_name: null,
    ...fields,
  };
}

const G = {
  state: exactGeometry('tiger:state:99', box(-80, 35, -77, 36)),
  county1: exactGeometry('tiger:county:99001', box(-80, 35, -79, 36)),
  county3: exactGeometry('tiger:county:99003', box(-79, 35, -78, 36)),
  county5: exactGeometry('tiger:county:99005', box(-78, 35, -77, 36)),
  place: exactGeometry('tiger:place:9900100', box(-79.8, 35.2, -79.6, 35.4)),
  cousub: exactGeometry('tiger:cousub:9900100500', box(-79.4, 35.5, -79.2, 35.7)),
  cd: exactGeometry('tiger:cd:9901', box(-80, 35, -77, 36)),
};

const APPROX_UNITS = [
  ['census:990003', 'Fixture Fire District'],
  ['census:990004', 'Fixture Library District'],
  ['census:990006', 'Fixture Water District'],
] as const;

const BLOCK_SUM_META: FieldMetaRow = {
  source_url: ZZ_PL_URL,
  quote: 'blocks covered: 4',
  confidence: 'medium',
  checked_at: ZZ_STAGE1_CHECKED,
  population_source: 'pl94171-block-sum',
  population_year: 2020,
};

/** Stage 1's rows for ZZ. */
export function zzStage1(): {
  readonly jurisdictions: BJurisdiction[];
  readonly districts: BDistrict[];
  readonly fallbacks: BDistrictFallback[];
  readonly geometry: BGeometry[];
  readonly listing: ParsedListingRow[];
} {
  const jurisdictions = [
    jurisdiction('state:ZZ', 'state', ZZ_STATE_NAME, 1349),
    jurisdiction('census:990001', 'county', 'Fixture County', 5000),
    jurisdiction('census:990002', 'city', 'Fixture City', 2000),
    jurisdiction('census:990003', 'special_district', 'Fixture Fire District', null),
    jurisdiction('census:990004', 'special_district', 'Fixture Library District', null),
    jurisdiction('census:990005', 'township', 'Fixture Township', 800),
    jurisdiction('census:990006', 'special_district', 'Fixture Water District', null),
    jurisdiction('census:990007', 'county', 'Fixture Second County', 3000),
  ];
  const approxGeometry_ = APPROX_UNITS.map(([key]) => approxGeometry(`county_approx:${key}`, G.county1));
  const geometry = [...Object.values(G), ...approxGeometry_];
  const districts = [
    district('tiger:state:99', 'state:ZZ', ZZ_STATE_NAME, 'state', 'exact', G.state, {
      population: 1349,
      population_18: 1030,
    }),
    district('tiger:cd:9901', 'state:ZZ', 'Fixture Congressional District 1', 'federal', 'exact', G.cd, {
      population: 1349,
      population_18: 1030,
      field_meta: { population: BLOCK_SUM_META, population_18: BLOCK_SUM_META },
    }),
    district('tiger:county:99001', 'census:990001', 'Fixture County', 'county', 'exact', G.county1),
    district('tiger:county:99003', 'census:990007', 'Fixture Second County', 'county', 'exact', G.county3),
    district('tiger:county:99005', 'state:ZZ', 'Fixture Third County', 'county', 'exact', G.county5),
    district('tiger:place:9900100', 'census:990002', 'Fixture City', 'local', 'exact', G.place),
    district('tiger:cousub:9900100500', 'census:990005', 'Fixture Township', 'local', 'exact', G.cousub),
    ...APPROX_UNITS.map(([key, name], i) =>
      district(
        `county_approx:${key}`,
        key,
        name,
        'special',
        'county_approx',
        approxGeometry_[i] ?? G.county1,
      ),
    ),
  ];
  const fallbacks = APPROX_UNITS.map(([key]) =>
    BDistrictFallbackSchema.parse({
      source_key: `county_approx:${key}|tiger:county:99001`,
      district_key: `county_approx:${key}`,
      via_district_key: 'tiger:county:99001',
    }),
  );
  const listing = [
    listed('990001', 'General Purpose', 'Fixture County', { unit_type: '1 - COUNTY' }),
    listed('990002', 'General Purpose', 'Fixture City', {
      unit_type: '2 - MUNICIPAL',
      fips_place: '00100',
    }),
    listed('990003', 'Special District', 'Fixture Fire District', {
      function_name: '24 - Fire protection',
    }),
    listed('990004', 'Special District', 'Fixture Library District', { function_name: '61 - Library' }),
    listed('990005', 'General Purpose', 'Fixture Township', { unit_type: '3 - TOWNSHIP' }),
    listed('990006', 'Special District', 'Fixture Water District', {
      function_name: '91 - Water supply utility',
    }),
    listed('990007', 'General Purpose', 'Fixture Second County', {
      unit_type: '1 - COUNTY',
      fips_county: '003',
    }),
  ];
  return { jurisdictions, districts, fallbacks, geometry, listing };
}

/** The parsed listing keyed by PID6. */
export function zzListingMap(rows: readonly ParsedListingRow[]): ReadonlyMap<string, ParsedListingRow> {
  return new Map(rows.map((row) => [row.pid6, row]));
}

/** A ward district of stage 1 for Fixture City's second district, with its geometry row. */
export function zzWard2(): { readonly district: BDistrict; readonly geometry: BGeometry } {
  const geometry = exactGeometry('ward:9900100:district-2', box(-79.7, 35.2, -79.6, 35.3));
  return {
    district: district('ward:9900100:district-2', 'census:990002', 'Fixture City District 2', 'local', 'exact', geometry),
    geometry,
  };
}
