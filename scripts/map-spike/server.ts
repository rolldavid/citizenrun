import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { assertNever } from '@citizenrun/shared';
import { spriteIndex, spritePng } from './sprite.ts';
import { buildSpikeStyle } from './style.ts';
import { loadFixtureTiles, parseEmptyMode } from './tiles.ts';

// The map spike's local host: its hand-written style, its SDF sprite and its own vector tiles, on
// port 8091 (the end-to-end stack's map fixtures use 8090). Deleted with the map spike screen.

export const MAP_SPIKE_PORT = 8091;

export type SpikeResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array | string | null;
};

const LOCAL_ORIGIN = `http://localhost:${String(MAP_SPIKE_PORT)}`;
const HOST = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;
const TILE = /^\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.pbf$/;
const STYLE = /^\/style-(light|dark)\.json$/;
const SPRITE = /^\/sprite(@2x)?\.(json|png)$/;
const MVT = 'application/vnd.mapbox-vector-tile';
const DEFAULT_DATABASE_URL = 'postgresql://citizenrun:citizenrun@localhost:5432/citizenrun';
const USAGE = 'usage: tsx scripts/map-spike/server.ts [--database-url <url>]';

/** The origin the style's tile and sprite URLs are written with: the one the request came to. */
export function originFromHost(host: string | undefined): string {
  return host !== undefined && HOST.test(host) ? `http://${host}` : LOCAL_ORIGIN;
}

// A mode switch must never meet a cached answer, and every target loads from another origin.
const BASE_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } as const;

function answer(
  status: number,
  contentType: string | null,
  body: Uint8Array | string | null,
): SpikeResponse {
  return {
    status,
    headers: contentType === null ? BASE_HEADERS : { ...BASE_HEADERS, 'Content-Type': contentType },
    body,
  };
}

function notFound(): SpikeResponse {
  return answer(404, 'text/plain', 'not found');
}

function routeGet(
  path: string,
  query: URLSearchParams,
  host: string | undefined,
  tiles: ReadonlyMap<string, Uint8Array>,
): SpikeResponse {
  if (path === '/health') {
    return answer(200, 'text/plain', 'ok');
  }
  const style = STYLE.exec(path);
  if (style !== null) {
    const theme = style[1] === 'dark' ? 'dark' : 'light';
    const built = buildSpikeStyle({
      theme,
      origin: originFromHost(host),
      empty: parseEmptyMode(query.get('empty')),
    });
    return answer(200, 'application/json', JSON.stringify(built));
  }
  const [, z, x, y] = TILE.exec(path) ?? [];
  if (z !== undefined && x !== undefined && y !== undefined) {
    const bytes = tiles.get([Number(z), Number(x), Number(y)].join('/'));
    if (bytes !== undefined) {
      return answer(200, MVT, bytes);
    }
    const empty = parseEmptyMode(query.get('empty'));
    switch (empty) {
      case '204':
        return answer(204, null, null);
      case '200':
        return answer(200, MVT, new Uint8Array(0));
      case '404':
        return notFound();
      default:
        return assertNever(empty);
    }
  }
  const sprite = SPRITE.exec(path);
  if (sprite !== null) {
    const ratio = sprite[1] === '@2x' ? 2 : 1;
    return sprite[2] === 'png'
      ? answer(200, 'image/png', spritePng(ratio))
      : answer(200, 'application/json', JSON.stringify(spriteIndex(ratio)));
  }
  return notFound();
}

/** Answers one request from its method, URL and Host header and the fixture tiles. */
export function routeRequest(input: {
  method: string;
  url: string;
  host: string | undefined;
  tiles: ReadonlyMap<string, Uint8Array>;
}): SpikeResponse {
  const method = input.method.toUpperCase();
  if (method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        ...BASE_HEADERS,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
      body: null,
    };
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return answer(405, 'text/plain', 'method not allowed');
  }
  let url: URL;
  try {
    url = new URL(input.url, LOCAL_ORIGIN);
  } catch {
    return notFound();
  }
  const response = routeGet(url.pathname, url.searchParams, input.host, input.tiles);
  return method === 'HEAD' ? { ...response, body: null } : response;
}

function parseArgs(argv: readonly string[]): { databaseUrl: string } | null {
  let databaseUrl = DEFAULT_DATABASE_URL;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] !== '--database-url' || value === undefined || value.startsWith('--')) {
      return null;
    }
    databaseUrl = value;
    i += 1;
  }
  return { databaseUrl };
}

/** Builds the fixture tiles, then serves until SIGINT or SIGTERM. Returns the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args === null) {
    console.error(USAGE);
    return 2;
  }
  let tiles: Map<string, Uint8Array>;
  try {
    tiles = await loadFixtureTiles(args.databaseUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    const result = routeRequest({
      method: request.method ?? 'GET',
      url,
      host: request.headers.host,
      tiles,
    });
    const headers: Record<string, string> = { ...result.headers };
    if (result.body !== null) {
      headers['Content-Length'] = String(Buffer.byteLength(result.body));
    }
    response.writeHead(result.status, headers);
    response.end(result.body ?? undefined);
    console.log(
      `map-spike ${request.method ?? 'GET'} ${url.split('?')[0] ?? '/'} ${String(result.status)}`,
    );
  });
  return new Promise<number>((resolvePromise) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      server.close(() => {
        resolvePromise(0);
      });
      server.closeAllConnections();
    };
    server.once('error', (error: NodeJS.ErrnoException) => {
      console.error(
        error.code === 'EADDRINUSE'
          ? `map-spike: port ${String(MAP_SPIKE_PORT)} is in use`
          : `map-spike: cannot listen on port ${String(MAP_SPIKE_PORT)} (${error.code ?? 'unknown error'})`,
      );
      resolvePromise(1);
    });
    server.listen(MAP_SPIKE_PORT, '0.0.0.0', () => {
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      console.log(
        `map-spike: serving the spike style, sprite and tiles on port ${String(MAP_SPIKE_PORT)}`,
      );
    });
  });
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
