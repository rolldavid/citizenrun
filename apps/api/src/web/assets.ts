import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';
import { buildShellCsp, cspInputs, shellCspHeaderName } from '../config/csp.ts';
import type { Deps } from '../deps.ts';
import { parseShellTemplate } from './shell.ts';
import type { ShellTemplate } from './shell.ts';

/** One file of the export held compressed in memory (E-WEB-04). */
export type CompressedFile = {
  contentType: string;
  cacheControl: string;
  gzip: Uint8Array<ArrayBuffer>;
  br: Uint8Array<ArrayBuffer>;
};

/** The web export as the API serves it, read once per dependencies object (D-163). */
export type WebAssets = {
  shell: ShellTemplate;
  csp: { header: string; value: string };
  root: string;
  compressed: ReadonlyMap<string, CompressedFile>;
};

/** The cache header of an immutable file: one under `_expo/static/` or `fonts/`, or a hashed name. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'; // E-WEB-04
/** The cache header of every other file of the export. */
export const HOUR_CACHE_CONTROL = 'public, max-age=3600'; // E-WEB-04

const IMMUTABLE_PREFIXES: readonly string[] = ['/_expo/static/', '/fonts/'];
// A content hash: 8 or more hex characters between `.` or `-` and the extension (E-WEB-04).
const CONTENT_HASH_NAME = /[.-][0-9a-fA-F]{8,}\.[A-Za-z0-9]+$/;
const INDEX_FILE = 'index.html';
const GZIP_LEVEL = 9; // E-WEB-04
const BROTLI_QUALITY = 9; // E-WEB-04
// The extensions held compressed in memory, with the Content-Type each is served with.
const COMPRESSED_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml; charset=utf-8',
};

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/** The `Cache-Control` of a file of the export, by its URL path (E-WEB-04). */
export function cacheControlFor(urlPath: string): string {
  if (IMMUTABLE_PREFIXES.some((prefix) => urlPath.startsWith(prefix))) {
    return IMMUTABLE_CACHE_CONTROL;
  }
  const name = urlPath.slice(urlPath.lastIndexOf('/') + 1);
  return CONTENT_HASH_NAME.test(name) ? IMMUTABLE_CACHE_CONTROL : HOUR_CACHE_CONTROL;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function toUrlPath(root: string, file: string): string {
  return `/${relative(root, file).split(sep).join('/')}`;
}

async function compressFile(file: string, urlPath: string): Promise<CompressedFile | null> {
  const contentType = COMPRESSED_TYPES[extname(file).toLowerCase()];
  if (contentType === undefined) {
    return null;
  }
  const bytes = await readFile(file);
  const [gzipped, brotli] = await Promise.all([
    gzipAsync(bytes, { level: GZIP_LEVEL }),
    brotliAsync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }),
  ]);
  return {
    contentType,
    cacheControl: cacheControlFor(urlPath),
    gzip: new Uint8Array(gzipped),
    br: new Uint8Array(brotli),
  };
}

// Every regular .js, .css, .json and .svg file under the export, keyed by its URL path.
async function compressExport(root: string): Promise<ReadonlyMap<string, CompressedFile>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const compressed = new Map<string, CompressedFile>();
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const file = join(entry.parentPath, entry.name);
    const urlPath = toUrlPath(root, file);
    if (urlPath === `/${INDEX_FILE}`) {
      continue;
    }
    const copy = await compressFile(file, urlPath);
    if (copy !== null) {
      compressed.set(urlPath, copy);
    }
  }
  return compressed;
}

async function loadWebAssets(deps: Pick<Deps, 'env' | 'logger'>): Promise<WebAssets | null> {
  const root = deps.env.WEB_DIST_DIR;
  let indexHtml: string;
  try {
    indexHtml = await readFile(join(root, INDEX_FILE), 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      // Local development serves the web from the Expo dev server, so the API runs without it.
      deps.logger.warn('web.export_missing');
      return null;
    }
    throw error;
  }
  const shell = parseShellTemplate(indexHtml);
  const csp = { header: shellCspHeaderName(), value: buildShellCsp(cspInputs(deps.env, shell)) };
  const compressed = await compressExport(root);
  return { shell, csp, root, compressed };
}

// One read of the export per dependencies object (each app, each replica), made on first use.
const assetsByDeps = new WeakMap<object, Promise<WebAssets | null>>();

/**
 * The web export of these dependencies, read once (D-163): the parsed shell and its policy, and a
 * gzip and a Brotli copy of every compressible file. Resolves null, after one `web.export_missing`
 * line, when `<WEB_DIST_DIR>/index.html` does not exist; rejects with `WebShellInvalidError` when
 * the template is invalid.
 */
export function webAssetsFor(deps: Pick<Deps, 'env' | 'logger'>): Promise<WebAssets | null> {
  let assets = assetsByDeps.get(deps);
  if (assets === undefined) {
    assets = loadWebAssets(deps);
    assetsByDeps.set(deps, assets);
  }
  return assets;
}
