import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  BUNDLE_SCHEMA_VERSION,
  BundleManifestSchema,
  BundlePointerSchema,
  censusJurisdictionKey,
  countyApproxDistrictKey,
  districtFallbackKey,
  electionKey,
  filingTrackKey,
  givenNameAliasKey,
  officeholderKey,
  officePowerKey,
  personAliasKey,
  rosterPersonKey,
  stateJurisdictionKey,
  tigerDistrictKey,
  zctaKey,
} from '@citizenrun/shared';
import type { BundleManifest } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { FULL_FILES_R0 } from '../bundle/tables.ts';
import type { FullFileR0 } from '../bundle/tables.ts';
import type { Db } from '../client.ts';
import { getTestObject, putTestObject } from './storage.ts';
import { sha256Hex, squareWkbHex } from './wkb.ts';

// Fixture bundles for the load core (TEST-bundle-loader): every row is made up, for the fixture
// state ZZ, with names that start "Fixture" and links on example.test.

export type FixtureRows = Partial<Record<FullFileR0, Record<string, unknown>[]>>;

export type FixtureAsset = {
  kind: 'photo' | 'form';
  bytes: Uint8Array;
  /** The hash the asset is stored and listed under; defaults to the hash of `bytes`. */
  sha256?: string;
};

export type FixtureBundleInput = {
  version: string; // '<YYYYMMDD>T<HHMMSS>Z-full'
  files: FixtureRows;
  geometry?: {
    version: string;
    states: Record<string, Record<string, unknown>[]>;
    zip: Record<string, unknown>[];
    reuseFrom?: { version: string; states: string[] }; // states referenced from an earlier geometry folder by '../<version>/geometry/<ST>.ndjson.gz'
  };
  assets?: FixtureAsset[];
  manifest?: Partial<BundleManifest>; // applied last: schema_revision, checks, kind
  corrupt?: { file: FullFileR0; mode: 'flip_byte' | 'truncate' | 'missing' }; // applied after the manifest's sha256 is computed
  pointer?: boolean; // also write bundles/index/full.json (BundlePointerSchema)
};

type ManifestFile = BundleManifest['files'][number];
type ManifestAsset = BundleManifest['assets'][number];

