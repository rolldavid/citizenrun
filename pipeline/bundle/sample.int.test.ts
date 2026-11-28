import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
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
import type { BDistrict, BGeometry, BundleManifest } from '@citizenrun/shared';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { bucketKeys } from '../lib/bucket.ts';
import type { DataBucket } from '../lib/bucket.ts';
import { NO_FETCHER } from '../lib/runner.ts';
import type { RunContext } from '../lib/runner.ts';
import { geomHash, multiPolygonToWkb, toHex } from '../lib/wkb.ts';
import { writeParsedListing } from '../sources/census-gus.ts';
import type { ParsedListingRow } from '../sources/census-gus.ts';
import { fixtureContext } from '../templates/__fixtures__/zz-fake-fetcher.ts';
import { getTestBucket, resetStorage } from '../testing/setup.ts';
import { FULL_FILES, emptyRows } from './assemble.ts';
import type { AssembledRows, FullFileName } from './assemble.ts';
import { integrityCheck } from './checks.ts';
import { encodeFile } from './files.ts';
import { SampleTooLarge, assertSampleSize, buildSample } from './sample.ts';
import type { MultiPolygonCoords, SampleOptions } from './sample.ts';
import {
  district,
  election,
  holder,
  jurisdiction,
  office,
  person,
  power,
  track,
} from './testing/rows.ts';

// B-sample's tests on a ZZ source full and geometry bundle written into the test `data` bucket.

const FULL_VERSION = '20261126T120000Z-full';
const GEOMETRY_VERSION = '20261126T120000Z-geometry';
const OLDER_GEOMETRY = '20261120T120000Z-geometry';
const NOW = new Date('2026-11-27T10:00:00.000Z');
const LATER = new Date('2026-11-27T10:00:01.000Z');
const PEOPLE = 25;
const FULL_ATTRIBUTION = '# Attribution\n\nFixture full bundle credits.\n';
const GEOMETRY_ATTRIBUTION = '# Attribution\n\nFixture geometry bundle credits.\n';

const SCHEMAS: Readonly<Record<FullFileName, z.ZodType>> = {
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

type Square = readonly [number, number, number];

function square([x, y, size]: Square): MultiPolygonCoords {
  return [
    [
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
        [x, y],
      ],
    ],
  ];
}

/** A closed ring of `n` jittered points around the square's edge: a large lookup shape. */
function detailed([x, y, size]: Square, n: number): MultiPolygonCoords {
  const ring: [number, number][] = [];
  let seed = 7;
  const jitter = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed / 2147483647) * 0.001;
  };
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * 4;
    const side = Math.floor(t);
    const f = t - side;
    const points: [number, number][] = [
      [x + f * size, y],
      [x + size, y + f * size],
      [x + size - f * size, y + size],
      [x, y + size - f * size],
    ];
    const [px, py] = points[side] ?? [x, y];
    ring.push([px + jitter(), py + jitter()]);
  }
  const first = ring[0] ?? [x, y];
  ring.push([first[0], first[1]]);
  return [[ring]];
}

function hex(coords: MultiPolygonCoords): string {
  return toHex(multiPolygonToWkb(coords));
}

function exact(
  key: string,
  jurisdictionKey: string,
  lookup: MultiPolygonCoords,
  display: MultiPolygonCoords,
  level: BDistrict['level'],
): { row: BDistrict; shape: BGeometry } {
  const geomHash_ = geomHash(multiPolygonToWkb(lookup));
  const first = display[0]?.[0]?.[0] ?? [0, 0];
  return {
    row: district(key, { jurisdiction_key: jurisdictionKey, level, geom_hash: geomHash_ }),
    shape: {
      source_key: key,
      lookup_wkb: hex(lookup),
      display_wkb: hex(display),
      label_point: [first[0], first[1]],
      outline_svg: 'M0 0L10 0L10 10Z',
      outline_bbox: [0, 0, 1, 1],
      geom_hash: geomHash_,
    },
  };
}

function squares(at: Square, level: BDistrict['level']) {
  return (key: string, jurisdictionKey: string) =>
    exact(
      key,
      jurisdictionKey,
      square(at),
      square([at[0] + 0.01, at[1] + 0.01, at[2] - 0.02]),
      level,
    );
}

