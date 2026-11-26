// The geometry products of PIPE-geometry (D-056, D-208): lookup geometry with its hash, land-clipped
// display geometry, the outline and the label point, and the fallback and county-union forms.
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BGeometrySchema } from '@citizenrun/shared';
import type { BGeometry } from '@citizenrun/shared';
import mapshaper from 'mapshaper';
import { geomHash, multiPolygonToWkb, toHex } from '../../lib/wkb.ts';
import { listZip, openZipEntry } from '../../lib/zip.ts';
import { outlineFor } from './outline.ts';

/** The TIGER layers a district key names. */
export type LayerId =
  | 'state'
  | 'county'
  | 'place'
  | 'cousub'
  | 'cd'
  | 'sldu'
  | 'sldl'
  | 'unsd'
  | 'elsd'
  | 'scsd'
  | 'concity';

export type MultiPolygonCoords = readonly (readonly (readonly (readonly [number, number])[])[])[];

export type LayerFeature = {
  readonly geoid: string;
  readonly namelsad: string;
  readonly properties: Readonly<Record<string, string | number | null>>;
  readonly coords: MultiPolygonCoords;
};

export type GeometryRow = BGeometry;

export type GeometryCheck = { name: 'geometry_valid'; passed: boolean; detail: string };

/** A layer whose features lack the id or name field the reader needs: a table error. */
export class LayerFieldError extends Error {
  override readonly name = 'LayerFieldError';

  constructor(layer: string, field: string) {
    super(`a feature of the ${layer} layer has no ${field} field`);
  }
}

/** A layer archive without the shapefile parts the reader needs. */
export class LayerArchiveError extends Error {
  override readonly name = 'LayerArchiveError';
}

/** The output geometry mapshaper writes: GeoJSON coordinates as decimal degrees. */
const OUTPUT_PRECISION = 'precision=0.0000001';
const SHAPEFILE_PARTS = ['shp', 'shx', 'dbf', 'prj', 'cpg'] as const;
const REQUIRED_PARTS: ReadonlySet<string> = new Set(['shp', 'shx', 'dbf']);
const FIPS = /^\d{2}$/;
const ALASKA_FIPS = '02';
const LABEL_DECIMALS = 6;
const INVALID_DETAIL_KEYS = 20;
/** The property that carries a feature's id through a mapshaper run. */
const ID_FIELD = 'GEOID';

type Position = readonly [number, number];
type Ring = readonly Position[];
type Polygon = readonly Ring[];

// ---------------------------------------------------------------------------------------------
// GeoJSON in and out

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPosition(value: unknown): Position {
  if (!Array.isArray(value)) {
    return [Number.NaN, Number.NaN];
  }
  const [x, y] = value as unknown[];
  return [typeof x === 'number' ? x : Number.NaN, typeof y === 'number' ? y : Number.NaN];
}

function toPolygon(value: unknown): Polygon {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as unknown[]).map((ring) =>
    Array.isArray(ring) ? (ring as unknown[]).map(toPosition) : [],
  );
}

/** A GeoJSON geometry as MultiPolygon coordinates; null for a null, empty or non-polygon geometry. */
function toCoords(geometry: unknown): MultiPolygonCoords | null {
  if (!isRecord(geometry)) {
    return null;
  }
  const coordinates = geometry['coordinates'];
  let polygons: Polygon[] = [];
  switch (geometry['type']) {
    case 'Polygon':
      polygons = [toPolygon(coordinates)];
      break;
    case 'MultiPolygon':
      polygons = Array.isArray(coordinates) ? (coordinates as unknown[]).map(toPolygon) : [];
      break;
    case 'GeometryCollection': {
      const members = geometry['geometries'];
      polygons = Array.isArray(members)
        ? (members as unknown[]).flatMap((member) => toCoords(member) ?? [])
        : [];
      break;
    }
    default:
      return null;
  }
  const kept = polygons.filter((polygon) => polygon.length > 0);
  return kept.length === 0 ? null : kept;
}