const FIXTURE_GIT_SHA = 'a'.repeat(40);
const FIXTURE_DATASETS: BundleManifest['datasets'] = {
  'census-gus': {
    edition: '2022',
    downloaded_on: '2027-01-01',
    source_url: 'https://www2.census.gov/fixture',
  },
};
const FIXTURE_CHECKS: BundleManifest['checks'] = [
  { name: 'rules_fixtures', passed: true, detail: 'fixture' },
];
const GEOMETRY_TIGER_VINTAGE = '2024';
const DAY_MS = 24 * 60 * 60 * 1000;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function ndjsonGz(rows: readonly Record<string, unknown>[]): Buffer {
  return gzipSync(Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8'));
}

function corrupted(bytes: Buffer, mode: 'flip_byte' | 'truncate' | 'missing'): Buffer | null {
  if (mode === 'missing') {
    return null;
  }
  if (mode === 'truncate') {
    return bytes.subarray(0, Math.floor(bytes.length / 2));
  }
  const copy = Buffer.from(bytes);
  const at = Math.floor(copy.length / 2);
  copy[at] = (copy[at] ?? 0) ^ 0xff;
  return copy;
}

const VERSION_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-(?:full|filings|geometry)$/;

/** The instant of a version, `2027-01-15T06:00:00.000Z` for `20270115T060000Z-full`. */
function versionInstant(version: string): string {
  const parts = VERSION_PATTERN.exec(version);
  if (parts === null) {
    throw new RangeError('A fixture version is <YYYYMMDD>T<HHMMSS>Z-<kind>.');
  }
  const [, y, mo, d, h, mi, s] = parts;
  return `${String(y)}-${String(mo)}-${String(d)}T${String(h)}:${String(mi)}:${String(s)}.000Z`;
}

/** fixtureVersion('2027-01-15T06:00:00Z', 'full') = '20270115T060000Z-full'. */
export function fixtureVersion(at: string, kind: 'full' | 'geometry'): string {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z-${kind}`;
}

function baseManifest(kind: 'full' | 'geometry', version: string): BundleManifest {
  return {
    format: 'citizenrun-bundle',
    kind,
    version,
    schema_version: BUNDLE_SCHEMA_VERSION,
    schema_revision: 0,
    created_at: versionInstant(version),
    git_sha: FIXTURE_GIT_SHA,
    geometry_version: null,
    tiger_vintage: kind === 'geometry' ? GEOMETRY_TIGER_VINTAGE : null,
    states: ['ZZ'],
    files: [],
    assets: [],
    datasets: FIXTURE_DATASETS,
    checks: FIXTURE_CHECKS,
    filing_sources: [],
    two_source_fields: 0,
    coverage_path: null,
    attribution_path: null,
  };
}

async function putGz(key: string, body: Buffer | null): Promise<void> {
  if (body !== null) {
    await putTestObject('data', key, body, 'application/gzip');
  }
}

async function writeGeometry(geometry: NonNullable<FixtureBundleInput['geometry']>): Promise<void> {
  const folder = `bundles/${geometry.version}`;
  const files: ManifestFile[] = [];
  for (const [state, rows] of Object.entries(geometry.states)) {
    const gz = ndjsonGz(rows);
    const path = `geometry/${state}.ndjson.gz`;
    await putGz(`${folder}/${path}`, gz);
    files.push({
      name: 'geometry',
      state,
      path,
      sha256: sha256(gz),
      bytes: gz.length,
      rows: rows.length,
    });
  }
  for (const state of geometry.reuseFrom?.states ?? []) {
    const reused = geometry.reuseFrom?.version ?? '';
    const stored = await getTestObject('data', `bundles/${reused}/geometry/${state}.ndjson.gz`);
    if (stored === null) {
      throw new Error('The reused geometry file does not exist.');
    }
    const rows = gunzipSync(stored)
      .toString('utf8')
      .split('\n')
      .filter((line) => line !== '').length;
    files.push({
      name: 'geometry',
      state,
      path: `../${reused}/geometry/${state}.ndjson.gz`,
      sha256: sha256(stored),
      bytes: stored.length,
      rows,
    });
  }
  const zip = ndjsonGz(geometry.zip);
  await putGz(`${folder}/zip_centroids.ndjson.gz`, zip);
  files.push({
    name: 'zip_centroids',
    state: null,
    path: 'zip_centroids.ndjson.gz',
    sha256: sha256(zip),
    bytes: zip.length,
    rows: geometry.zip.length,
  });
  const states = [
    ...new Set(files.flatMap((file) => (file.state === null ? [] : [file.state]))),
  ].sort();
  const manifest = BundleManifestSchema.parse({
    ...baseManifest('geometry', geometry.version),
    states: states.length === 0 ? ['ZZ'] : states,
    files,
  });
  await putTestObject(
    'data',
    `${folder}/manifest.json`,
    Buffer.from(JSON.stringify(manifest)),
    'application/json',
  );
}

async function writeAssets(assets: readonly FixtureAsset[]): Promise<ManifestAsset[]> {
  const listed: ManifestAsset[] = [];
  for (const asset of assets) {
    const hash = asset.sha256 ?? sha256(asset.bytes);
    const key = asset.kind === 'photo' ? `assets/photos/${hash}.jpg` : `assets/forms/${hash}.pdf`;
    const contentType = asset.kind === 'photo' ? 'image/jpeg' : 'application/pdf';
    await putTestObject('data', key, asset.bytes, contentType);
    listed.push({
      path: `../../${key}`,
      sha256: hash,
      kind: asset.kind,
      bytes: asset.bytes.length,
      content_type: contentType,
    });
  }
  return listed;
}

/**
 * Writes a fixture bundle to this worker's test `data` bucket: each file gzipped as NDJSON under
 * bundles/<version>/, the assets, the geometry folder when given, then the manifest, then the
 * pointer when asked. The manifest is parsed with BundleManifestSchema unless `input.manifest`
 * deliberately breaks it.
 */
export async function writeFixtureBundle(
  input: FixtureBundleInput,
): Promise<{ manifestKey: string; manifest: BundleManifest }> {
  const folder = `bundles/${input.version}`;
  const files: ManifestFile[] = [];
  for (const name of FULL_FILES_R0) {
    const rows = input.files[name];
    if (rows === undefined) {
      continue;
    }
    const gz = ndjsonGz(rows);
    const path = `${name}.ndjson.gz`;
    files.push({
      name,
      state: null,
      path,
      sha256: sha256(gz),
      bytes: gz.length,
      rows: rows.length,
    });
    const body = input.corrupt?.file === name ? corrupted(gz, input.corrupt.mode) : gz;
    await putGz(`${folder}/${path}`, body);
  }
  const assets = await writeAssets(input.assets ?? []);
  if (input.geometry !== undefined) {
    await writeGeometry(input.geometry);
  }
  const states = new Set<string>();
  for (const row of input.files.jurisdictions ?? []) {
    if (typeof row.state === 'string') {
      states.add(row.state);
    }
  }
  const built: BundleManifest = {
    ...baseManifest('full', input.version),
    states: states.size === 0 ? ['ZZ'] : [...states].sort(),
    geometry_version: input.geometry?.version ?? null,
    files,
    assets,
    ...input.manifest,
  };
  const checked = BundleManifestSchema.safeParse(built);
  if (input.manifest === undefined && !checked.success) {
    throw new Error('The fixture manifest does not parse.');
  }
  const manifest = checked.success ? checked.data : built;
  const manifestKey = `${folder}/manifest.json`;
  await putTestObject(
    'data',
    manifestKey,
    Buffer.from(JSON.stringify(manifest)),
    'application/json',
  );
  if (input.pointer === true) {
    const pointer = BundlePointerSchema.parse({
      kind: 'full',
      version: input.version,
      manifest: manifestKey,
      published_at: manifest.created_at,
    });
    await putTestObject(
      'data',
      'bundles/index/full.json',
      Buffer.from(JSON.stringify(pointer)),
      'application/json',
    );
  }
  return { manifestKey, manifest };
}

// The ZZ fixture geography, shared by zzBundle and zzGeometry so their geom_hash values agree.
const STATE_KEY = stateJurisdictionKey('ZZ');
const ALDER_KEY = censusJurisdictionKey('990001');
const BIRCH_KEY = censusJurisdictionKey('990002');
const CEDAR_KEY = censusJurisdictionKey('990003');
const WATER_KEY = censusJurisdictionKey('990004');
const STATE_DISTRICT = tigerDistrictKey('state', '99');
const ALDER_DISTRICT = tigerDistrictKey('county', '99001');
const BIRCH_DISTRICT = tigerDistrictKey('county', '99003');
const CEDAR_DISTRICT = tigerDistrictKey('place', '9900100');
const WATER_DISTRICT = countyApproxDistrictKey(WATER_KEY);

type Box = readonly [number, number, number, number];

const ZZ_SQUARES: readonly { key: string; box: Box }[] = [
  { key: STATE_DISTRICT, box: [-41, 29, -39, 31] },
  { key: ALDER_DISTRICT, box: [-41, 29, -40, 31] },
  { key: BIRCH_DISTRICT, box: [-40, 29, -39, 31] },
  { key: CEDAR_DISTRICT, box: [-40.8, 29.8, -40.4, 30.2] },
];
const OUTLINE_SVG = 'M0 0L1000 0L1000 1000L0 1000Z';
const OUTLINE_BBOX = [0, 0, 1000, 1000] as const;

/** The geom_hash of a fallback district: SHA-256 of 'fallback:' and its via keys (PIPE-geometry). */
function fallbackHash(viaKeys: readonly string[]): string {
  return createHash('sha256')
    .update(`fallback:${[...viaKeys].sort().join(',')}`, 'utf8')
    .digest('hex');
}

function zzGeomHashes(): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const { key, box } of ZZ_SQUARES) {
    hashes.set(key, sha256Hex(squareWkbHex(...box)));
  }
  hashes.set(WATER_DISTRICT, fallbackHash([ALDER_DISTRICT]));
  return hashes;
}

function centre(box: Box): [number, number] {
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

/** The ZZ geometry bundle: four exact squares around (-40, 30), the approximate water district with no shapes, one ZIP centroid. */
export function zzGeometry(
  options: { version?: string } = {},
): NonNullable<FixtureBundleInput['geometry']> {
  const hashes = zzGeomHashes();
  const alder = ZZ_SQUARES[1]?.box ?? [0, 0, 0, 0];
  const rows: Record<string, unknown>[] = ZZ_SQUARES.map(({ key, box }) => {
    const wkb = squareWkbHex(...box);
    return {
      source_key: key,
      lookup_wkb: wkb,
      display_wkb: wkb,
      label_point: centre(box),
      outline_svg: OUTLINE_SVG,
      outline_bbox: [...OUTLINE_BBOX],
      geom_hash: hashes.get(key),
    };
  });
  rows.push({
    source_key: WATER_DISTRICT,
    lookup_wkb: null,
    display_wkb: null,
    label_point: centre(alder),
    outline_svg: OUTLINE_SVG,
    outline_bbox: [...OUTLINE_BBOX],
    geom_hash: hashes.get(WATER_DISTRICT),
  });
  return {
    version: options.version ?? fixtureVersion('2027-01-01T00:00:00Z', 'geometry'),
    states: { ZZ: rows },
    zip: [{ source_key: zctaKey('99001'), zip: '99001', state: 'ZZ', lng: -40.5, lat: 30 }],
  };
}

function datePlus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function jurisdiction(
  sourceKey: string,
  kind: string,
  name: string,
  parentKey: string | null,
): Record<string, unknown> {
  return {
    source_key: sourceKey,
    kind,
    name,
    state: 'ZZ',
    census_id: null,
    parent_key: parentKey,
    population: null,
    website: null,
    timezone: null,
    budget_cents: null,
    budget_year: null,
    census_active: null,
    label_lng: null,
    label_lat: null,
    field_meta: {},
  };
}

function district(
  sourceKey: string,
  jurisdictionKey: string,
  name: string,
  level: string,
  quality: string,
  geomHash: string | undefined,
): Record<string, unknown> {
  return {
    source_key: sourceKey,
    jurisdiction_key: jurisdictionKey,
    name,
    level,
    geometry_quality: quality,
    geom_hash: geomHash,
    population: null,
    population_18: null,
    lean: null,
    lean_basis: null,
    field_meta: {},
  };
}

function office(
  slug: string,
  number: string,
  jurisdictionKey: string,
  districtKey: string,
): Record<string, unknown> {
  return {
    source_key: slug,
    slug,
    jurisdiction_key: jurisdictionKey,
    district_key: districtKey,
    office_type_id: 'county-commission',
    title: `Fixture Seat ${number}`,
    placeholder: false,
    seats: 1,
    body_size: null,
    seats_up_next: null,
    vacant_seats_up_next: null,
    term_years: null,
    term_limit_terms: null,
    partisan: null,
    party_selection: null,
    electorate: null,
    pay_annual_cents: null,
    pay_kind: null,
    pay_amount_cents: null,
    pay_period: null,
    pay_change_note: null,
    benefits: null,
    hours_per_week: null,
    full_time: null,
    meeting_times: null,
    fits_day_job: null,
    filing_fee_cents: null,
    signatures_required: null,
    where_to_file: null,
    eligibility: null,
    field_meta: {},
  };
}

function track(key: string, electionDate: string, today: string): Record<string, unknown> {
  return {
    source_key: filingTrackKey(key, 'nonpartisan'),
    election_key: key,
    track: 'nonpartisan',
    opens_on: datePlus(electionDate, -120),
    closes_on: datePlus(electionDate, -100),
    closes_time: null,
    petition_opens: null,
    petition_due: null,
    fee_cents: null,
    signatures: null,
    where_to_file: null,
    basis: 'computed',
    source_url: 'https://example.test/fixture-filing-rule',
    quote: null,
    rule_citation: null,
    confidence: 'low',
    checked_at: `${today}T00:00:00.000Z`,
    field_meta: {},
  };
}

/**
 * A consistent fixture bundle for the state ZZ: five jurisdictions, five districts (one
 * approximate, with its fallback), `offices` county-commission seats (default 20) alternating
 * between the two counties, each with one power, `electionsPerOffice` elections (default 2) with one
 * track each, one holder and one alias; and one given-name pair.
 */
export function zzBundle(options: {
  today: string;
  offices?: number;
  electionsPerOffice?: 1 | 2;
  photoSha?: string;
}): FixtureRows {
  const { today } = options;
  const officeCount = options.offices ?? 20;
  const electionsPerOffice = options.electionsPerOffice ?? 2;
  const hashes = zzGeomHashes();
  const rows: Required<FixtureRows> = {
    jurisdictions: [
      jurisdiction(STATE_KEY, 'state', 'Fixture State', null),
      jurisdiction(ALDER_KEY, 'county', 'Fixture Alder County', null),
      jurisdiction(BIRCH_KEY, 'county', 'Fixture Birch County', null),
      jurisdiction(CEDAR_KEY, 'city', 'Fixture Cedar City', ALDER_KEY),
      jurisdiction(WATER_KEY, 'special_district', 'Fixture Water District', ALDER_KEY),
    ],
    districts: [
      district(
        STATE_DISTRICT,
        STATE_KEY,
        'Fixture State',
        'state',
        'exact',
        hashes.get(STATE_DISTRICT),
      ),
      district(
        ALDER_DISTRICT,
        ALDER_KEY,
        'Fixture Alder County',
        'county',
        'exact',
        hashes.get(ALDER_DISTRICT),
      ),
      district(
        BIRCH_DISTRICT,
        BIRCH_KEY,
        'Fixture Birch County',
        'county',
        'exact',
        hashes.get(BIRCH_DISTRICT),
      ),
      district(
        CEDAR_DISTRICT,
        CEDAR_KEY,
        'Fixture Cedar City',
        'local',
        'exact',
        hashes.get(CEDAR_DISTRICT),
      ),
      district(
        WATER_DISTRICT,
        WATER_KEY,
        'Fixture Water District',
        'special',
        'county_approx',
        hashes.get(WATER_DISTRICT),
      ),
    ],
    district_fallbacks: [
      {
        source_key: districtFallbackKey(WATER_DISTRICT, ALDER_DISTRICT),
        district_key: WATER_DISTRICT,
        via_district_key: ALDER_DISTRICT,
      },
    ],
    offices: [],
    office_powers: [],
    elections: [],
    filing_tracks: [],
    people: [],
    person_aliases: [],
    given_name_aliases: [
      {
        source_key: givenNameAliasKey('william', 'bill'),
        canonical: 'william',
        alias: 'bill',
        source: 'nicknames',
      },
    ],
    officeholders: [],
  };
  for (let index = 1; index <= officeCount; index += 1) {
    const number = String(index).padStart(3, '0');
    const slug = `zz-fixture-seat-${number}`;
    const west = index % 2 === 1;
    rows.offices.push(
      office(slug, number, west ? ALDER_KEY : BIRCH_KEY, west ? ALDER_DISTRICT : BIRCH_DISTRICT),
    );
    rows.office_powers.push({
      source_key: officePowerKey(slug, 'zoning-land-use'),
      office_key: slug,
      power_id: 'zoning-land-use',
      relevance: 3,
      quote: null,
      source_url: null,
      confidence: 'low',
      checked_at: null,
    });
    const contests: [string, 'general' | 'primary', string][] = [
      [datePlus(today, 200), 'general', 'midterm_general'],
    ];
    if (electionsPerOffice === 2) {
      contests.push([datePlus(today, 140), 'primary', 'primary']);
    }
    for (const [date, kind, turnout] of contests) {
      const key = electionKey(slug, date, kind, null);
      rows.elections.push({
        source_key: key,
        office_key: slug,
        election_date: date,
        kind,
        party: null,
        turnout_class: turnout,
        deadline_conflict: null,
        field_meta: {},
      });
      rows.filing_tracks.push(track(key, date, today));
    }
    const personKey = rosterPersonKey(slug, `fixture-holder-${number}`);
    rows.people.push({
      source_key: personKey,
      slug: `fixture-holder-${number}`,
      name: `Fixture Holder ${number}`,
      first_name: null,
      middle_name: null,
      last_name: null,
      suffix: null,
      party: null,
      photo:
        index === 1 && options.photoSha !== undefined
          ? fixturePhotoRecord(`../../assets/photos/${options.photoSha}.jpg`, today)
          : null,
      website: null,
      roster_only: false,
      origin: { created_by: 'bundle', key: personKey, datasets: ['census-gus'] },
    });
    const alias = `Fixture H. ${number}`;
    rows.person_aliases.push({
      source_key: personAliasKey(personKey, alias),
      person_key: personKey,
      alias,
    });
    rows.officeholders.push({
      source_key: officeholderKey(slug, personKey, null),
      office_key: slug,
      person_key: personKey,
      seat_label: null,
      since: null,
      until: null,
      seat_up_next: null,
      term_limited: null,
      not_running: null,
      cash_on_hand_cents: null,
      cash_as_of: null,
      cash_source_url: null,
    });
  }
  return rows;
}

/** The photo record of a fixture person whose photo is at `asset`. */
export function fixturePhotoRecord(asset: string, today: string): Record<string, unknown> {
  return {
    asset,
    width: 320,
    height: 400,
    source_url: 'https://example.test/fixture-photo',
    author: 'Fixture Author',
    license: 'CC0-1.0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    credit_text: 'Fixture photo',
    modified: false,
    retrieved_at: `${today}T00:00:00.000Z`,
  };
}

/** A 320 by 400 JPEG made with sharp's create input. */
export async function zzPhotoJpeg(): Promise<Uint8Array> {
  const jpeg = await sharp({
    create: { width: 320, height: 400, channels: 3, background: { r: 96, g: 128, b: 160 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(jpeg);
}

/** The tables snapshotCivic reads, each with the key columns it orders by. */
const SNAPSHOT_TABLES: readonly { table: string; keys: readonly string[] }[] = [
  { table: 'jurisdictions', keys: ['id'] },
  { table: 'districts', keys: ['id'] },
  { table: 'district_parts', keys: ['district_id', 'id'] },
  { table: 'district_fallbacks', keys: ['district_id', 'via_district_id'] },
  { table: 'district_display', keys: ['district_id', 'zoom_band'] },
  { table: 'zip_centroids', keys: ['zip'] },
  { table: 'offices', keys: ['id'] },
  { table: 'office_powers', keys: ['office_id', 'power_id'] },
  { table: 'office_issues', keys: ['office_id', 'issue_id'] },
  { table: 'elections', keys: ['id'] },
  { table: 'filing_tracks', keys: ['id'] },
  { table: 'people', keys: ['id'] },
  { table: 'person_aliases', keys: ['person_id', 'alias'] },
  { table: 'given_name_aliases', keys: ['canonical', 'alias'] },
  { table: 'officeholders', keys: ['id'] },
  { table: 'bundle_changes', keys: ['id'] },
  { table: 'users', keys: ['id'] },
];

/** md5 per table, select md5(coalesce(string_agg(t::text, '|' order by <key columns>), '')) from <table> t, over the civic tables, bundle_changes and users. */
export async function snapshotCivic(db: Db): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const { table, keys } of SNAPSHOT_TABLES) {
    const order = sql.join(
      keys.map((key) => sql`t.${sql.identifier(key)}`),
      sql`, `,
    );
    const [row] = await db.execute<{ md5: string }>(
      sql`select md5(coalesce(string_agg(t::text, '|' order by ${order}), '')) as md5
          from ${sql.identifier(table)} t`,
      'objects',
    );
    snapshot[table] = row?.md5 ?? '';
  }
  return snapshot;
}
