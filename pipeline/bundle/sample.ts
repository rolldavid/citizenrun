// B-sample: the two-state sample bundle, selected from the newest published full and geometry
// bundles and written to a folder for the seed. Rows are copied, never made up; only the geometry,
// photo, path and manifest fields B-sample names change.
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { Readable } from 'node:stream';
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BElectionSchema,
  BFilingTrackSchema,
  BGeometrySchema,
  BGivenNameAliasSchema,
  BJurisdictionSchema,
  BOfficePowerSchema,
  BOfficeSchema,
  BOfficeholderSchema,
  BPersonAliasSchema,
  BPersonSchema,
  BZipCentroidSchema,
  BundleManifestSchema,
  BundlePointerSchema,
} from '@citizenrun/shared';
import type { BGeometry, BPerson, BZipCentroid, BundleManifest } from '@citizenrun/shared';
import mapshaper from 'mapshaper';
import type { z } from 'zod';
import { bucketKeys } from '../lib/bucket.ts';
import { readNdjsonGz } from '../lib/ndjson.ts';
import type { RunContext } from '../lib/runner.ts';
import { LISTING_DATASET, readParsedListing } from '../sources/census-gus.ts';
import type { ParsedListingRow } from '../sources/census-gus.ts';
import type { MultiPolygonCoords } from '../stages/base/geometry.ts';
import { decodeMultiPolygonHex } from '../stages/shared/geometry-rows.ts';
import { FULL_FILES } from './assemble.ts';
import type { AssembledRows, FullFileName } from './assemble.ts';
import { encodeFile, sha256Hex } from './files.ts';

export type { MultiPolygonCoords } from '../stages/base/geometry.ts';

export const SAMPLE_COUNTIES = ['37063', '37135', '53067', '53045'] as const; // Durham, Orange; Thurston, Mason
export const SAMPLE_STATES = ['NC', 'WA'] as const;
export const SAMPLE_MAX_BYTES = 25_000_000;
export const SAMPLE_MAX_PHOTOS = 20;
export const MIN_OVERLAP_SQ_M = 1_000_000; // 1 square kilometre (B-sample)

export type SampleOptions = {
  readonly outDir: string;
  readonly counties: readonly string[];
  readonly states: readonly string[];
  readonly maxBytes: number;
  readonly now: Date;
  readonly gitSha: string;
};

export type SampleResult = {
  readonly fullVersion: string;
  readonly geometryVersion: string;
  readonly bytes: number;
  readonly stateGeometryReplaced: boolean;
  readonly rows: Readonly<Record<string, number>>;
  readonly photos: number;
};

/** Everything the selection reads: the two source manifests and their rows. */
export type SampleSource = {
  readonly fullManifest: BundleManifest;
  readonly geometryManifest: BundleManifest;
  /** Every row of the eleven revision-0 files. */
  readonly rows: Readonly<{ [F in FullFileName]: readonly AssembledRows[F][number][] }>;
  /** The geometry rows of each sample state, keyed by state code. */
  readonly geometry: ReadonlyMap<string, readonly BGeometry[]>;
  readonly zipCentroids: readonly BZipCentroid[];
  /** The parsed listing of the full manifest's census-gus edition. */
  readonly listing: readonly ParsedListingRow[];
};

/** A kept geometry row; `stateDistrict` marks the `tiger:state:` rows the size fallback replaces. */
export type SampleGeometry = { readonly row: BGeometry; readonly stateDistrict: boolean };

export type SampleSelection = {
  readonly rows: AssembledRows;
  /** Per sample state, the kept geometry rows; a row kept only by the closure already has `lookup_wkb` = `display_wkb`. */
  readonly geometry: ReadonlyMap<string, readonly SampleGeometry[]>;
  readonly zipCentroids: readonly BZipCentroid[];
  /** The kept photo paths as the sample's rows write them, `../assets/photos/<sha256>.jpg`, in byte order. */
  readonly assets: readonly string[];
  /** The district keys kept only by the reference closure. */
  readonly referenceDistricts: ReadonlySet<string>;
  /** The jurisdiction keys kept only by the reference closure. */
  readonly referenceJurisdictions: ReadonlySet<string>;
};

/** No published full or geometry pointer, or a source file the builder needs is absent. */
export class SampleSourceMissing extends Error {
  override readonly name = 'SampleSourceMissing';
}

/** The sample folder is above its byte limit even with the state districts replaced. */
export class SampleTooLarge extends Error {
  override readonly name = 'SampleTooLarge';
  readonly bytes: number;