/** The features of a FeatureCollection, a GeometryCollection, a Feature or a bare geometry. */
function features(json: unknown): { properties: Record<string, unknown>; geometry: unknown }[] {
  if (!isRecord(json)) {
    return [];
  }
  switch (json['type']) {
    case 'FeatureCollection': {
      const list = json['features'];
      return Array.isArray(list) ? (list as unknown[]).flatMap(features) : [];
    }
    case 'Feature':
      return [
        {
          properties: isRecord(json['properties']) ? json['properties'] : {},
          geometry: json['geometry'],
        },
      ];
    case 'GeometryCollection': {
      const list = json['geometries'];
      return Array.isArray(list)
        ? (list as unknown[]).map((geometry) => ({ properties: {}, geometry }))
        : [];
    }
    default:
      return [{ properties: {}, geometry: json }];
  }
}

function propertyValue(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function featureCollection(
  items: readonly { id: string; coords: MultiPolygonCoords }[],
): Record<string, unknown> {
  return {
    type: 'FeatureCollection',
    features: items.map((item) => ({
      type: 'Feature',
      properties: { [ID_FIELD]: item.id },
      geometry: { type: 'MultiPolygon', coordinates: item.coords },
    })),
  };
}

async function runMapshaper(
  commands: string,
  inputs: Readonly<Record<string, string | Uint8Array | object>>,
): Promise<unknown> {
  const output = await mapshaper.applyCommands(commands, inputs);
  const file = output['out.json'];
  if (file === undefined) {
    throw new Error('mapshaper wrote no out.json');
  }
  const text = typeof file === 'string' ? file : Buffer.from(file).toString('utf8');
  return JSON.parse(text) as unknown;
}

/** The output of one run keyed by the id property, each its MultiPolygon or null. */
function coordsById(json: unknown): Map<string, MultiPolygonCoords | null> {
  const out = new Map<string, MultiPolygonCoords | null>();
  for (const feature of features(json)) {
    const id = feature.properties[ID_FIELD];
    if (typeof id === 'string') {
      out.set(id, toCoords(feature.geometry));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Step 1 and 2: reading and cleaning

/**
 * Why the coordinates are not a structurally valid MultiPolygon, or null when they are: at least
 * one polygon; every ring at least 4 positions, closed, finite, longitudes within -180 to 180 and
 * latitudes within -90 to 90.
 */
export function structureProblem(coords: MultiPolygonCoords): string | null {
  if (coords.length === 0) {
    return 'no polygon';
  }
  for (const polygon of coords) {
    if (polygon.length === 0) {
      return 'a polygon without rings';
    }
    for (const ring of polygon) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (ring.length < 4 || first === undefined || last === undefined) {
        return 'a ring of fewer than 4 positions';
      }
      if (first[0] !== last[0] || first[1] !== last[1]) {
        return 'an unclosed ring';
      }
      for (const [lng, lat] of ring) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          return 'a coordinate that is not finite';
        }
        if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
          return 'a coordinate out of range';
        }
      }
    }
  }
  return null;
}

/**
 * A GeoJSON layer as features: the id and name from `fields` (GEOID and NAMELSAD by default); a
 * feature whose geometry is not a structurally valid MultiPolygon is listed in `invalid` by its id
 * and left out of `features`.
 */
export function featuresFromGeoJson(
  json: unknown,
  opts: { layer: string; fields?: { id: string; name: string } },
): { features: LayerFeature[]; invalid: string[] } {
  const fields = opts.fields ?? { id: 'GEOID', name: 'NAMELSAD' };
  const out: LayerFeature[] = [];
  const invalid: string[] = [];
  for (const feature of features(json)) {
    const id = feature.properties[fields.id];
    const name = feature.properties[fields.name];
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new LayerFieldError(opts.layer, fields.id);
    }
    if (typeof name !== 'string' && typeof name !== 'number') {
      throw new LayerFieldError(opts.layer, fields.name);
    }
    const properties: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(feature.properties)) {
      properties[key] = propertyValue(value);
    }
    const coords = toCoords(feature.geometry);
    if (coords === null || structureProblem(coords) !== null) {
      invalid.push(String(id));
      continue;
    }
    out.push({ geoid: String(id), namelsad: String(name), properties, coords });
  }
  return { features: out, invalid };
}

