import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../lib/repo-root.ts';
import { MAP_SPIKE_PORT, originFromHost, routeRequest } from './server.ts';
import type { SpikeResponse } from './server.ts';
import { encodeRgbaPng, spritePng } from './sprite.ts';
import { SPIKE_ANCHORS } from './style.ts';
import { fixtureTileKeys, parseEmptyMode, parseTileRows, tileSql } from './tiles.ts';

const FIXTURE_KEYS = [
  '0/0/0',
  '1/0/0',
  '2/1/1',
  '3/2/3',
  '4/4/6',
  '5/8/12',
  '6/17/25',
  '7/35/50',
  '8/71/100',
];

// Short stand-in bytes for each fixture tile; the server never looks inside them.
const TILES: ReadonlyMap<string, Uint8Array> = new Map(
  FIXTURE_KEYS.map((key, index) => [key, Uint8Array.from([index + 1, 0x1a, 0x2b])]),
);

function get(
  url: string,
  options: { method?: string; host?: string | undefined } = {},
): SpikeResponse {
  return routeRequest({
    method: options.method ?? 'GET',
    url,
    host: 'host' in options ? options.host : 'localhost:8091',
    tiles: TILES,
  });
}

function json(response: SpikeResponse): unknown {
  if (typeof response.body !== 'string') {
    throw new Error('expected a text body');
  }
  return JSON.parse(response.body);
}

type StyleShape = {
  name: string;
  glyphs: string;
  sprite: string;
  sources: { spike: { tiles: string[] }; openmaptiles: { url: string } };
  layers: { id: string }[];
};

type Chunk = { type: string; data: Buffer; crc: number };

function chunks(png: Uint8Array): Chunk[] {
  const buffer = Buffer.from(png);
  const out: Chunk[] = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const crc = buffer.readUInt32BE(offset + 8 + length);
    out.push({ type, data, crc });
    offset += 12 + length;
  }
  return out;
}

describe('the map spike tiles', () => {
  it('the fixture tiles are the nine ancestors of 8/71/100', () => {
    expect(fixtureTileKeys()).toEqual(FIXTURE_KEYS);
  });

  it('the tile statement makes two layers with integer ids', () => {
    const sql = tileSql();
    expect(sql).toContain('st_tileenvelope(8, 71, 100)');
    expect(sql).toContain("'cells', 4096, 'geom', 'id'");
    expect(sql).toContain("'points', 4096, 'geom', 'id'");
    expect(sql).not.toMatch(/\b(insert|update|delete|create|drop)\b/i);
  });

  it('psql rows are parsed', () => {
    const tiles = parseTileRows('8|71|100|0a0b\n\n0|0|0|ff\n');
    expect([...(tiles.get('8/71/100') ?? [])]).toEqual([10, 11]);
    expect([...(tiles.get('0/0/0') ?? [])]).toEqual([255]);
    expect(tiles.size).toBe(2);
    expect(() => parseTileRows('8|71')).toThrow('map-spike: unexpected psql output line 1');
    expect(() => parseTileRows('0|0|0|ff\n8|71|zz|00')).toThrow(
      'map-spike: unexpected psql output line 2',
    );
  });

  it('the empty mode defaults to 204', () => {
    expect(parseEmptyMode(null)).toBe('204');
    expect(parseEmptyMode('x')).toBe('204');
    expect(parseEmptyMode('204')).toBe('204');
    expect(parseEmptyMode('200')).toBe('200');
    expect(parseEmptyMode('404')).toBe('404');
  });
});

