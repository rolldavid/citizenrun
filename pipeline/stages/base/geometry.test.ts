import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BGeometrySchema } from '@citizenrun/shared';
import mapshaper from 'mapshaper';
import { describe, expect, it } from 'vitest';
import { storedZip } from '../../lib/zip.fixtures.ts';
import {
  buildGeometryRows,
  countyUnion,
  fallbackGeomHash,
  fallbackGeometry,
  featuresFromGeoJson,
  labelPoint,
  lookupProducts,
  readGeoJsonLayer,
  readLayer,
  shiftForAlaska,
  structureProblem,
} from './geometry.ts';
import type { LayerFeature, LayerId, MultiPolygonCoords } from './geometry.ts';

const FIXTURES = join(import.meta.dirname, '../../__fixtures__/geometry');
const PATTERN = /^[MLHVZmlhvz0-9 ,.-]+$/;

// The two unit squares of the WKB writer's test, with the hex and digest written there by hand.
const TWO_SQUARES_HEX =
  '0106000000020000000103000000010000000500000000000000000000000000000000000000000000000000f03f0000000000000000000000000000f03f000000000000f03f0000000000000000000000000000f03f00000000000000000000000000000000010300000001000000050000000000000000000040000000000000004000000000000008400000000000000040000000000000084000000000000008400000000000000040000000000000084000000000000000400000000000000040';
const TWO_SQUARES_HASH = '3896df0c170c31fb4e945259e01b0c2bdbc7ed19ffffde76c25150db36ebd7dc';

async function fixtureJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8')) as unknown;
}

function square(lng: number, lat: number, side: number): [number, number][] {
  return [
    [lng, lat],
    [lng + side, lat],
    [lng + side, lat + side],
    [lng, lat + side],
    [lng, lat],
  ];
}

function feature(geoid: string, coords: MultiPolygonCoords): LayerFeature {
  return { geoid, namelsad: `Fixture ${geoid}`, properties: { GEOID: geoid }, coords };
}

/** Web Mercator of a longitude and latitude, written out here from EPSG:3857's formula. */
function mercator(lng: number, lat: number): [number, number] {
  const r = 6378137;
  return [(r * lng * Math.PI) / 180, r * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
}

function svgPoints(svg: string): [number, number][] {
  const numbers = svg.replace(/[MLZ]/g, ' ').trim().split(/\s+/).map(Number);
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push([numbers[i] ?? Number.NaN, numbers[i + 1] ?? Number.NaN]);
  }
  return points;
}