async function readStream(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** The shapefile parts of the archive as mapshaper inputs `in.shp`, `in.shx`, `in.dbf`, ... */
async function shapefileInputs(zipPath: string): Promise<Record<string, Uint8Array>> {
  const names = (await listZip(zipPath)).map((entry) => entry.name);
  const shp = names.filter((name) => name.toLowerCase().endsWith('.shp'));
  const [only] = shp;
  if (only === undefined || shp.length !== 1) {
    throw new LayerArchiveError(`the archive holds ${String(shp.length)} .shp files, not one`);
  }
  const base = only.slice(0, -'.shp'.length);
  const inputs: Record<string, Uint8Array> = {};
  for (const part of SHAPEFILE_PARTS) {
    const name = names.find((entry) => entry.toLowerCase() === `${base}.${part}`.toLowerCase());
    if (name === undefined) {
      if (REQUIRED_PARTS.has(part)) {
        throw new LayerArchiveError(`the archive has no .${part} file`);
      }
      continue;
    }
    inputs[`in.${part}`] = await readStream(await openZipEntry(zipPath, name));
  }
  return inputs;
}

function stateFilter(stateFips: string | null): string {
  if (stateFips === null) {
    return '';
  }
  if (!FIPS.test(stateFips)) {
    throw new TypeError('a state FIPS code is two digits');
  }
  return ` -filter "STATEFP=='${stateFips}'"`;
}

/**
 * PIPE-geometry steps 1 and 2: the layer's shapefile from its archive, filtered to the state when
 * `stateFips` is given (a national file), cleaned once, as features in EPSG:4326 (NAD83 taken as
 * WGS84 with no datum shift, P8-12).
 */
export async function readLayer(
  zipPath: string,
  layer: LayerId,
  opts: { stateFips: string | null },
): Promise<{ features: LayerFeature[]; invalid: string[] }> {
  const inputs = await shapefileInputs(zipPath);
  const json = await runMapshaper(
    `-i in.shp encoding=utf8${stateFilter(opts.stateFips)} -clean -o out.json format=geojson ${OUTPUT_PRECISION}`,
    inputs,
  );
  return featuresFromGeoJson(json, { layer });
}

/**
 * Steps 1 and 2 for a layer that arrives as GeoJSON (a registered ward layer): cleaned once, the id
 * and name read from the fields given.
 */
export async function readGeoJsonLayer(
  json: object,
  opts: { layer: string; fields: { id: string; name: string } },
): Promise<{ features: LayerFeature[]; invalid: string[] }> {
  const cleaned = await runMapshaper(
    `-i layer.json -clean -o out.json format=geojson ${OUTPUT_PRECISION}`,
    { 'layer.json': json },
  );
  return featuresFromGeoJson(cleaned, opts);
}

// ---------------------------------------------------------------------------------------------
// Steps 3 to 8

/** Step 3: the published shape as hex WKB and the SHA-256 of its bytes (02 T-districts). */
export function lookupProducts(f: LayerFeature): { lookup_wkb: string; geom_hash: string } {
  const wkb = multiPolygonToWkb(f.coords);
  return { lookup_wkb: toHex(wkb), geom_hash: geomHash(wkb) };
}

/** Step 4: the state's land, from `cb_2025_us_state_500k`, dissolved into one shape. */
export async function buildLandMask(
  maskZipPath: string,
  stateFips: string,
): Promise<MultiPolygonCoords> {
  const inputs = await shapefileInputs(maskZipPath);
  const json = await runMapshaper(
    `-i in.shp encoding=utf8${stateFilter(stateFips)} -dissolve -o out.json format=geojson`,
    inputs,
  );
  return features(json).flatMap((feature) => toCoords(feature.geometry) ?? []);
}

/**
 * Step 5: the whole layer clipped to the land mask and simplified at about 10 m in one run, so a
 * boundary two features share is simplified once (D-208). Null for a feature whose clipped shape
 * is empty.
 */
export async function displayLayer(
  layerFeatures: readonly LayerFeature[],
  mask: MultiPolygonCoords,
): Promise<ReadonlyMap<string, MultiPolygonCoords | null>> {
  const out = new Map<string, MultiPolygonCoords | null>();
  for (const f of layerFeatures) {
    out.set(f.geoid, null);
  }
  if (layerFeatures.length === 0 || mask.length === 0) {
    return out;
  }
  const json = await runMapshaper(
    '-i layer.json -clip mask.json -simplify interval=10 keep-shapes -o out.json format=geojson',
    {
      'layer.json': featureCollection(
        layerFeatures.map((f) => ({ id: f.geoid, coords: f.coords })),
      ),
      'mask.json': featureCollection([{ id: 'mask', coords: mask }]),
    },
  );
  for (const [id, coords] of coordsById(json)) {
    if (out.has(id)) {
      out.set(id, coords);
    }
  }
  return out;
}

/** Step 5's second run: features simplified the same way with no clip. */
async function simplifyUnclipped(
  items: readonly { id: string; coords: MultiPolygonCoords }[],
): Promise<Map<string, MultiPolygonCoords | null>> {
  if (items.length === 0) {
    return new Map();
  }
  return coordsById(
    await runMapshaper(
      '-i layer.json -simplify interval=10 keep-shapes -o out.json format=geojson',
      {
        'layer.json': featureCollection(items),
      },
    ),
  );
}

/**
 * Step 6: in Alaska (`02`) every longitude east of 0 becomes longitude minus 360, so the Aleutians
 * sit beside the mainland; other states are unchanged. Used for the outline and the label point
 * only, never for the WKB.
 */
export function shiftForAlaska(coords: MultiPolygonCoords, stateFips: string): MultiPolygonCoords {
  if (stateFips !== ALASKA_FIPS) {
    return coords;
  }
  return coords.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([lng, lat]): [number, number] => [lng > 0 ? lng - 360 : lng, lat]),
    ),
  );
}

