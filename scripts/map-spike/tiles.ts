import { run } from '../lib/exec.ts';

/** How the spike host answers a tile it has no data for (D-204 rule 8). */
export type EmptyMode = '204' | '200' | '404';

/** '200' and '404' as given; anything else, null included, is '204'. */
export function parseEmptyMode(value: string | null): EmptyMode {
  return value === '200' || value === '404' ? value : '204';
}

/** The one tile at zoom 8 that holds the spike's cells and points. */
export const SPIKE_TILE = { z: 8, x: 71, y: 100 } as const;

/** `z/x/y` of the spike tile and of each of its ancestors, zoom 0 to 8. */
export function fixtureTileKeys(): string[] {
  const keys: string[] = [];
  for (let z = 0; z <= SPIKE_TILE.z; z += 1) {
    const shift = SPIKE_TILE.z - z;
    keys.push([z, SPIKE_TILE.x >> shift, SPIKE_TILE.y >> shift].join('/'));
  }
  return keys;
}

/**
 * One read-only statement: nine square cells and their centre points inside the middle half of the
 * spike tile, encoded as two MVT layers (`cells`, `points`) for each fixture tile, as `z|x|y|hex`.
 * The feature id column becomes the integer feature id and leaves the properties, so `n` repeats
 * it.
 */
export function tileSql(): string {
  return `with base as (select st_tileenvelope(8, 71, 100) as env),
cells as (
  select (r * 3 + c + 1) as id, (r * 3 + c + 1) as n,
    st_makeenvelope(
      st_xmin(env) + (st_xmax(env) - st_xmin(env)) * (0.25 + c / 6.0),
      st_ymin(env) + (st_ymax(env) - st_ymin(env)) * (0.25 + r / 6.0),
      st_xmin(env) + (st_xmax(env) - st_xmin(env)) * (0.24 + (c + 1) / 6.0),
      st_ymin(env) + (st_ymax(env) - st_ymin(env)) * (0.24 + (r + 1) / 6.0),
      3857) as geom
  from base, generate_series(0, 2) as r, generate_series(0, 2) as c
),
points as (select id, n, st_centroid(geom) as geom from cells),
tiles as (select z, 71 >> (8 - z) as x, 100 >> (8 - z) as y from generate_series(0, 8) as z)
select t.z, t.x, t.y, encode(
  coalesce((select st_asmvt(q, 'cells', 4096, 'geom', 'id') from (
    select c.id, c.n, 'Cell ' || c.n as name,
           st_asmvtgeom(c.geom, st_tileenvelope(t.z, t.x, t.y), 4096, 64, true) as geom
    from cells c) q where q.geom is not null), ''::bytea)
  || coalesce((select st_asmvt(p, 'points', 4096, 'geom', 'id') from (
    select pt.id, pt.n, 'Cell ' || pt.n as name,
           st_asmvtgeom(pt.geom, st_tileenvelope(t.z, t.x, t.y), 4096, 64, true) as geom
    from points pt) p where p.geom is not null), ''::bytea),
  'hex')
from tiles t order by t.z`;
}

const ROW = /^(\d+)\|(\d+)\|(\d+)\|([0-9a-f]*)$/;

/** Reads `psql -A -t -F '|'` output, one `z|x|y|hex` row per line, into tile bytes by `z/x/y`. */
export function parseTileRows(stdout: string): Map<string, Uint8Array> {
  const tiles = new Map<string, Uint8Array>();
  const lines = stdout.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') {
      continue;
    }
    const [, z, x, y, hex] = ROW.exec(line.trim()) ?? [];
    if (z === undefined || x === undefined || y === undefined || hex === undefined) {
      throw new Error(`map-spike: unexpected psql output line ${String(index + 1)}`);
    }
    tiles.set(`${z}/${x}/${y}`, new Uint8Array(Buffer.from(hex, 'hex')));
  }
  return tiles;
}

/**
 * Builds the fixture tiles with PostGIS through `psql` (the PostgreSQL 17 client first on PATH) and
 * checks that every fixture tile holds at least one byte.
 */
export async function loadFixtureTiles(databaseUrl: string): Promise<Map<string, Uint8Array>> {
  const fail = (reason: string): Error =>
    new Error(
      `map-spike: cannot build the fixture tiles (${reason}); start the compose stack and run pnpm db:migrate first`,
    );
  let stdout: string;
  try {
    const result = await run('psql', [
      '-X',
      '-A',
      '-t',
      '-F',
      '|',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      databaseUrl,
      '-c',
      tileSql(),
    ]);
    if (result.code !== 0) {
      throw new Error(firstLine(result.stderr) ?? `psql exited with ${String(result.code)}`);
    }
    stdout = result.stdout;
  } catch (error) {
    throw fail(firstLine(error instanceof Error ? error.message : String(error)) ?? 'psql failed');
  }
  let tiles: Map<string, Uint8Array>;
  try {
    tiles = parseTileRows(stdout);
  } catch (error) {
    throw fail(error instanceof Error ? error.message : String(error));
  }
  for (const key of fixtureTileKeys()) {
    const bytes = tiles.get(key);
    if (bytes === undefined || bytes.length === 0) {
      throw fail(`tile ${key} is missing or empty`);
    }
  }
  return tiles;
}

function firstLine(text: string): string | null {
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '');
  return line ?? null;
}