  constructor(bytes: number, maxBytes: number) {
    super(`the sample holds ${String(bytes)} bytes, above ${String(maxBytes)}`);
    this.bytes = bytes;
  }
}

/** A kept row whose geometry or asset the source does not hold: a defect of the source bundle. */
export class SampleSourceInvalid extends Error {
  override readonly name = 'SampleSourceInvalid';
}

const FILE_SCHEMAS: Readonly<Record<FullFileName, z.ZodType>> = {
  jurisdictions: BJurisdictionSchema,
  districts: BDistrictSchema,
  district_fallbacks: BDistrictFallbackSchema,
  offices: BOfficeSchema,
  office_powers: BOfficePowerSchema,
  elections: BElectionSchema,
  filing_tracks: BFilingTrackSchema,
  people: BPersonSchema,
  person_aliases: BPersonAliasSchema,
  officeholders: BOfficeholderSchema,
  given_name_aliases: BGivenNameAliasSchema,
};

// two_source_fields as the bundle writer counts it (PIPE-bundle-writer step 9): an act-on field
// with a value at high confidence.
const TRACK_ACT_ON = [
  'opens_on',
  'closes_on',
  'closes_time',
  'petition_opens',
  'petition_due',
  'fee_cents',
  'signatures',
  'where_to_file',
] as const;
const OFFICE_ACT_ON = [
  'pay_annual_cents',
  'pay_amount_cents',
  'filing_fee_cents',
  'signatures_required',
  'where_to_file',
] as const;

const BUCKET_PHOTO = /^\.\.\/\.\.\/assets\/photos\/([0-9a-f]{64})\.jpg$/;
const LEGISLATIVE = /^tiger:(cd|sldu|sldl):/;
const PARTY_COUNTY = /^party:[A-Z]{2}:(\d{5}):/;
const ATTRIBUTION_FILE = 'ATTRIBUTION.md';
const MANIFEST_FILE = 'manifest.json';
const README_FILE = 'README.md';
const WRITTEN = ['full', 'geometry', 'assets'] as const;
const GEOMETRY_ID = 'SAMPLE_KEY';

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

type Box = readonly [number, number, number, number];

function boxOf(coords: MultiPolygonCoords): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of coords) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return minX === Infinity ? null : [minX, minY, maxX, maxY];
}

function boxesMeet(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function inBox(lng: number, lat: number, box: Box): boolean {
  return lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];
}

function onSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (cross !== 0) return false;
  return (
    px >= Math.min(ax, bx) &&
    px <= Math.max(ax, bx) &&
    py >= Math.min(ay, by) &&
    py <= Math.max(ay, by)
  );
}

/**
 * The even-odd rule over every ring of every polygon; a point on an edge counts as inside.
 */
export function pointInMultiPolygon(
  lng: number,
  lat: number,
  polygon: MultiPolygonCoords,
): boolean {
  let inside = false;
  for (const member of polygon) {
    for (const ring of member) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const a = ring[i];
        const b = ring[j];
        if (a === undefined || b === undefined) continue;
        const [xi, yi] = a;
        const [xj, yj] = b;
        if (onSegment(lng, lat, xi, yi, xj, yj)) return true;
        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
    }
  }
  return inside;
}

function featureCollection(items: readonly { id: string; coords: MultiPolygonCoords }[]): object {
  return {
    type: 'FeatureCollection',
    features: items.map((item) => ({
      type: 'Feature',
      properties: { [GEOMETRY_ID]: item.id },
      geometry: { type: 'MultiPolygon', coordinates: item.coords },
    })),
  };
}

function lookupCoords(row: BGeometry): MultiPolygonCoords | null {
  return row.lookup_wkb === null ? null : decodeMultiPolygonHex(row.lookup_wkb);
}

/**
 * The congressional, state senate and state house districts among `candidates` whose lookup
 * geometry overlaps the union of the counties' lookup geometry by at least MIN_OVERLAP_SQ_M square
 * metres. mapshaper clips each candidate with the counties; `this.area` of unprojected
 * latitude-longitude data is its spherical area in square metres, so no projection is needed.
 */