/** Rounds half away from zero to `places` decimals; -0 becomes 0. */
function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Step 8 for many shapes in one run: `-points inner`, back into -180 to 180, 6 decimals. */
async function labelPoints(
  items: readonly { id: string; coords: MultiPolygonCoords }[],
): Promise<Map<string, [number, number] | null>> {
  const out = new Map<string, [number, number] | null>();
  if (items.length === 0) {
    return out;
  }
  const json = await runMapshaper('-i layer.json -points inner -o out.json format=geojson', {
    'layer.json': featureCollection(items),
  });
  for (const feature of features(json)) {
    const id = feature.properties[ID_FIELD];
    const geometry = feature.geometry;
    if (typeof id !== 'string') {
      continue;
    }
    if (!isRecord(geometry) || geometry['type'] !== 'Point') {
      out.set(id, null);
      continue;
    }
    const [lng, lat] = toPosition(geometry['coordinates']);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      out.set(id, null);
      continue;
    }
    out.set(id, [
      roundTo(lng < -180 ? lng + 360 : lng, LABEL_DECIMALS),
      roundTo(lat, LABEL_DECIMALS),
    ]);
  }
  return out;
}

/** Step 8 (R-025): an interior point of the shape as `[lng, lat]`, within -180 to 180. */
export async function labelPoint(coords: MultiPolygonCoords): Promise<[number, number]> {
  const point = (await labelPoints([{ id: 'label', coords }])).get('label');
  if (point === undefined || point === null) {
    throw new Error('mapshaper found no interior point');
  }
  return point;
}

