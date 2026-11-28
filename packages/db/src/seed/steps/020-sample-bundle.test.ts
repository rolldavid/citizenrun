import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { BundleManifestSchema, looksPersonal } from '@citizenrun/shared';
import type { BundleManifest } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { SAMPLE_MANIFEST_PATH } from './020-sample-bundle.ts';

// TEST-seed-sample-bundle (unit): the committed sample folder, read as it is. Nothing here names a
// count, slug or name of the sample (TC-13): every expectation comes from its manifests.

const ROOT = dirname(dirname(SAMPLE_MANIFEST_PATH));
const MAX_BYTES = 25_000_000;
const MAX_PHOTOS = 20;
const COUNTIES = ['37063', '37135', '53067', '53045'];
const STATE_DISTRICTS = ['tiger:state:37', 'tiger:state:53'];

type Row = Record<string, unknown> & { source_key: string };

async function manifestOf(kind: 'full' | 'geometry'): Promise<BundleManifest> {
  return BundleManifestSchema.parse(
    JSON.parse(await readFile(join(ROOT, kind, 'manifest.json'), 'utf8')),
  );
}

async function rowsAt(path: string): Promise<Row[]> {
  return gunzipSync(await readFile(path))
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Row);
}

async function fullRows(name: string): Promise<Row[]> {
  return rowsAt(join(ROOT, 'full', `${name}.ndjson.gz`));
}

async function geometryRows(): Promise<Map<string, Row>> {
  const manifest = await manifestOf('geometry');
  const out = new Map<string, Row>();
  for (const file of manifest.files.filter((entry) => entry.name === 'geometry')) {
    for (const row of await rowsAt(join(ROOT, 'geometry', file.path))) out.set(row.source_key, row);
  }
  return out;
}

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out;
}

function strings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) strings(item, out);
  }
}

function text(row: Row, field: string): string | null {
  const value = row[field];
  return typeof value === 'string' ? value : null;
}