describe('the map spike host', () => {
  it('a fixture tile is served', () => {
    const response = get('/tiles/8/71/100.pbf');
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/vnd.mapbox-vector-tile');
    expect(response.body).toBe(TILES.get('8/71/100'));
    expect(get('/tiles/0/0/0.pbf?empty=404').body).toBe(TILES.get('0/0/0'));
  });

  it('an empty tile answers by mode', () => {
    const noContent = get('/tiles/8/70/100.pbf?empty=204');
    expect(noContent.status).toBe(204);
    expect(noContent.body).toBeNull();
    expect(get('/tiles/8/70/100.pbf').status).toBe(204);
    const empty = get('/tiles/8/70/100.pbf?empty=200');
    expect(empty.status).toBe(200);
    expect(empty.headers['Content-Type']).toBe('application/vnd.mapbox-vector-tile');
    expect(empty.body).toBeInstanceOf(Uint8Array);
    expect((empty.body as Uint8Array).length).toBe(0); // checked to be a Uint8Array on the line above
    const missing = get('/tiles/8/70/100.pbf?empty=404');
    expect(missing.status).toBe(404);
    expect(missing.headers['Content-Type']).toBe('text/plain');
    expect(missing.body).toBe('not found');
  });

  it('bad tile coordinates are not found', () => {
    expect(get('/tiles/a/1/2.pbf').status).toBe(404);
    expect(get('/tiles/1/2/3.png').status).toBe(404);
    expect(get('/tiles/123/2/3.pbf').status).toBe(404);
    expect(get('/tiles/1/2/3.pbf/extra').status).toBe(404);
  });

  it("the style carries the request's origin and mode", () => {
    const response = get('/style-dark.json?empty=404', { host: '192.168.1.5:8091' });
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/json');
    const style = json(response) as StyleShape; // the host writes this shape; the expectations check it
    expect(style.name).toBe('spike-dark');
    expect(style.sources.spike.tiles[0]).toBe(
      'http://192.168.1.5:8091/tiles/{z}/{x}/{y}.pbf?empty=404',
    );
    expect(style.sprite).toBe('http://192.168.1.5:8091/sprite');
    expect(style.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
    expect(style.sources.openmaptiles.url).toBe('https://tiles.openfreemap.org/planet');
    const light = json(get('/style-light.json')) as StyleShape; // as above
    expect(light.name).toBe('spike-light');
    expect(light.sources.spike.tiles[0]).toBe(
      'http://localhost:8091/tiles/{z}/{x}/{y}.pbf?empty=204',
    );
  });

  it('the anchors are in order', () => {
    for (const theme of ['light', 'dark']) {
      const style = json(get(`/style-${theme}.json`)) as StyleShape; // the host writes this shape
      const ids = style.layers.map((layer) => layer.id);
      const anchors: readonly string[] = SPIKE_ANCHORS;
      // The base layers sit between the anchors; only the anchors' own order is fixed.
      expect(ids.filter((id) => anchors.includes(id))).toEqual([...SPIKE_ANCHORS]);
      expect(SPIKE_ANCHORS).toEqual(['anchor-fill', 'anchor-line', 'anchor-top']);
    }
  });

  it('a bad host header falls back', () => {
    const style = json(get('/style-light.json', { host: 'evil"host' })) as StyleShape; // as above
    expect(style.sprite).toBe('http://localhost:8091/sprite');
    expect(style.sources.spike.tiles[0]).toBe(
      'http://localhost:8091/tiles/{z}/{x}/{y}.pbf?empty=204',
    );
    expect(originFromHost(undefined)).toBe('http://localhost:8091');
    expect(originFromHost('10.0.2.2:8091')).toBe('http://10.0.2.2:8091');
    expect(originFromHost('host/path')).toBe('http://localhost:8091');
  });

  it('the sprite is one SDF box', () => {
    const response = get('/sprite@2x.json');
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/json');
    expect(json(response)).toEqual({
      'map-box': { x: 0, y: 0, width: 48, height: 48, pixelRatio: 2, sdf: true },
    });
    expect(json(get('/sprite.json'))).toEqual({
      'map-box': { x: 0, y: 0, width: 24, height: 24, pixelRatio: 1, sdf: true },
    });
    const image = get('/sprite@2x.png');
    expect(image.status).toBe(200);
    expect(image.headers['Content-Type']).toBe('image/png');
    expect(image.body).toEqual(spritePng(2));
  });

  it('serves its health and nothing else', () => {
    const health = get('/health');
    expect(health.status).toBe(200);
    expect(health.headers['Content-Type']).toBe('text/plain');
    expect(health.body).toBe('ok');
    expect(get('/style-blue.json').status).toBe(404);
    expect(get('/').status).toBe(404);
  });

  it('preflight and other methods', () => {
    const preflight = get('/style-light.json', { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.body).toBeNull();
    expect(preflight.headers['Access-Control-Allow-Methods']).toBe('GET, HEAD, OPTIONS');
    expect(preflight.headers['Access-Control-Allow-Headers']).toBe('*');
    expect(get('/health', { method: 'POST' }).status).toBe(405);
    const head = get('/health', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers['Content-Type']).toBe('text/plain');
    expect(head.body).toBeNull();
    expect(get('/tiles/8/71/100.pbf', { method: 'HEAD' }).body).toBeNull();
  });

  it('every answer allows any origin and is not cached', () => {
    const requests: [string, string][] = [
      ['GET', '/health'],
      ['HEAD', '/health'],
      ['POST', '/health'],
      ['OPTIONS', '/style-light.json'],
      ['GET', '/style-light.json'],
      ['GET', '/style-dark.json?empty=200'],
      ['GET', '/tiles/8/71/100.pbf'],
      ['GET', '/tiles/8/70/100.pbf?empty=204'],
      ['GET', '/tiles/8/70/100.pbf?empty=200'],
      ['GET', '/tiles/8/70/100.pbf?empty=404'],
      ['GET', '/tiles/a/1/2.pbf'],
      ['GET', '/sprite.json'],
      ['GET', '/sprite@2x.json'],
      ['GET', '/sprite.png'],
      ['GET', '/sprite@2x.png'],
      ['GET', '/nothing-here'],
    ];
    for (const [method, url] of requests) {
      const response = get(url, { method });
      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Cache-Control']).toBe('no-store');
    }
  });

  it('the app and the server agree on the port', () => {
    expect(MAP_SPIKE_PORT).toBe(8091);
    const appFile = readFileSync(
      join(repoRoot(), 'apps', 'mobile', 'src', 'features', 'dev', 'screens', 'spike-server.ts'),
      'utf8',
    );
    expect(appFile).toContain('MAP_SPIKE_PORT = 8091');
  });
});

describe('the map spike sprite image', () => {
  it('the sprite image is a valid PNG', () => {
    const png = spritePng(1);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parts = chunks(png);
    expect(parts.map((part) => part.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const part of parts) {
      expect(part.crc).toBe(crc32(Buffer.concat([Buffer.from(part.type, 'latin1'), part.data])));
    }
    const header = parts[0]?.data;
    expect(header?.readUInt32BE(0)).toBe(24);
    expect(header?.readUInt32BE(4)).toBe(24);
    expect(header?.[8]).toBe(8);
    expect(header?.[9]).toBe(6);
    expect(parts[2]?.data.length).toBe(0);
    const rows = inflateSync(parts[1]?.data ?? Buffer.alloc(0));
    expect(rows.length).toBe(24 * 97);
    for (let row = 0; row < 24; row += 1) {
      const line = rows.subarray(row * 97, (row + 1) * 97);
      expect(line[0]).toBe(0);
      expect(line.subarray(1).every((byte) => byte === 255)).toBe(true);
    }
  });

  it('the double-size image is 48 by 48', () => {
    const header = chunks(spritePng(2))[0]?.data;
    expect(header?.readUInt32BE(0)).toBe(48);
    expect(header?.readUInt32BE(4)).toBe(48);
  });

  it('a wrong buffer length is refused', () => {
    expect(() => encodeRgbaPng(2, 2, new Uint8Array(15))).toThrow();
    expect(() => encodeRgbaPng(2, 2, new Uint8Array(17))).toThrow();
    expect(encodeRgbaPng(2, 2, new Uint8Array(16)).length).toBeGreaterThan(8);
  });
});