async function dissolve(shapes: readonly MultiPolygonCoords[]): Promise<MultiPolygonCoords> {
  const json = await runMapshaper('-i layer.json -dissolve -o out.json format=geojson', {
    'layer.json': featureCollection(shapes.map((coords, i) => ({ id: String(i), coords }))),
  });
  return features(json).flatMap((feature) => toCoords(feature.geometry) ?? []);
}

// ---------------------------------------------------------------------------------------------
// Steps 9 and 10

/**
 * Step 9 (P8-12): the SHA-256 hex of `fallback:` and the via keys sorted in byte order, joined by
 * a comma, so a changed stand-in set marks the district changed.
 */
export function fallbackGeomHash(viaKeys: readonly string[]): string {
  const sorted = [...viaKeys].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return createHash('sha256')
    .update(`fallback:${sorted.join(',')}`, 'utf8')
    .digest('hex');
}

/**
 * Step 9: an approximate or fallback district has the outline and label point of its stand-in
 * area: the one via district's own, or those of the dissolve of all the via districts' display
 * geometry. It has no WKB of its own.
 */
export async function fallbackGeometry(
  viaRows: readonly GeometryRow[],
  viaDisplay: readonly MultiPolygonCoords[],
): Promise<Pick<GeometryRow, 'outline_svg' | 'outline_bbox' | 'label_point'>> {
  const [only] = viaRows;
  if (only === undefined) {
    throw new TypeError('a fallback district stands in through at least one via district');
  }
  if (viaRows.length === 1) {
    return {
      outline_svg: only.outline_svg,
      outline_bbox: only.outline_bbox,
      label_point: only.label_point,
    };
  }
  const area = await dissolve(viaDisplay);
  if (area.length === 0) {
    return { outline_svg: null, outline_bbox: null, label_point: null };
  }
  const outline = outlineFor(area);
  return {
    outline_svg: outline?.outline_svg ?? null,
    outline_bbox: outline?.outline_bbox ?? null,
    label_point: await labelPoint(area),
  };
}

/**
 * Step 10 (R-055): the dissolve of the counties' lookup geometry for the lookup WKB and hash, and
 * of their display geometry for the display WKB (a county with no display geometry takes its
 * lookup geometry), then the outline and label point. The caller writes `geometry_quality: 'exact'`.
 */
export async function countyUnion(
  key: string,
  counties: readonly { lookup: MultiPolygonCoords; display: MultiPolygonCoords | null }[],
  stateFips: string,
): Promise<GeometryRow> {
  if (counties.length === 0) {
    throw new TypeError('a county union names at least one county');
  }
  const lookup = await dissolve(counties.map((county) => county.lookup));
  const display = await dissolve(counties.map((county) => county.display ?? county.lookup));
  const lookupWkb = multiPolygonToWkb(lookup);
  const shifted = shiftForAlaska(display, stateFips);
  const outline = outlineFor(shifted);
  return BGeometrySchema.parse({
    source_key: key,
    lookup_wkb: toHex(lookupWkb),
    display_wkb: toHex(multiPolygonToWkb(display)),
    label_point: await labelPoint(shifted),
    outline_svg: outline?.outline_svg ?? null,
    outline_bbox: outline?.outline_bbox ?? null,
    geom_hash: geomHash(lookupWkb),
  });
}

// ---------------------------------------------------------------------------------------------
// Step 11: the state driver

/**
 * Every wanted exact district's geometry row (steps 3 to 8), layer by layer. `display` holds each
 * wanted key's display geometry (null for a key whose feature is missing or invalid); `checks`
 * carries `geometry_valid`; `droppedOutlines` the keys whose outline was null; `unclippedDisplay`
 * the keys whose display geometry was simplified without the land clip, because their clipped
 * shape was empty.
 */