export async function overlappingDistricts(
  counties: readonly BGeometry[],
  candidates: readonly BGeometry[],
): Promise<ReadonlySet<string>> {
  const clip: { id: string; coords: MultiPolygonCoords }[] = [];
  const boxes: Box[] = [];
  for (const county of counties) {
    const coords = lookupCoords(county);
    const box = coords === null ? null : boxOf(coords);
    if (coords === null || box === null) continue;
    clip.push({ id: county.source_key, coords });
    boxes.push(box);
  }
  const near: { id: string; coords: MultiPolygonCoords }[] = [];
  for (const candidate of candidates) {
    if (!LEGISLATIVE.test(candidate.source_key)) continue;
    const coords = lookupCoords(candidate);
    const box = coords === null ? null : boxOf(coords);
    if (coords === null || box === null) continue;
    if (!boxes.some((county) => boxesMeet(county, box))) continue;
    near.push({ id: candidate.source_key, coords });
  }
  const kept = new Set<string>();
  if (near.length === 0 || clip.length === 0) return kept;
  const output = await mapshaper.applyCommands(
    `-i candidates.json -clip counties.json -each "SAMPLE_AREA=this.area" -o out.json format=geojson`,
    { 'candidates.json': featureCollection(near), 'counties.json': featureCollection(clip) },
  );
  const file = output['out.json'];
  if (file === undefined) throw new Error('mapshaper wrote no out.json');
  const text = typeof file === 'string' ? file : Buffer.from(file).toString('utf8');
  const json = JSON.parse(text) as { features?: { properties?: Record<string, unknown> }[] };
  const areas = new Map<string, number>();
  for (const feature of json.features ?? []) {
    const id = feature.properties?.[GEOMETRY_ID];
    const area = feature.properties?.['SAMPLE_AREA'];
    if (typeof id === 'string' && typeof area === 'number') {
      areas.set(id, (areas.get(id) ?? 0) + Math.abs(area));
    }
  }
  for (const [id, area] of areas) {
    if (area >= MIN_OVERLAP_SQ_M) kept.add(id);
  }
  return kept;
}

// ---------------------------------------------------------------------------------------------
// Selection (pure)

function rewritePhoto(person: BPerson): BPerson {
  if (person.photo === null) return person;
  const sha = BUCKET_PHOTO.exec(person.photo.asset)?.[1];
  if (sha === undefined) {
    throw new SampleSourceInvalid(`the photo path of ${person.source_key} is not a bucket path`);
  }
  return { ...person, photo: { ...person.photo, asset: `../assets/photos/${sha}.jpg` } };
}

/**
 * B-sample's selection: the units of the named counties and their co-ops and county parties, the
 * states, the overlapping legislative districts, the offices and rows below them, and the
 * reference closure; photos capped at SAMPLE_MAX_PHOTOS by `source_key` byte order.
 */
