import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoundarySource } from '../../lib/data-files.ts';
import { scriptedRun } from '../../sources/dataset.fixtures.ts';
import { GEOJSON, buildWardDistricts, kebab } from './wards.ts';
import type { MultiPolygonCoords } from './geometry.ts';

const FIXTURE = join(
  import.meta.dirname,
  '..',
  '..',
  '__fixtures__',
  's01',
  'wards',
  'zz-fixture-wards.geojson',
);

/** A made-up register entry for the made-up layer of place 9999999. */
const ENTRY: BoundarySource = {
  key: 'zz-fixture-wards',
  place_geoid: '9999999',
  url: 'https://gis.example.gov/wards/query?f=geojson',
  publisher: 'City of Fixture',
  licence_text: 'Published by the City of Fixture.',
  retrieved_on: '2026-11-26',
  label_field: 'DISTRICT_NAME',
  format: 'geojson',
};

/** Land covering both made-up squares. */
const MASK: MultiPolygonCoords = [
  [
    [
      [-81, 34],
      [-79, 34],
      [-79, 36],
      [-81, 36],
      [-81, 34],
    ],
  ],
];

async function runWith(layers: Record<string, string>, entries: BoundarySource[]) {
  const { ctx, fetcher } = scriptedRun((url) => {
    const body = layers[url];
    return body === undefined
      ? undefined
      : { kind: 'body', contentType: 'application/geo+json', body };
  });
  const result = await buildWardDistricts(ctx, {
    entries,
    stateFips: '99',
    placeOwners: new Map([['9999999', 'census:999999']]),
    mask: MASK,
  });
  return { result, fetcher };
}

describe('wards', () => {
  it('writes one exact local district per registered ward', async () => {
    const geojson = await readFile(FIXTURE, 'utf8');
    const { result, fetcher } = await runWith({ [ENTRY.url]: geojson }, [ENTRY]);
    expect(result.failures).toEqual([]);
    expect(
      result.districts.map((district) => [district.key, district.name, district.jurisdictionKey]),
    ).toEqual([
      ['ward:9999999:district-1', 'District 1', 'census:999999'],
      ['ward:9999999:district-2', 'District 2', 'census:999999'],
    ]);
    for (const district of result.districts) {
      expect(district.geometry.lookup_wkb).not.toBeNull();
      expect(district.geometry.display_wkb).not.toBeNull();
      expect(district.geometry.label_point).not.toBeNull();
    }
    expect(fetcher.requests).toMatchObject([
      { mode: 'download', url: ENTRY.url, req: { class: 'api' } },
    ]);
    expect(fetcher.requests[0]?.key).toMatch(
      /^datasets\/ward-layers\/2026-11-26\/zz-fixture-wards\.geojson\.part-/,
    );
  });

  it('a layer missing its label field fails that layer only', async () => {
    const geojson = await readFile(FIXTURE, 'utf8');
    const other: BoundarySource = {
      ...ENTRY,
      key: 'zz-fixture-wards-unlabelled',
      url: 'https://gis.example.gov/other/query?f=geojson',
      label_field: 'WARD_LABEL',
    };
    const { result } = await runWith({ [ENTRY.url]: geojson, [other.url]: geojson }, [
      ENTRY,
      other,
    ]);
    expect(result.failures).toEqual([
      { layer: 'zz-fixture-wards-unlabelled', reason: 'a feature has no label' },
    ]);
    expect(result.districts.map((district) => district.key)).toEqual([
      'ward:9999999:district-1',
      'ward:9999999:district-2',
    ]);
  });

  it('a layer with a duplicate label fails', async () => {
    const parsed = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
      features: { properties: Record<string, unknown> }[];
    };
    for (const feature of parsed.features) feature.properties['DISTRICT_NAME'] = 'District 1';
    const { result } = await runWith({ [ENTRY.url]: JSON.stringify(parsed) }, [ENTRY]);
    expect(result.failures).toEqual([
      { layer: 'zz-fixture-wards', reason: 'two features share a label' },
    ]);
    expect(result.districts).toEqual([]);
  });

  it('a label prefix turns a bare number into the template label', async () => {
    const parsed = JSON.parse(await readFile(FIXTURE, 'utf8')) as {
      features: { properties: Record<string, unknown> }[];
    };
    parsed.features.forEach((feature, index) => {
      feature.properties['DISTRICT_NAME'] = String(index + 1);
    });
    const prefixed: BoundarySource = { ...ENTRY, label_prefix: 'District ' };
    const { result } = await runWith({ [ENTRY.url]: JSON.stringify(parsed) }, [prefixed]);
    expect(result.failures).toEqual([]);
    expect(result.districts.map((district) => [district.key, district.name])).toEqual([
      ['ward:9999999:district-1', 'District 1'],
      ['ward:9999999:district-2', 'District 2'],
    ]);
  });

  it('accepts the GeoJSON media types and refuses others', () => {
    for (const type of [
      'application/geo+json',
      'application/vnd.geo+json',
      'application/json; charset=utf-8',
      'text/plain',
    ]) {
      expect(GEOJSON.test(type)).toBe(true);
    }
    for (const type of ['text/html', 'application/zip', 'application/vnd.ms-excel']) {
      expect(GEOJSON.test(type)).toBe(false);
    }
  });

  it('reads only the layers of places in the state', async () => {
    const elsewhere: BoundarySource = { ...ENTRY, place_geoid: '9899999' };
    const { result, fetcher } = await runWith({}, [elsewhere]);
    expect(result).toEqual({ districts: [], failures: [] });
    expect(fetcher.requests).toEqual([]);
  });

  it('kebab forms a label', () => {
    expect(kebab('District 1')).toBe('district-1');
    expect(kebab('  Ward  IV (North) ')).toBe('ward-iv-north');
  });
});