export async function buildGeometryRows(input: {
  stateFips: string;
  layers: ReadonlyMap<LayerId, readonly LayerFeature[]>;
  mask: MultiPolygonCoords;
  wanted: ReadonlyMap<string, { layer: LayerId; geoid: string }>;
}): Promise<{
  rows: Map<string, GeometryRow>;
  display: Map<string, MultiPolygonCoords | null>;
  checks: GeometryCheck[];
  droppedOutlines: string[];
  unclippedDisplay: string[];
}> {
  const byLayer = new Map<LayerId, { key: string; geoid: string }[]>();
  for (const [key, { layer, geoid }] of [...input.wanted].sort(([a], [b]) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  )) {
    const list = byLayer.get(layer) ?? [];
    list.push({ key, geoid });
    byLayer.set(layer, list);
  }

  const rows = new Map<string, GeometryRow>();
  const display = new Map<string, MultiPolygonCoords | null>();
  const invalid: string[] = [];
  const droppedOutlines: string[] = [];
  const unclippedDisplay: string[] = [];

  for (const [layer, wanted] of byLayer) {
    const layerFeatures = (input.layers.get(layer) ?? []).filter(
      (f) => structureProblem(f.coords) === null,
    );
    const byGeoid = new Map(layerFeatures.map((f) => [f.geoid, f]));
    const found: { key: string; feature: LayerFeature }[] = [];
    for (const { key, geoid } of wanted) {
      const feature = byGeoid.get(geoid);
      if (feature === undefined) {
        invalid.push(key);
        display.set(key, null);
      } else {
        found.push({ key, feature });
      }
    }
    if (found.length === 0) {
      continue;
    }

    const clipped = await displayLayer(layerFeatures, input.mask);
    const shapes = new Map<string, MultiPolygonCoords>();
    const empty: { id: string; coords: MultiPolygonCoords }[] = [];
    for (const { key, feature } of found) {
      const shape = clipped.get(feature.geoid) ?? null;
      if (shape === null) {
        empty.push({ id: key, coords: feature.coords });
      } else {
        shapes.set(key, shape);
      }
    }
    for (const [key, shape] of await simplifyUnclipped(empty)) {
      if (shape === null) {
        throw new Error(`no display geometry for ${key}`);
      }
      shapes.set(key, shape);
      unclippedDisplay.push(key);
    }

    const shifted = found.map(({ key }) => {
      const shape = shapes.get(key);
      if (shape === undefined) {
        throw new Error(`no display geometry for ${key}`);
      }
      return { id: key, coords: shiftForAlaska(shape, input.stateFips) };
    });
    const labels = await labelPoints(shifted);
    for (const [i, { key, feature }] of found.entries()) {
      const shape = shapes.get(key);
      const forOutline = shifted[i];
      if (shape === undefined || forOutline === undefined) {
        throw new Error(`no display geometry for ${key}`);
      }
      const { lookup_wkb, geom_hash } = lookupProducts(feature);
      const outline = outlineFor(forOutline.coords);
      if (outline === null) {
        droppedOutlines.push(key);
      }
      rows.set(
        key,
        BGeometrySchema.parse({
          source_key: key,
          lookup_wkb,
          display_wkb: toHex(multiPolygonToWkb(shape)),
          label_point: labels.get(key) ?? null,
          outline_svg: outline?.outline_svg ?? null,
          outline_bbox: outline?.outline_bbox ?? null,
          geom_hash,
        }),
      );
      display.set(key, shape);
    }
  }

  const passed = invalid.length === 0;
  const detail = passed
    ? `${String(rows.size)} wanted features valid`
    : `${String(invalid.length)} wanted features missing or invalid: ${invalid
        .slice(0, INVALID_DETAIL_KEYS)
        .join(', ')}`;
  return {
    rows,
    display,
    checks: [{ name: 'geometry_valid', passed, detail }],
    droppedOutlines,
    unclippedDisplay: unclippedDisplay.sort(),
  };
}