export function selectSample(
  input: SampleSource,
  keep: {
    readonly counties: readonly string[];
    readonly states: readonly string[];
    readonly overlapping: ReadonlySet<string>;
  },
): SampleSelection {
  const { rows } = input;
  const counties = new Set(keep.counties);
  const countyDistricts = new Set(keep.counties.map((geoid) => `tiger:county:${geoid}`));
  const stateJurisdictions = new Set(keep.states.map((st) => `state:${st}`));
  const jurisdictionKeys = new Set(rows.jurisdictions.map((row) => row.source_key));
  const districtByKey = new Map(rows.districts.map((row) => [row.source_key, row]));

  // Jurisdictions kept by the selection rules.
  const units = new Set<string>();
  for (const row of input.listing) {
    if (row.fips_county === null || !counties.has(`${row.fips_state}${row.fips_county}`)) continue;
    const key = `census:${row.pid6}`;
    if (jurisdictionKeys.has(key)) units.add(key);
  }
  for (const fallback of rows.district_fallbacks) {
    if (!countyDistricts.has(fallback.via_district_key)) continue;
    const owner = districtByKey.get(fallback.district_key)?.jurisdiction_key;
    if (owner?.startsWith('coop:') === true) units.add(owner);
  }
  for (const row of rows.jurisdictions) {
    const geoid = PARTY_COUNTY.exec(row.source_key)?.[1];
    if (geoid !== undefined && counties.has(geoid)) units.add(row.source_key);
  }
  const selectedJurisdictions = new Set(units);
  for (const key of stateJurisdictions) {
    if (jurisdictionKeys.has(key)) selectedJurisdictions.add(key);
  }

  // Districts kept by the selection rules.
  const stateDistricts = new Set(
    rows.districts
      .filter(
        (row) =>
          row.source_key.startsWith('tiger:state:') && stateJurisdictions.has(row.jurisdiction_key),
      )
      .map((row) => row.source_key),
  );
  const selectedDistricts = new Set<string>(stateDistricts);
  for (const row of rows.districts) {
    if (units.has(row.jurisdiction_key)) selectedDistricts.add(row.source_key);
  }
  for (const key of keep.overlapping) {
    if (districtByKey.has(key)) selectedDistricts.add(key);
  }

  // Offices: of the kept units, and on the state and overlapping districts.
  const officeDistricts = new Set<string>([...stateDistricts]);
  for (const key of keep.overlapping) officeDistricts.add(key);
  const offices = rows.offices.filter(
    (row) => units.has(row.jurisdiction_key) || officeDistricts.has(row.district_key),
  );

  // The reference closure.
  const keptJurisdictions = new Set(selectedJurisdictions);
  const keptDistricts = new Set(selectedDistricts);
  for (const office of offices) {
    keptDistricts.add(office.district_key);
    keptJurisdictions.add(office.jurisdiction_key);
  }
  const parentOf = new Map(rows.jurisdictions.map((row) => [row.source_key, row.parent_key]));
  const fallbacksOf = new Map<string, (typeof rows.district_fallbacks)[number][]>();
  for (const fallback of rows.district_fallbacks) {
    const list = fallbacksOf.get(fallback.district_key) ?? [];
    list.push(fallback);
    fallbacksOf.set(fallback.district_key, list);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const key of [...keptDistricts]) {
      for (const fallback of fallbacksOf.get(key) ?? []) {
        if (!keptDistricts.has(fallback.via_district_key)) {
          keptDistricts.add(fallback.via_district_key);
          grew = true;
        }
      }
      const owner = districtByKey.get(key)?.jurisdiction_key;
      if (owner !== undefined && !keptJurisdictions.has(owner)) {
        keptJurisdictions.add(owner);
        grew = true;
      }
    }
    for (const key of [...keptJurisdictions]) {
      const parent = parentOf.get(key);
      if (parent !== undefined && parent !== null && !keptJurisdictions.has(parent)) {
        keptJurisdictions.add(parent);
        grew = true;
      }
    }
  }

  const officeKeys = new Set(offices.map((row) => row.source_key));
  const elections = rows.elections.filter((row) => officeKeys.has(row.office_key));
  const electionKeys = new Set(elections.map((row) => row.source_key));
  const officeholders = rows.officeholders.filter((row) => officeKeys.has(row.office_key));
  const personKeys = new Set(officeholders.map((row) => row.person_key));
  const people = rows.people.filter((row) => personKeys.has(row.source_key));

  // Photos: the first SAMPLE_MAX_PHOTOS kept people with a photo, by source key in byte order.
  const withPhoto = people
    .filter((row) => row.photo !== null)
    .map((row) => row.source_key)
    .sort(byteOrder);
  const photoKept = new Set(withPhoto.slice(0, SAMPLE_MAX_PHOTOS));
  const keptPeople = people.map((row) =>
    row.photo === null
      ? row
      : photoKept.has(row.source_key)
        ? rewritePhoto(row)
        : { ...row, photo: null },
  );
  const assets = [
    ...new Set(keptPeople.flatMap((row) => (row.photo === null ? [] : [row.photo.asset]))),
  ].sort(byteOrder);

  const selected: AssembledRows = {
    jurisdictions: rows.jurisdictions.filter((row) => keptJurisdictions.has(row.source_key)),
    districts: rows.districts.filter((row) => keptDistricts.has(row.source_key)),
    district_fallbacks: rows.district_fallbacks.filter((row) =>
      keptDistricts.has(row.district_key),
    ),
    offices,
    office_powers: rows.office_powers.filter((row) => officeKeys.has(row.office_key)),
    elections,
    filing_tracks: rows.filing_tracks.filter((row) => electionKeys.has(row.election_key)),
    people: keptPeople,
    person_aliases: rows.person_aliases.filter((row) => personKeys.has(row.person_key)),
    officeholders,
    given_name_aliases: [...rows.given_name_aliases],
  };

  // Geometry: the selection's districts keep their shapes; a district kept only by the closure
  // gets its display geometry as its lookup geometry.
  const geometry = new Map<string, SampleGeometry[]>();
  const found = new Set<string>();
  for (const [state, list] of input.geometry) {
    const kept: SampleGeometry[] = [];
    for (const row of list) {
      if (!keptDistricts.has(row.source_key) || found.has(row.source_key)) continue;
      found.add(row.source_key);
      const reference = !selectedDistricts.has(row.source_key);
      kept.push({
        row: reference && row.lookup_wkb !== null ? { ...row, lookup_wkb: row.display_wkb } : row,
        stateDistrict: stateDistricts.has(row.source_key),
      });
    }
    geometry.set(state, kept);
  }
  const missing = selected.districts.filter((row) => !found.has(row.source_key));
  if (missing.length > 0) {
    throw new SampleSourceInvalid(
      `${String(missing.length)} kept districts have no geometry row in the sample states, first ${missing[0]?.source_key ?? ''}`,
    );
  }

  // ZIP centroids whose point lies in the counties' lookup geometry.
  const countyShapes: { coords: MultiPolygonCoords; box: Box }[] = [];
  for (const list of input.geometry.values()) {
    for (const row of list) {
      if (!countyDistricts.has(row.source_key)) continue;
      const coords = lookupCoords(row);
      const box = coords === null ? null : boxOf(coords);
      if (coords !== null && box !== null) countyShapes.push({ coords, box });
    }
  }
  const zipCentroids = input.zipCentroids.filter((zip) =>
    countyShapes.some(
      (shape) =>
        inBox(zip.lng, zip.lat, shape.box) && pointInMultiPolygon(zip.lng, zip.lat, shape.coords),
    ),
  );

  return {
    rows: selected,
    geometry,
    zipCentroids,
    assets,
    referenceDistricts: new Set([...keptDistricts].filter((key) => !selectedDistricts.has(key))),
    referenceJurisdictions: new Set(
      [...keptJurisdictions].filter((key) => !selectedJurisdictions.has(key)),
    ),
  };
}