function approximate(key: string, jurisdictionKey: string): { row: BDistrict; shape: BGeometry } {
  const fake = 'c'.repeat(64);
  return {
    row: district(key, {
      jurisdiction_key: jurisdictionKey,
      geometry_quality: 'county_approx',
      level: 'special',
      geom_hash: fake,
    }),
    shape: {
      source_key: key,
      lookup_wkb: null,
      display_wkb: null,
      label_point: null,
      outline_svg: null,
      outline_bbox: null,
      geom_hash: fake,
    },
  };
}

function listingRow(pid6: string, county: string): ParsedListingRow {
  return {
    tab: 'General Purpose',
    pid6,
    unit_name: `FIXTURE UNIT ${pid6}`,
    unit_type: null,
    title: null,
    city: null,
    state: 'ZZ',
    zip: null,
    web_address: null,
    political_code_description: null,
    population: null,
    population_source_year: null,
    fips_state: '99',
    fips_county: county,
    fips_place: null,
    county_area_name: null,
    active: true,
    function_name: null,
    school_enrollment: null,
    enrollment_year: null,
    school_level_description: null,
    parent_pid6: null,
    parent_unit_name: null,
  };
}

async function photo(n: number): Promise<Uint8Array> {
  const bytes = await sharp({
    create: { width: 8, height: 10, channels: 3, background: { r: n * 9, g: 40, b: 200 - n } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  return new Uint8Array(bytes);
}

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

/** Writes the ZZ source bundles, their pointers, the photos and the parsed listing. */
async function writeSource(bucket: DataBucket, ctx: RunContext): Promise<void> {
  const rows: AssembledRows = emptyRows();
  const shapes: BGeometry[] = [];
  const add = (made: { row: BDistrict; shape: BGeometry }) => {
    rows.districts.push(made.row);
    shapes.push(made.shape);
  };
  rows.jurisdictions.push(
    jurisdiction('state:ZZ', { kind: 'state', name: 'Fixture State' }),
    jurisdiction('census:990001', { name: 'Fixture County', parent_key: 'state:ZZ' }),
    jurisdiction('census:990007', { name: 'Fixture Second County', parent_key: 'state:ZZ' }),
    jurisdiction('census:990009', { name: 'Fixture Far County', parent_key: 'state:ZZ' }),
    jurisdiction('coop:1001', { kind: 'coop', name: 'Fixture Co-op' }),
  );
  add(exact('tiger:state:99', 'state:ZZ', detailed([0, 0, 20], 6000), square([0, 0, 20]), 'state'));
  add(squares([0, 0, 1], 'county')('tiger:county:99001', 'census:990001'));
  add(squares([2, 0, 1], 'county')('tiger:county:99003', 'census:990007'));
  add(squares([10, 10, 1], 'county')('tiger:county:99005', 'census:990009'));
  add(squares([0.5, 0.5, 2], 'federal')('tiger:cd:9901', 'state:ZZ'));
  add(squares([-1, 0, 1], 'federal')('tiger:cd:9902', 'state:ZZ'));
  add(squares([9, 9, 3], 'federal')('tiger:cd:9903', 'state:ZZ'));
  add(approximate('county_approx:coop:1001', 'coop:1001'));
  rows.district_fallbacks.push(
    {
      source_key: 'county_approx:coop:1001|tiger:county:99001',
      district_key: 'county_approx:coop:1001',
      via_district_key: 'tiger:county:99001',
    },
    {
      source_key: 'county_approx:coop:1001|tiger:county:99005',
      district_key: 'county_approx:coop:1001',
      via_district_key: 'tiger:county:99005',
    },
  );
  const offices: [string, string, string][] = [
    ['zz-governor', 'state:ZZ', 'tiger:state:99'],
    ['zz-fixture-county-commission', 'census:990001', 'tiger:county:99001'],
    ['zz-fixture-second-county-commission', 'census:990007', 'tiger:county:99003'],
    ['zz-fixture-far-county-commission', 'census:990009', 'tiger:county:99005'],
    ['zz-fixture-co-op-board', 'coop:1001', 'county_approx:coop:1001'],
    ['zz-us-house-1', 'state:ZZ', 'tiger:cd:9901'],
    ['zz-us-house-2', 'state:ZZ', 'tiger:cd:9902'],
    ['zz-us-house-3', 'state:ZZ', 'tiger:cd:9903'],
  ];
  for (const [slug, jurisdictionKey, districtKey] of offices) {
    rows.offices.push(
      office(slug, { jurisdiction_key: jurisdictionKey, district_key: districtKey }),
    );
    rows.office_powers.push(power(slug, 'budget'));
    const general = election(slug, '2027-11-02');
    rows.elections.push(general);
    rows.filing_tracks.push(track(general.source_key));
  }
  const assets: BundleManifest['assets'] = [];
  for (let n = 1; n <= PEOPLE; n += 1) {
    const bytes = await photo(n);
    const hash = sha(bytes);
    await bucket.putBytes(bucketKeys.asset('photos', hash, 'jpg'), bytes, 'image/jpeg');
    const path = `../../assets/photos/${hash}.jpg`;
    assets.push({
      path,
      sha256: hash,
      kind: 'photo',
      bytes: bytes.byteLength,
      content_type: 'image/jpeg',
    });
    const key = `wikidata:Q${String(n)}`;
    rows.people.push(
      person(key, {
        slug: `fixture-person-${String(n).padStart(8, '0')}`,
        photo: {
          asset: path,
          width: 8,
          height: 10,
          source_url: 'https://example.test/zz/photo',
          author: 'Fixture Author',
          license: 'CC0-1.0',
          license_url: 'https://example.test/zz/license',
          credit_text: 'Fixture credit',
          modified: false,
          retrieved_at: '2026-11-01T00:00:00.000Z',
        },
      }),
    );
    rows.officeholders.push(holder('zz-fixture-county-commission', key));
  }
  rows.given_name_aliases.push({
    source_key: 'william|bill',
    canonical: 'william',
    alias: 'bill',
    source: 'nicknames',
  });

  const files: BundleManifest['files'] = [];
  for (const name of FULL_FILES) {
    const encoded = encodeFile(rows[name] as readonly unknown[], SCHEMAS[name], name);
    const path = `${name}.ndjson.gz`;
    await bucket.putBytes(
      bucketKeys.bundleFile(FULL_VERSION, path),
      encoded.bytes,
      'application/gzip',
    );
    files.push({
      name,
      state: null,
      path,
      sha256: encoded.sha256,
      bytes: encoded.bytes.byteLength,
      rows: encoded.rows,
    });
  }
  const geometry = encodeFile(shapes, BGeometrySchema, 'geometry');
  await bucket.putBytes(
    bucketKeys.bundleFile(GEOMETRY_VERSION, 'geometry/ZZ.ndjson.gz'),
    geometry.bytes,
    'application/gzip',
  );
  const zip = encodeFile(
    [
      { source_key: 'zcta:99001', zip: '99001', state: 'ZZ', lng: 0.5, lat: 0.5 },
      { source_key: 'zcta:99005', zip: '99005', state: 'ZZ', lng: 10.5, lat: 10.5 },
    ],
    BZipCentroidSchema,
    'zip_centroids',
  );
  // The ZIP file is held by an older geometry version, as the writer references an unchanged file.
  await bucket.putBytes(
    bucketKeys.bundleFile(OLDER_GEOMETRY, 'zip_centroids.ndjson.gz'),
    zip.bytes,
    'application/gzip',
  );
  const base = {
    format: 'citizenrun-bundle',
    schema_version: 1,
    schema_revision: 0,
    created_at: '2026-11-26T12:00:00.000Z',
    git_sha: '1'.repeat(40),
    states: ['ZZ'],
    filing_sources: [],
    attribution_path: 'ATTRIBUTION.md',
    datasets: {
      'census-gus': {
        edition: '2026',
        downloaded_on: '2026-11-26',
        source_url: 'https://example.test/zz/gus.zip',
      },
    },
    checks: [{ name: 'personal_data', passed: true, detail: 'matches=0' }],
  };
  const geometryManifest = BundleManifestSchema.parse({
    ...base,
    kind: 'geometry',
    version: GEOMETRY_VERSION,
    geometry_version: null,
    tiger_vintage: '2026',
    files: [
      {
        name: 'geometry',
        state: 'ZZ',
        path: 'geometry/ZZ.ndjson.gz',
        sha256: geometry.sha256,
        bytes: geometry.bytes.byteLength,
        rows: geometry.rows,
      },
      {
        name: 'zip_centroids',
        state: null,
        path: `../${OLDER_GEOMETRY}/zip_centroids.ndjson.gz`,
        sha256: zip.sha256,
        bytes: zip.bytes.byteLength,
        rows: zip.rows,
      },
    ],
    assets: [],
    two_source_fields: 0,
    coverage_path: null,
  });
  const fullManifest = BundleManifestSchema.parse({
    ...base,
    kind: 'full',
    version: FULL_VERSION,
    geometry_version: GEOMETRY_VERSION,
    tiger_vintage: null,
    files,
    assets,
    two_source_fields: 0,
    coverage_path: `../../reports/coverage/${FULL_VERSION}.json`,
  });
  await bucket.putBytes(
    bucketKeys.bundleFile(FULL_VERSION, 'ATTRIBUTION.md'),
    new TextEncoder().encode(FULL_ATTRIBUTION),
    'text/markdown',
  );
  await bucket.putBytes(
    bucketKeys.bundleFile(GEOMETRY_VERSION, 'ATTRIBUTION.md'),
    new TextEncoder().encode(GEOMETRY_ATTRIBUTION),
    'text/markdown',
  );
  await bucket.putBytes(
    bucketKeys.bundleFile(GEOMETRY_VERSION, 'manifest.json'),
    json(geometryManifest),
    'application/json',
  );
  await bucket.putBytes(
    bucketKeys.bundleFile(FULL_VERSION, 'manifest.json'),
    json(fullManifest),
    'application/json',
  );
  for (const [kind, version] of [
    ['geometry', GEOMETRY_VERSION],
    ['full', FULL_VERSION],
  ] as const) {
    await bucket.putJson(
      bucketKeys.pointer(kind),
      {
        kind,
        version,
        manifest: `bundles/${version}/manifest.json`,
        published_at: '2026-11-26T12:05:00.000Z',
      },
      BundlePointerSchema,
    );
  }
  await writeParsedListing(ctx, [
    listingRow('990001', '001'),
    listingRow('990007', '003'),
    listingRow('990009', '005'),
  ]);
}

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sample-bundle-'));
  dirs.push(dir);
  return dir;
}

async function setup(): Promise<{ bucket: DataBucket; ctx: (now?: Date) => RunContext }> {
  const { bucket } = await getTestBucket('data');
  const ctx = (now = NOW) => fixtureContext({ bucket, fetcher: NO_FETCHER, now });
  await writeSource(bucket, ctx());
  return { bucket, ctx };
}

function options(outDir: string, extra: Partial<SampleOptions> = {}): SampleOptions {
  return {
    outDir,
    counties: ['99001', '99003'],
    states: ['ZZ'],
    maxBytes: 25_000_000,
    now: NOW,
    gitSha: 'f'.repeat(40),
    ...extra,
  };
}

async function filesOf(dir: string, sub = ''): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(join(dir, sub), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = sub === '' ? entry.name : `${sub}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await filesOf(dir, rel)));
    else out.push(rel);
  }
  return out.sort();
}

async function ndjson(path: string): Promise<Record<string, unknown>[]> {
  const text = gunzipSync(await readFile(path)).toString('utf8');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function sampleRows(dir: string): Promise<AssembledRows> {
  const rows = emptyRows();
  for (const name of FULL_FILES) {
    (rows[name] as unknown[]).push(...(await ndjson(join(dir, 'full', `${name}.ndjson.gz`))));
  }
  return rows;
}

async function sampleGeometry(dir: string): Promise<Map<string, BGeometry>> {
  const rows = (await ndjson(join(dir, 'geometry', 'geometry', 'ZZ.ndjson.gz'))) as BGeometry[];
  return new Map(rows.map((row) => [row.source_key, row]));
}

async function manifest(dir: string, kind: 'full' | 'geometry'): Promise<BundleManifest> {
  return BundleManifestSchema.parse(
    JSON.parse(await readFile(join(dir, kind, 'manifest.json'), 'utf8')),
  );
}

beforeEach(async () => {
  await resetStorage();
});

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs = [];
});

describe('buildSample', () => {
  it('two runs give byte-identical files', async () => {
    const { ctx } = await setup();
    const a = await tempDir();
    const b = await tempDir();
    await buildSample(ctx(NOW), options(a, { now: NOW }));
    await buildSample(ctx(LATER), options(b, { now: LATER }));
    const files = await filesOf(a);
    expect(await filesOf(b)).toEqual(files);
    const data = files.filter((file) => file.endsWith('.ndjson.gz') || file.endsWith('.jpg'));
    expect(data.length).toBeGreaterThan(FULL_FILES.length + 2);
    for (const file of data) {
      expect(
        Buffer.compare(await readFile(join(a, file)), await readFile(join(b, file))),
        file,
      ).toBe(0);
    }
    for (const kind of ['full', 'geometry'] as const) {
      const first = await manifest(a, kind);
      const second = await manifest(b, kind);
      expect(first.created_at).toBe(NOW.toISOString());
      expect(second.created_at).toBe(LATER.toISOString());
      expect({ ...second, created_at: first.created_at }).toEqual(first);
    }
  });

  it('manifests parse and are sample versions', async () => {
    const { ctx } = await setup();
    const dir = await tempDir();
    const result = await buildSample(ctx(), options(dir));
    const full = await manifest(dir, 'full');
    const geometry = await manifest(dir, 'geometry');
    expect(full.version).toBe(`sample-${FULL_VERSION}`);
    expect(geometry.version).toBe(`sample-${GEOMETRY_VERSION}`);
    expect(full.geometry_version).toBe(geometry.version);
    expect(result.fullVersion).toBe(full.version);
    expect(result.geometryVersion).toBe(geometry.version);
    expect(full.states).toEqual(['ZZ']);
    expect(full.coverage_path).toBeNull();
    expect(geometry.coverage_path).toBeNull();
    expect(full.attribution_path).toBe('ATTRIBUTION.md');
    expect(full.git_sha).toBe('f'.repeat(40));
    expect(full.datasets['census-gus']?.edition).toBe('2026');
    expect(full.checks).toEqual([{ name: 'personal_data', passed: true, detail: 'matches=0' }]);
    expect(geometry.files.map((file) => file.path)).toEqual([
      'geometry/ZZ.ndjson.gz',
      'zip_centroids.ndjson.gz',
    ]);
    // Every file matches its entry; every asset is named by its hash.
    for (const [kind, m] of [
      ['full', full],
      ['geometry', geometry],
    ] as const) {
      for (const file of m.files) {
        const bytes = await readFile(join(dir, kind, file.path));
        expect(sha(bytes), file.path).toBe(file.sha256);
        expect(bytes.byteLength).toBe(file.bytes);
        expect((await ndjson(join(dir, kind, file.path))).length).toBe(file.rows);
      }
    }
    expect(full.assets).toHaveLength(20);
    for (const asset of full.assets) {
      expect(asset.path).toBe(`../assets/photos/${asset.sha256}.jpg`);
      expect(sha(await readFile(join(dir, 'assets', 'photos', `${asset.sha256}.jpg`)))).toBe(
        asset.sha256,
      );
    }
    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    expect(readme).toContain(`Source full bundle: ${FULL_VERSION}.`);
    expect(readme).toContain(`Source geometry bundle: ${GEOMETRY_VERSION}.`);
    expect(readme).not.toMatch(/\/Users\/|\/home\/|C:\\/);
  });

  it('every key reference resolves inside the sample', async () => {
    const { ctx } = await setup();
    const dir = await tempDir();
    await buildSample(ctx(), options(dir));
    const rows = await sampleRows(dir);
    expect(integrityCheck(rows, await sampleGeometry(dir))).toEqual(
      expect.objectContaining({ passed: true }),
    );
    const offices = rows.offices.map((row) => row.source_key).sort();
    expect(offices).toEqual(
      [
        'zz-fixture-co-op-board',
        'zz-fixture-county-commission',
        'zz-fixture-second-county-commission',
        'zz-governor',
        'zz-us-house-1',
      ].sort(),
    );
    const zip = await ndjson(join(dir, 'geometry', 'zip_centroids.ndjson.gz'));
    expect(zip.map((row) => row['source_key'])).toEqual(['zcta:99001']);
  });

  it('the size check fails above the limit', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'full'));
    await writeFile(join(dir, 'full', 'big.bin'), Buffer.alloc(24_999_990));
    await writeFile(join(dir, 'README.md'), Buffer.alloc(10));
    expect(await assertSampleSize(dir, 25_000_000)).toBe(25_000_000);
    await writeFile(join(dir, 'README.md'), Buffer.alloc(11));
    await expect(assertSampleSize(dir, 25_000_000)).rejects.toThrow(SampleTooLarge);
    await expect(assertSampleSize(dir)).rejects.toThrow(SampleTooLarge);
  });

  it('a person outside the first 20 with a photo has photo null', async () => {
    const { ctx } = await setup();
    const dir = await tempDir();
    const result = await buildSample(ctx(), options(dir));
    expect(result.photos).toBe(20);
    const people = (await sampleRows(dir)).people;
    const order = people
      .map((row) => row.source_key)
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const outside = new Set(order.slice(20));
    expect(outside.size).toBe(5);
    for (const row of people) {
      if (outside.has(row.source_key)) expect(row.photo).toBeNull();
      else expect(row.photo?.asset).toMatch(/^\.\.\/assets\/photos\/[0-9a-f]{64}\.jpg$/);
    }
    expect((await filesOf(dir, 'assets/photos')).length).toBe(20);
  });

  it('the state districts are replaced when the folder is too large', async () => {
    const { ctx } = await setup();
    const plain = await tempDir();
    const first = await buildSample(ctx(), options(plain));
    expect(first.stateGeometryReplaced).toBe(false);
    const dir = await tempDir();
    const replaced = await buildSample(ctx(), options(dir, { maxBytes: first.bytes - 1 }));
    expect(replaced.stateGeometryReplaced).toBe(true);
    expect(replaced.bytes).toBeLessThan(first.bytes);
    const shapes = await sampleGeometry(dir);
    const state = shapes.get('tiger:state:99');
    expect(state?.lookup_wkb).toBe(state?.display_wkb);
    const county = shapes.get('tiger:county:99001');
    expect(county?.lookup_wkb).not.toBe(county?.display_wkb);

    const small = await tempDir();
    await expect(buildSample(ctx(), options(small, { maxBytes: 1000 }))).rejects.toThrow(
      SampleTooLarge,
    );
    expect(await filesOf(small)).toEqual([]);
    for (const folder of ['full', 'geometry', 'assets']) {
      await expect(stat(join(small, folder))).rejects.toThrow();
    }
  });

  it('no sample pointer is written', async () => {
    const { bucket, ctx } = await setup();
    const list = async () => {
      const out: string[] = [];
      for await (const info of bucket.list('bundles/index/')) out.push(info.key);
      return out.sort();
    };
    const before = await list();
    expect(before).toEqual(['bundles/index/full.json', 'bundles/index/geometry.json']);
    const full = await bucket.getBytes('bundles/index/full.json');
    await buildSample(ctx(), options(await tempDir()));
    expect(await list()).toEqual(before);
    expect(await bucket.getBytes('bundles/index/full.json')).toEqual(full);
    const keys: string[] = [];
    for await (const info of bucket.list('bundles/')) keys.push(info.key);
    expect(keys.some((key) => key.includes('sample-'))).toBe(false);
  });

  it('the reference closure is in the sample', async () => {
    const { ctx } = await setup();
    const dir = await tempDir();
    await buildSample(ctx(), options(dir));
    const rows = await sampleRows(dir);
    const jurisdictions = new Set(rows.jurisdictions.map((row) => row.source_key));
    for (const row of rows.districts) expect(jurisdictions.has(row.jurisdiction_key)).toBe(true);
    for (const row of rows.jurisdictions) {
      if (row.parent_key !== null) expect(jurisdictions.has(row.parent_key)).toBe(true);
    }
    // The far county is kept only as the co-op's via district, with no office.
    expect(jurisdictions.has('census:990009')).toBe(true);
    expect(rows.offices.some((row) => row.jurisdiction_key === 'census:990009')).toBe(false);
    const far = (await sampleGeometry(dir)).get('tiger:county:99005');
    expect(far?.lookup_wkb).toBe(far?.display_wkb);
    // A border-only or distant congressional district is not kept.
    const districts = rows.districts.map((row) => row.source_key);
    expect(districts).toContain('tiger:cd:9901');
    expect(districts).not.toContain('tiger:cd:9902');
    expect(districts).not.toContain('tiger:cd:9903');
  });

  it('attribution files are copied byte for byte', async () => {
    const { ctx } = await setup();
    const dir = await tempDir();
    await buildSample(ctx(), options(dir));
    expect(await readFile(join(dir, 'full', 'ATTRIBUTION.md'), 'utf8')).toBe(FULL_ATTRIBUTION);
    expect(await readFile(join(dir, 'geometry', 'ATTRIBUTION.md'), 'utf8')).toBe(
      GEOMETRY_ATTRIBUTION,
    );
  });
});