describe('geometry', () => {
  it('the District of Columbia county outline has at most 400 points and matches the pattern', async () => {
    const county = await readGeoJsonLayer((await fixtureJson('dc-county.geojson')) as object, {
      layer: 'county',
      fields: { id: 'GEOID', name: 'NAMELSAD' },
    });
    const mask = featuresFromGeoJson(await fixtureJson('dc-mask.geojson'), {
      layer: 'cb-state',
      fields: { id: 'GEOID', name: 'NAME' },
    });
    expect(county.invalid).toEqual([]);
    expect(county.features.map((f) => [f.geoid, f.namelsad])).toEqual([
      ['11001', 'District of Columbia'],
    ]);
    const result = await buildGeometryRows({
      stateFips: '11',
      layers: new Map<LayerId, readonly LayerFeature[]>([['county', county.features]]),
      mask: mask.features.flatMap((f) => f.coords),
      wanted: new Map([['tiger:county:11001', { layer: 'county', geoid: '11001' }]]),
    });
    expect(result.checks).toEqual([
      { name: 'geometry_valid', passed: true, detail: '1 wanted features valid' },
    ]);
    expect(result.unclippedDisplay).toEqual([]);
    expect(result.droppedOutlines).toEqual([]);
    const row = result.rows.get('tiger:county:11001');
    expect(row).toBeDefined();
    expect(BGeometrySchema.parse(row)).toEqual(row);

    const svg = row?.outline_svg ?? '';
    expect(svg).toMatch(PATTERN);
    const points = svgPoints(svg);
    expect(points.length).toBeGreaterThan(10);
    expect(points.length).toBeLessThanOrEqual(400);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1000);
    }
    expect(Math.max(...points.flat())).toBe(1000);

    const [minX, minY, maxX, maxY] = row?.outline_bbox ?? [0, 0, 0, 0];
    expect(minX).toBeLessThan(maxX);
    expect(minY).toBeLessThan(maxY);
    const [boxMinX, boxMinY] = mercator(-77.12, 38.79);
    const [boxMaxX, boxMaxY] = mercator(-76.9, 39.0);
    expect(minX).toBeGreaterThanOrEqual(boxMinX);
    expect(minY).toBeGreaterThanOrEqual(boxMinY);
    expect(maxX).toBeLessThanOrEqual(boxMaxX);
    expect(maxY).toBeLessThanOrEqual(boxMaxY);

    const [lng, lat] = row?.label_point ?? [0, 0];
    expect(lng).toBeGreaterThan(-77.12);
    expect(lng).toBeLessThan(-76.9);
    expect(lat).toBeGreaterThan(38.79);
    expect(lat).toBeLessThan(39.0);

    // The lookup shape is the cleaned published shape; the display shape is a different, simpler one.
    expect(row?.lookup_wkb).toBe(lookupProducts(county.features[0] as LayerFeature).lookup_wkb);
    expect(row?.display_wkb).not.toBe(row?.lookup_wkb);
    expect((row?.display_wkb ?? '').length).toBeLessThan((row?.lookup_wkb ?? '').length);
    expect(row?.geom_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a two-polygon MultiPolygon gives the hand-written WKB', async () => {
    const { features, invalid } = featuresFromGeoJson(await fixtureJson('zz-two-squares.geojson'), {
      layer: 'county',
    });
    expect(invalid).toEqual([]);
    const [only] = features;
    expect(only?.geoid).toBe('99999');
    expect(only?.namelsad).toBe('Fixture Two Squares');
    expect(only === undefined ? null : lookupProducts(only)).toEqual({
      lookup_wkb: TWO_SQUARES_HEX,
      geom_hash: TWO_SQUARES_HASH,
    });
  });

  it('the fallback hash of a fixed via list equals its hand-computed digest', () => {
    // printf 'fallback:tiger:county:37063,tiger:county:37183' | shasum -a 256
    const digest = 'ef31957dc1747ede57d7e4371f20e9360edeb082ea26a221e1452a484a644071';
    expect(fallbackGeomHash(['tiger:county:37183', 'tiger:county:37063'])).toBe(digest);
    expect(fallbackGeomHash(['tiger:county:37063', 'tiger:county:37183'])).toBe(digest);
    expect(fallbackGeomHash(['tiger:county:37063'])).not.toBe(digest);
  });

  it('county union dissolves two counties into one exact shape', async () => {
    const west: MultiPolygonCoords = [[square(0, 0, 1)]];
    const east: MultiPolygonCoords = [[square(1, 0, 1)]];
    const row = await countyUnion(
      'county_union:ZZ:fixture-pair',
      [
        { lookup: west, display: west },
        { lookup: east, display: east },
      ],
      '99',
    );
    expect(row.source_key).toBe('county_union:ZZ:fixture-pair');
    // One polygon of one ring, for both the lookup and the display shape.
    expect(row.lookup_wkb?.slice(0, 36)).toBe('010600000001000000010300000001000000');
    expect(row.display_wkb?.slice(0, 36)).toBe('010600000001000000010300000001000000');
    expect(row.outline_svg?.match(/M/g)).toHaveLength(1);
    expect(row.geom_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.geom_hash).not.toBe(lookupProducts(feature('99001', west)).geom_hash);
    expect(row.geom_hash).not.toBe(lookupProducts(feature('99003', east)).geom_hash);
    const [lng, lat] = row.label_point ?? [Number.NaN, Number.NaN];
    expect(lng).toBeGreaterThan(0);
    expect(lng).toBeLessThan(2);
    expect(lat).toBeGreaterThan(0);
    expect(lat).toBeLessThan(1);
  });

  it('a structurally invalid ring is reported', async () => {
    const unclosed: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0.5],
    ];
    expect(structureProblem([[unclosed]])).toBe('an unclosed ring');
    expect(structureProblem([[square(0, 0, 1)]])).toBeNull();
    expect(structureProblem([[square(179.5, 0, 1)]])).toBe('a coordinate out of range');
    expect(structureProblem([])).toBe('no polygon');

    const json = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { GEOID: '99003', NAMELSAD: 'Fixture Open County' },
          geometry: { type: 'Polygon', coordinates: [unclosed] },
        },
        {
          type: 'Feature',
          properties: { GEOID: '99004', NAMELSAD: 'Fixture Closed County' },
          geometry: { type: 'Polygon', coordinates: [square(0, 0, 1)] },
        },
      ],
    };
    const read = featuresFromGeoJson(json, { layer: 'county' });
    expect(read.invalid).toEqual(['99003']);
    expect(read.features.map((f) => f.geoid)).toEqual(['99004']);

    const result = await buildGeometryRows({
      stateFips: '99',
      layers: new Map<LayerId, readonly LayerFeature[]>([
        ['county', [feature('99003', [[unclosed]]), ...read.features]],
      ]),
      mask: [[square(-1, -1, 3)]],
      wanted: new Map([
        ['tiger:county:99003', { layer: 'county', geoid: '99003' }],
        ['tiger:county:99004', { layer: 'county', geoid: '99004' }],
      ]),
    });
    expect(result.checks).toEqual([
      {
        name: 'geometry_valid',
        passed: false,
        detail: '1 wanted features missing or invalid: tiger:county:99003',
      },
    ]);
    expect([...result.rows.keys()]).toEqual(['tiger:county:99004']);
    expect(result.display.get('tiger:county:99003')).toBeNull();
  });

  it('a feature outside the mask keeps an unclipped display geometry', async () => {
    const inside = feature('99001', [[square(0, 0, 1)]]);
    const outside = feature('99002', [[square(50, 50, 1)]]);
    const result = await buildGeometryRows({
      stateFips: '99',
      layers: new Map<LayerId, readonly LayerFeature[]>([['county', [inside, outside]]]),
      mask: [[square(-1, -1, 3)]],
      wanted: new Map([
        ['tiger:county:99001', { layer: 'county', geoid: '99001' }],
        ['tiger:county:99002', { layer: 'county', geoid: '99002' }],
      ]),
    });
    expect(result.unclippedDisplay).toEqual(['tiger:county:99002']);
    expect(result.checks[0]?.passed).toBe(true);
    for (const key of ['tiger:county:99001', 'tiger:county:99002']) {
      const row = result.rows.get(key);
      expect(row?.lookup_wkb).toMatch(/^[0-9a-f]+$/);
      expect(row?.display_wkb).toMatch(/^[0-9a-f]+$/);
      expect(row?.outline_svg).toMatch(PATTERN);
      expect(result.display.get(key)).not.toBeNull();
    }
    const [lng, lat] = result.rows.get('tiger:county:99002')?.label_point ?? [0, 0];
    expect(lng).toBeGreaterThan(50);
    expect(lat).toBeGreaterThan(50);
  });

  it('a label point west of -180 comes back into range', async () => {
    expect(await labelPoint([[square(-190, 50, 2)]])).toEqual([171, 51]);
    expect(await labelPoint([[square(-78.5, 35.5, 1)]])).toEqual([-78, 36]);
  });

  it('shifts only Alaska, and only longitudes east of 0', () => {
    const coords: MultiPolygonCoords = [[square(172, 52, 1)], [square(-170, 52, 1)]];
    expect(shiftForAlaska(coords, '02')).toEqual([[square(-188, 52, 1)], [square(-170, 52, 1)]]);
    expect(shiftForAlaska(coords, '37')).toBe(coords);
  });

  it('a fallback district takes its one via district outline, or the dissolve of several', async () => {
    const west: MultiPolygonCoords = [[square(0, 0, 1)]];
    const east: MultiPolygonCoords = [[square(1, 0, 1)]];
    const viaRow = BGeometrySchema.parse({
      source_key: 'tiger:county:99001',
      lookup_wkb: '00',
      display_wkb: '00',
      label_point: [0.5, 0.5],
      outline_svg: 'M 0 0 L 1 0 L 1 1 Z',
      outline_bbox: [0, 0, 1, 1],
      geom_hash: TWO_SQUARES_HASH,
    });
    expect(await fallbackGeometry([viaRow], [west])).toEqual({
      outline_svg: 'M 0 0 L 1 0 L 1 1 Z',
      outline_bbox: [0, 0, 1, 1],
      label_point: [0.5, 0.5],
    });
    const both = await fallbackGeometry(
      [viaRow, { ...viaRow, source_key: 'tiger:county:99003' }],
      [west, east],
    );
    expect(both.outline_svg?.match(/M/g)).toHaveLength(1);
    expect(both.outline_bbox?.[2]).toBeCloseTo(mercator(2, 0)[0], 1);
    expect(both.label_point?.[0]).toBeGreaterThan(0);
    expect(both.label_point?.[0]).toBeLessThan(2);
  });

  it('reads a zipped layer filtered to the state', async () => {
    const layer = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { STATEFP: '98', GEOID: '98001', NAMELSAD: 'Fixture A County' },
          geometry: { type: 'Polygon', coordinates: [square(0, 0, 1)] },
        },
        {
          type: 'Feature',
          properties: { STATEFP: '99', GEOID: '99001', NAMELSAD: 'Fixture B County' },
          geometry: { type: 'Polygon', coordinates: [square(2, 0, 1)] },
        },
      ],
    };
    const shapefile = await mapshaper.applyCommands(
      '-i layer.json -o tl_fixture.shp format=shapefile',
      { 'layer.json': layer },
    );
    const entries = Object.entries(shapefile).map(([name, data]) => ({
      name,
      data: typeof data === 'string' ? Buffer.from(data, 'utf8') : data,
    }));
    const dir = await mkdtemp(join(tmpdir(), 'geometry-test-'));
    try {
      const zipPath = join(dir, 'tl_fixture.zip');
      await writeFile(
        zipPath,
        storedZip([{ name: 'tl_fixture.shp.iso.xml', data: new Uint8Array() }, ...entries]),
      );
      const filtered = await readLayer(zipPath, 'county', { stateFips: '99' });
      expect(filtered.invalid).toEqual([]);
      expect(filtered.features.map((f) => [f.geoid, f.namelsad, f.properties['STATEFP']])).toEqual([
        ['99001', 'Fixture B County', '99'],
      ]);
      expect(structureProblem(filtered.features[0]?.coords ?? [])).toBeNull();
      const all = await readLayer(zipPath, 'county', { stateFips: null });
      expect(all.features.map((f) => f.geoid)).toEqual(['98001', '99001']);
      await expect(readLayer(zipPath, 'county', { stateFips: "9' || true" })).rejects.toThrow(
        TypeError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('every saved fixture other than a made-up one has its sidecar', async () => {
    const names = await readdir(FIXTURES);
    const saved = names.filter((name) => !name.startsWith('zz-') && !name.endsWith('.meta.json'));
    expect(saved.length).toBeGreaterThan(0);
    for (const name of saved) {
      const sidecar = JSON.parse(
        await readFile(join(FIXTURES, `${name}.meta.json`), 'utf8'),
      ) as Record<string, unknown>;
      expect(Object.keys(sidecar).sort()).toEqual(
        ['contentType', 'fetchedAt', 'originalSha256', 'sha256', 'transformations', 'url'].sort(),
      );
      const bytes = await readFile(join(FIXTURES, name));
      expect(sidecar['sha256']).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });
});