/** The geometry rows to write for one state; with `replaceStates` the state districts' lookup geometry is their display geometry. */
export function sampleGeometryRows(
  list: readonly SampleGeometry[],
  replaceStates: boolean,
): BGeometry[] {
  return list.map(({ row, stateDistrict }) =>
    replaceStates && stateDistrict && row.lookup_wkb !== null
      ? { ...row, lookup_wkb: row.display_wkb }
      : row,
  );
}

/** two_source_fields over the kept rows, by the bundle writer's rule. */
export function countTwoSourceFields(
  rows: Pick<AssembledRows, 'offices' | 'filing_tracks'>,
): number {
  let count = 0;
  for (const office of rows.offices) {
    for (const field of OFFICE_ACT_ON) {
      if (office[field] !== null && office.field_meta[field]?.confidence === 'high') count += 1;
    }
  }
  for (const track of rows.filing_tracks) {
    for (const field of TRACK_ACT_ON) {
      if (track[field] === null) continue;
      if ((track.field_meta[field]?.confidence ?? track.confidence) === 'high') count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// Sizes

async function filesUnder(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** The byte sum of every file under `full/`, `geometry/` and `assets/` of `dir`, and its `README.md`. */
export async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const folder of WRITTEN) {
    for (const file of await filesUnder(join(dir, folder))) total += (await stat(file)).size;
  }
  try {
    total += (await stat(join(dir, README_FILE))).size;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return total;
}

/** The folder's byte count; throws SampleTooLarge above `maxBytes`. */
export async function assertSampleSize(
  dir: string,
  maxBytes: number = SAMPLE_MAX_BYTES,
): Promise<number> {
  const bytes = await folderBytes(dir);
  if (bytes > maxBytes) throw new SampleTooLarge(bytes, maxBytes);
  return bytes;
}

// ---------------------------------------------------------------------------------------------
// Reading the source

type Loaded = {
  readonly source: SampleSource;
  readonly fullAttribution: Uint8Array;
  readonly geometryAttribution: Uint8Array;
};

async function bytesChecked(
  ctx: RunContext,
  key: string,
  expect: { sha256: string; bytes: number } | null,
): Promise<Uint8Array> {
  const bytes = await ctx.bucket.getBytes(key);
  if (bytes === null) throw new SampleSourceMissing(`the source object ${key} does not exist`);
  if (
    expect !== null &&
    (bytes.byteLength !== expect.bytes || sha256Hex(bytes) !== expect.sha256)
  ) {
    throw new SampleSourceInvalid(`the source object ${key} differs from its manifest entry`);
  }
  return bytes;
}

async function rowsOf<T>(bytes: Uint8Array, schema: z.ZodType<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const row of readNdjsonGz(Readable.from([Buffer.from(bytes)]), schema)) out.push(row);
  return out;
}

function bundleFolder(version: string): string {
  return `bundles/${version}`;
}

/** A manifest path resolved against its bundle folder; one level up at most, and inside `bundles/`. */
function resolveInBundles(version: string, path: string): string {
  const key = posix.normalize(posix.join(bundleFolder(version), path));
  if (!key.startsWith('bundles/') || key.split('/').includes('..')) {
    throw new SampleSourceInvalid(`the manifest path ${path} leaves bundles/`);
  }
  return key;
}

async function manifestOf(ctx: RunContext, kind: 'full' | 'geometry'): Promise<BundleManifest> {
  const pointer = await ctx.bucket.readIndexFile(bucketKeys.pointer(kind), BundlePointerSchema);
  if (pointer === null || pointer.version.startsWith('sample-')) {
    throw new SampleSourceMissing(`no published ${kind} bundle`);
  }
  const manifest = await ctx.bucket.getJson(pointer.manifest, BundleManifestSchema);
  if (manifest === null) throw new SampleSourceMissing(`the ${kind} manifest does not exist`);
  return manifest;
}

async function readSource(ctx: RunContext, states: readonly string[]): Promise<Loaded> {
  const fullManifest = await manifestOf(ctx, 'full');
  const geometryManifest = await manifestOf(ctx, 'geometry');
  if (fullManifest.geometry_version !== geometryManifest.version) {
    ctx.log.warn('sample.geometry_version_differs', {
      fullVersion: fullManifest.version,
      geometryVersion: geometryManifest.version,
    });
  }
  const read = async <F extends FullFileName>(name: F) => {
    const entry = fullManifest.files.find((file) => file.name === name);
    if (entry === undefined) return [];
    const bytes = await bytesChecked(
      ctx,
      resolveInBundles(fullManifest.version, entry.path),
      entry,
    );
    return (await rowsOf(bytes, FILE_SCHEMAS[name])) as AssembledRows[F];
  };
  const rows = {
    jurisdictions: await read('jurisdictions'),
    districts: await read('districts'),
    district_fallbacks: await read('district_fallbacks'),
    offices: await read('offices'),
    office_powers: await read('office_powers'),
    elections: await read('elections'),
    filing_tracks: await read('filing_tracks'),
    people: await read('people'),
    person_aliases: await read('person_aliases'),
    officeholders: await read('officeholders'),
    given_name_aliases: await read('given_name_aliases'),
  };
  const geometry = new Map<string, BGeometry[]>();
  for (const state of states) {
    const entry = geometryManifest.files.find(
      (file) => file.name === 'geometry' && file.state === state,
    );
    if (entry === undefined) {
      throw new SampleSourceMissing(`the geometry bundle has no file for ${state}`);
    }
    const bytes = await bytesChecked(
      ctx,
      resolveInBundles(geometryManifest.version, entry.path),
      entry,
    );
    geometry.set(state, await rowsOf(bytes, BGeometrySchema));
  }
  const zipEntry = geometryManifest.files.find((file) => file.name === 'zip_centroids');
  const zipCentroids =
    zipEntry === undefined
      ? []
      : await rowsOf(
          await bytesChecked(
            ctx,
            resolveInBundles(geometryManifest.version, zipEntry.path),
            zipEntry,
          ),
          BZipCentroidSchema,
        );
  const edition = fullManifest.datasets[LISTING_DATASET]?.edition;
  if (edition === undefined) {
    throw new SampleSourceMissing('the full manifest names no census-gus edition');
  }
  const listing: ParsedListingRow[] = [];
  for await (const row of readParsedListing(ctx, edition)) listing.push(row);
  const attribution = async (manifest: BundleManifest) => {
    if (manifest.attribution_path === null) {
      throw new SampleSourceMissing(`the ${manifest.kind} manifest names no attribution file`);
    }
    return bytesChecked(ctx, resolveInBundles(manifest.version, manifest.attribution_path), null);
  };
  return {
    source: { fullManifest, geometryManifest, rows, geometry, zipCentroids, listing },
    fullAttribution: await attribution(fullManifest),
    geometryAttribution: await attribution(geometryManifest),
  };
}

// ---------------------------------------------------------------------------------------------
// Writing

function manifestText(manifest: BundleManifest): string {
  return `${JSON.stringify(BundleManifestSchema.parse(manifest), null, 2)}\n`;
}

function readme(opts: SampleOptions, source: SampleSource): string {
  const standard =
    opts.counties.join(',') === SAMPLE_COUNTIES.join(',') &&
    opts.states.join(',') === SAMPLE_STATES.join(',');
  const counties = standard
    ? 'Durham and Orange (North Carolina), Thurston and Mason (Washington)'
    : opts.counties.join(', ');
  return [
    '# Sample bundle',
    '',
    `Built with pnpm pipeline sample-bundle --out packages/db/src/seed/sample-bundle on ${opts.now.toISOString().slice(0, 10)}.`,
    `Source full bundle: ${source.fullManifest.version}.`,
    `Source geometry bundle: ${source.geometryManifest.version}.`,
    `Counties: ${counties}.`,
    'The data is licensed CC BY 4.0; see full/ATTRIBUTION.md. Photos keep their own licences.',
    '',
  ].join('\n');
}

async function removeWritten(dir: string): Promise<void> {
  for (const folder of WRITTEN) await rm(join(dir, folder), { recursive: true, force: true });
}

type AssetBytes = ReadonlyMap<string, Uint8Array>;

async function writeSample(
  opts: SampleOptions,
  loaded: Loaded,
  selection: SampleSelection,
  assetBytes: AssetBytes,
  replaceStates: boolean,
): Promise<Record<string, number>> {
  const { source } = loaded;
  const dir = opts.outDir;
  await removeWritten(dir);
  await mkdir(join(dir, 'full'), { recursive: true });
  await mkdir(join(dir, 'geometry', 'geometry'), { recursive: true });
  await mkdir(join(dir, 'assets', 'photos'), { recursive: true });
  const counts: Record<string, number> = {};

  const fullFiles: BundleManifest['files'] = [];
  for (const name of FULL_FILES) {
    const encoded = encodeFile(
      selection.rows[name] as readonly unknown[],
      FILE_SCHEMAS[name],
      name,
    );
    const path = `${name}.ndjson.gz`;
    await writeFile(join(dir, 'full', path), encoded.bytes);
    fullFiles.push({
      name,
      state: null,
      path,
      sha256: encoded.sha256,
      bytes: encoded.bytes.byteLength,
      rows: encoded.rows,
    });
    counts[name] = encoded.rows;
  }

  const geometryFiles: BundleManifest['files'] = [];
  for (const state of [...selection.geometry.keys()].sort(byteOrder)) {
    const rows = sampleGeometryRows(selection.geometry.get(state) ?? [], replaceStates);
    const encoded = encodeFile(rows, BGeometrySchema, 'geometry');
    const path = `geometry/${state}.ndjson.gz`;
    await writeFile(join(dir, 'geometry', path), encoded.bytes);
    geometryFiles.push({
      name: 'geometry',
      state,
      path,
      sha256: encoded.sha256,
      bytes: encoded.bytes.byteLength,
      rows: encoded.rows,
    });
    counts[`geometry:${state}`] = encoded.rows;
  }
  const zip = encodeFile(selection.zipCentroids, BZipCentroidSchema, 'zip_centroids');
  await writeFile(join(dir, 'geometry', 'zip_centroids.ndjson.gz'), zip.bytes);
  geometryFiles.push({
    name: 'zip_centroids',
    state: null,
    path: 'zip_centroids.ndjson.gz',
    sha256: zip.sha256,
    bytes: zip.bytes.byteLength,
    rows: zip.rows,
  });
  counts['zip_centroids'] = zip.rows;

  const assets: BundleManifest['assets'] = [];
  for (const path of selection.assets) {
    const sha = /([0-9a-f]{64})\.jpg$/.exec(path)?.[1] ?? '';
    const bytes = assetBytes.get(sha);
    if (bytes === undefined) throw new SampleSourceInvalid(`the asset ${sha} was not read`);
    await writeFile(join(dir, 'assets', 'photos', `${sha}.jpg`), bytes);
    const listed = source.fullManifest.assets.find((asset) => asset.sha256 === sha);
    assets.push({
      path,
      sha256: sha,
      kind: 'photo',
      bytes: bytes.byteLength,
      content_type: listed?.content_type ?? 'image/jpeg',
    });
  }

  await writeFile(join(dir, 'full', ATTRIBUTION_FILE), loaded.fullAttribution);
  await writeFile(join(dir, 'geometry', ATTRIBUTION_FILE), loaded.geometryAttribution);

  // The manifests last.
  const createdAt = opts.now.toISOString();
  const states = [...opts.states];
  const geometryVersion = `sample-${source.geometryManifest.version}`;
  const geometryManifest: BundleManifest = {
    ...source.geometryManifest,
    version: geometryVersion,
    created_at: createdAt,
    git_sha: opts.gitSha,
    states,
    files: geometryFiles,
    assets: [],
    filing_sources: [],
    two_source_fields: 0,
    coverage_path: null,
    attribution_path: ATTRIBUTION_FILE,
  };
  const fullManifest: BundleManifest = {
    ...source.fullManifest,
    version: `sample-${source.fullManifest.version}`,
    geometry_version: geometryVersion,
    created_at: createdAt,
    git_sha: opts.gitSha,
    states,
    files: fullFiles,
    assets,
    filing_sources: [],
    two_source_fields: countTwoSourceFields(selection.rows),
    coverage_path: null,
    attribution_path: ATTRIBUTION_FILE,
  };
  const geometryText = manifestText(geometryManifest);
  const fullText = manifestText(fullManifest);
  await writeFile(join(dir, 'geometry', MANIFEST_FILE), geometryText);
  await writeFile(join(dir, 'full', MANIFEST_FILE), fullText);
  await writeFile(join(dir, README_FILE), readme(opts, source));
  return counts;
}

async function readAssets(ctx: RunContext, selection: SampleSelection): Promise<AssetBytes> {
  const out = new Map<string, Uint8Array>();
  for (const path of selection.assets) {
    const sha = /([0-9a-f]{64})\.jpg$/.exec(path)?.[1];
    if (sha === undefined) throw new SampleSourceInvalid(`the asset path ${path} has no hash`);
    const bytes = await ctx.bucket.getBytes(bucketKeys.asset('photos', sha, 'jpg'));
    if (bytes === null) throw new SampleSourceMissing(`the photo ${sha} is not in the bucket`);
    if (createHash('sha256').update(bytes).digest('hex') !== sha) {
      throw new SampleSourceInvalid(`the photo ${sha} does not match its hash`);
    }
    out.set(sha, bytes);
  }
  return out;
}

/**
 * Builds the sample in `opts.outDir` from the bundles the pointers name: reads, selects, writes,
 * and checks the size, replacing the state districts' lookup geometry once when the folder is too
 * large. Reads only the pipeline's home and writes only under `opts.outDir`.
 */
export async function buildSample(ctx: RunContext, opts: SampleOptions): Promise<SampleResult> {
  const loaded = await readSource(ctx, opts.states);
  const { source } = loaded;
  const countyRows: BGeometry[] = [];
  const candidates: BGeometry[] = [];
  const countyKeys = new Set(opts.counties.map((geoid) => `tiger:county:${geoid}`));
  for (const list of source.geometry.values()) {
    for (const row of list) {
      if (countyKeys.has(row.source_key)) countyRows.push(row);
      else if (LEGISLATIVE.test(row.source_key)) candidates.push(row);
    }
  }
  const overlapping = await overlappingDistricts(countyRows, candidates);
  const selection = selectSample(source, {
    counties: opts.counties,
    states: opts.states,
    overlapping,
  });
  const assetBytes = await readAssets(ctx, selection);

  let replaceStates = false;
  let counts = await writeSample(opts, loaded, selection, assetBytes, replaceStates);
  let bytes = await folderBytes(opts.outDir);
  if (bytes > opts.maxBytes) {
    replaceStates = true;
    counts = await writeSample(opts, loaded, selection, assetBytes, replaceStates);
    bytes = await folderBytes(opts.outDir);
  }
  if (bytes > opts.maxBytes) {
    await removeWritten(opts.outDir);
    await rm(join(opts.outDir, README_FILE), { force: true });
    throw new SampleTooLarge(bytes, opts.maxBytes);
  }
  const result: SampleResult = {
    fullVersion: `sample-${source.fullManifest.version}`,
    geometryVersion: `sample-${source.geometryManifest.version}`,
    bytes,
    stateGeometryReplaced: replaceStates,
    rows: counts,
    photos: selection.assets.length,
  };
  ctx.log.info('sample.built', {
    sourceFullVersion: source.fullManifest.version,
    sourceGeometryVersion: source.geometryManifest.version,
    fullVersion: result.fullVersion,
    geometryVersion: result.geometryVersion,
    rows: counts,
    photos: result.photos,
    bytes,
    stateGeometryReplaced: replaceStates,
  });
  return result;
}