describe('the committed sample bundle', () => {
  it('the sample is two states, versioned sample-', async () => {
    const full = await manifestOf('full');
    const geometry = await manifestOf('geometry');
    expect(full.kind).toBe('full');
    expect(geometry.kind).toBe('geometry');
    expect(full.states).toEqual(['NC', 'WA']);
    expect(geometry.states).toEqual(['NC', 'WA']);
    expect(full.version.startsWith('sample-')).toBe(true);
    expect(geometry.version.startsWith('sample-')).toBe(true);
    expect(full.geometry_version).toBe(geometry.version);
    expect(full.coverage_path).toBeNull();
  });

  it('the folder is at most 25 MB', async () => {
    let bytes = 0;
    for (const file of await filesUnder(ROOT)) bytes += (await stat(file)).size;
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('files match their manifest', async () => {
    for (const kind of ['full', 'geometry'] as const) {
      const manifest = await manifestOf(kind);
      for (const file of manifest.files) {
        const path = join(ROOT, kind, file.path);
        const bytes = await readFile(path);
        expect(createHash('sha256').update(bytes).digest('hex'), file.path).toBe(file.sha256);
        expect(bytes.byteLength, file.path).toBe(file.bytes);
        expect((await rowsAt(path)).length, file.path).toBe(file.rows);
      }
    }
    const full = await manifestOf('full');
    expect(full.assets.length).toBeLessThanOrEqual(MAX_PHOTOS);
    for (const asset of full.assets) {
      expect(asset.path).toBe(`../assets/photos/${asset.sha256}.jpg`);
      const bytes = await readFile(join(ROOT, 'full', asset.path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(bytes.byteLength).toBe(asset.bytes);
    }
    const stored = (await readdir(join(ROOT, 'assets', 'photos'))).sort();
    expect(stored).toEqual(full.assets.map((asset) => `${asset.sha256}.jpg`).sort());
  });

  it('the four counties and the wider geography are present', async () => {
    const districts = new Set((await fullRows('districts')).map((row) => row.source_key));
    const shapes = await geometryRows();
    for (const key of [...COUNTIES.map((geoid) => `tiger:county:${geoid}`), ...STATE_DISTRICTS]) {
      expect(districts.has(key), key).toBe(true);
      const shape = shapes.get(key);
      expect(shape?.['lookup_wkb'], key).toEqual(expect.any(String));
      expect(shape?.['display_wkb'], key).toEqual(expect.any(String));
    }
    for (const fips of ['37', '53']) {
      for (const layer of ['cd', 'sldu', 'sldl']) {
        const prefix = `tiger:${layer}:${fips}`;
        expect(
          [...districts].some((key) => key.startsWith(prefix)),
          prefix,
        ).toBe(true);
      }
    }
    const zip = await rowsAt(join(ROOT, 'geometry', 'zip_centroids.ndjson.gz'));
    expect(zip.length).toBeGreaterThan(0);
    for (const row of zip) expect(['NC', 'WA']).toContain(row['state']);
  });

  it('every reference resolves', async () => {
    const [jurisdictions, districts, fallbacks, offices, powers, elections, tracks] =
      await Promise.all(
        [
          'jurisdictions',
          'districts',
          'district_fallbacks',
          'offices',
          'office_powers',
          'elections',
          'filing_tracks',
        ].map(fullRows),
      );
    const [people, aliases, holders] = await Promise.all(
      ['people', 'person_aliases', 'officeholders'].map(fullRows),
    );
    const keys = (rows: readonly Row[] | undefined) =>
      new Set((rows ?? []).map((r) => r.source_key));
    const jurisdictionKeys = keys(jurisdictions);
    const districtByKey = new Map((districts ?? []).map((row) => [row.source_key, row]));
    const officeKeys = keys(offices);
    const electionKeys = keys(elections);
    const personKeys = keys(people);
    const failures: string[] = [];
    const need = (
      kind: string,
      value: string | null,
      set: { has(k: string): boolean },
      key: string,
    ) => {
      if (value !== null && !set.has(value)) failures.push(`${kind} ${key}`);
    };
    for (const row of jurisdictions ?? []) {
      need('parent_key', text(row, 'parent_key'), jurisdictionKeys, row.source_key);
    }
    for (const row of districts ?? []) {
      need('jurisdiction_key', text(row, 'jurisdiction_key'), jurisdictionKeys, row.source_key);
    }
    for (const row of fallbacks ?? []) {
      need('district_key', text(row, 'district_key'), districtByKey, row.source_key);
      need('via_district_key', text(row, 'via_district_key'), districtByKey, row.source_key);
      const via = districtByKey.get(text(row, 'via_district_key') ?? '');
      if (via !== undefined && via['geometry_quality'] !== 'exact') {
        failures.push(`via_not_exact ${row.source_key}`);
      }
    }
    for (const row of offices ?? []) {
      need(
        'offices.jurisdiction_key',
        text(row, 'jurisdiction_key'),
        jurisdictionKeys,
        row.source_key,
      );
      need('offices.district_key', text(row, 'district_key'), districtByKey, row.source_key);
    }
    for (const row of powers ?? [])
      need('office_powers', text(row, 'office_key'), officeKeys, row.source_key);
    for (const row of elections ?? [])
      need('elections', text(row, 'office_key'), officeKeys, row.source_key);
    for (const row of tracks ?? []) {
      need('filing_tracks', text(row, 'election_key'), electionKeys, row.source_key);
    }
    for (const row of holders ?? []) {
      need('officeholders.office_key', text(row, 'office_key'), officeKeys, row.source_key);
      need('officeholders.person_key', text(row, 'person_key'), personKeys, row.source_key);
    }
    for (const row of aliases ?? []) {
      need('person_aliases', text(row, 'person_key'), personKeys, row.source_key);
    }
    const shapes = await geometryRows();
    for (const row of districts ?? []) {
      const shape = shapes.get(row.source_key);
      if (shape === undefined) {
        failures.push(`geometry.missing ${row.source_key}`);
        continue;
      }
      if (shape['geom_hash'] !== row['geom_hash']) failures.push(`geom_hash ${row.source_key}`);
      const both = shape['lookup_wkb'] !== null && shape['display_wkb'] !== null;
      const any = shape['lookup_wkb'] !== null || shape['display_wkb'] !== null;
      if (row['geometry_quality'] === 'exact' ? !both : any) failures.push(`wkb ${row.source_key}`);
    }
    for (const rows of [jurisdictions, districts, fallbacks, offices, powers, elections, tracks]) {
      const list = rows ?? [];
      if (keys(list).size !== list.length) failures.push('duplicate source_key');
    }
    expect(failures).toEqual([]);
    // Every kept photo names an asset of the manifest.
    const assets = new Set((await manifestOf('full')).assets.map((asset) => asset.path));
    for (const row of people ?? []) {
      const photo = row['photo'] as { asset?: unknown } | null;
      if (photo !== null) expect(assets.has(String(photo.asset)), row.source_key).toBe(true);
    }
  });

  it('no personal contact detail', async () => {
    const found: string[] = [];
    for (const name of ['people', 'person_aliases', 'officeholders']) {
      for (const row of await fullRows(name)) {
        const values: string[] = [];
        strings(row, values);
        if (values.some((value) => looksPersonal(value))) found.push(`${name}:${row.source_key}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('the README names its sources and no machine path', async () => {
    const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
    const full = await manifestOf('full');
    const geometry = await manifestOf('geometry');
    expect(readme).toContain(full.version.slice('sample-'.length));
    expect(readme).toContain(geometry.version.slice('sample-'.length));
    expect(readme).not.toMatch(/\/Users\/|\/home\/|C:\\/);
  });
});
