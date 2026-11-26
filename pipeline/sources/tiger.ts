// TIGER/Line 2026 layers and the cartographic land-mask file (D-208, D-209). Files are found by
// listing each layer's directory, downloaded through the fetcher into `datasets/tiger/2026/`, and
// their attribute tables read from the `.dbf` alone.
import { readFile } from 'node:fs/promises';
import mapshaper from 'mapshaper';
import type { RunContext } from '../lib/runner.ts';
import { listZip, openZipEntry } from '../lib/zip.ts';
import {
  DatasetUnavailableError,
  DirectoryPageError,
  datasetTempFile,
  fetchDirectoryLinks,
  readEditionRecord,
  requireDatasetFile,
} from './dataset.ts';

export const SOURCE_IDS = ['tiger', 'cb-state'] as const;

export const TIGER_DATASET = 'tiger';
export const TIGER_EDITION = '2026';
export const TIGER_ROOT = 'https://www2.census.gov/geo/tiger/TIGER2026/';

/** The thirteen layers stage 1 reads (D-209); `token` is the layer's part of the file name. */
export const TIGER_LAYERS = [
  { dir: 'STATE', token: 'state' },
  { dir: 'COUNTY', token: 'county' },
  { dir: 'PLACE', token: 'place' },
  { dir: 'COUSUB', token: 'cousub' },
  { dir: 'CD', token: 'cd120' },
  { dir: 'SLDU', token: 'sldu' },
  { dir: 'SLDL', token: 'sldl' },
  { dir: 'UNSD', token: 'unsd' },
  { dir: 'ELSD', token: 'elsd' },
  { dir: 'SCSD', token: 'scsd' },
  { dir: 'CONCITY', token: 'concity' },
  { dir: 'ZCTA520', token: 'zcta520' },
  { dir: 'TABBLOCK20', token: 'tabblock20' },
] as const;
export type TigerLayer = (typeof TIGER_LAYERS)[number];

/** The layers whose national or state files are larger than the fetcher's default limit. */
const LARGE_LAYERS: ReadonlySet<string> = new Set(['zcta520', 'tabblock20']);
const LARGE_MAX_BYTES = 2_000_000_000;

/** The corrected 120th Congress files were posted on this date; an older copy is fetched again (D-209). */
export const CD120_CORRECTED_ON = '2026-11-10';

export const CB_STATE_DATASET = 'cb-state';
export const CB_STATE_EDITION = '2025';
export const CB_STATE_URL =
  'https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_500k.zip';
const CB_STATE_FILE = 'cb_2025_us_state_500k.zip';

/** A layer file name's scope (`us` or a two-digit state FIPS code), or null for another file. */
export function matchLayerFile(fileName: string, token: string): { scope: string } | null {
  if (!/^[a-z0-9]+$/.test(token)) {
    return null;
  }
  const match = new RegExp(`^tl_2026_(\\d{2}|us)_${token}\\.zip$`).exec(fileName);
  return match?.[1] === undefined ? null : { scope: match[1] };
}

function layerByDir(dir: string): TigerLayer {
  const layer = TIGER_LAYERS.find((entry) => entry.dir === dir);
  if (layer === undefined) {
    throw new TypeError(`not a TIGER layer directory: ${dir}`);
  }
  return layer;
}

const listings = new WeakMap<RunContext, Map<string, readonly { name: string; scope: string }[]>>();

/** The layer files a TIGER layer directory lists, sorted by name; read once per run. */
export async function listLayer(
  ctx: RunContext,
  dir: string,
): Promise<readonly { name: string; scope: string }[]> {
  const layer = layerByDir(dir);
  let perRun = listings.get(ctx);
  if (perRun === undefined) {
    perRun = new Map();
    listings.set(ctx, perRun);
  }
  const known = perRun.get(dir);
  if (known !== undefined) {
    return known;
  }
  const files: { name: string; scope: string }[] = [];
  for (const name of await fetchDirectoryLinks(ctx, `${TIGER_ROOT}${layer.dir}/`)) {
    const match = matchLayerFile(name, layer.token);
    if (match !== null) {
      files.push({ name, scope: match.scope });
    }
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  perRun.set(dir, files);
  return files;
}

/**
 * The bucket key of a layer's file for `scope` (`us` or a state FIPS code), downloaded or confirmed
 * unchanged through the fetcher; null when the directory lists no file for that scope (ELSD,
 * SCSD and CONCITY cover only some states; Nebraska and DC have no SLDL). When the directory page
 * cannot be read, the file the edition record already lists is used.
 */
export async function ensureLayerFile(
  ctx: RunContext,
  layer: TigerLayer,
  scope: string,
): Promise<string | null> {
  const name = `tl_2026_${scope}_${layer.token}.zip`;
  if (matchLayerFile(name, layer.token) === null) {
    throw new TypeError(`not a layer file scope: ${scope}`);
  }
  const record = await readEditionRecord(ctx, TIGER_DATASET, TIGER_EDITION);
  try {
    const listed = await listLayer(ctx, layer.dir);
    if (!listed.some((file) => file.name === name)) {
      return null;
    }
  } catch (error) {
    if (!(error instanceof DirectoryPageError)) {
      throw error;
    }
    if (record?.files.some((file) => file.name === name) !== true) {
      throw new DatasetUnavailableError(TIGER_DATASET, error.reason);
    }
  }
  const stale =
    layer.token === 'cd120' && record !== null && record.downloaded_on < CD120_CORRECTED_ON;
  return requireDatasetFile(ctx, {
    dataset: TIGER_DATASET,
    edition: TIGER_EDITION,
    url: `${TIGER_ROOT}${layer.dir}/${name}`,
    file: name,
    sourceUrl: TIGER_ROOT,
    expectContentType: /^application\/(zip|x-zip-compressed|octet-stream)\b/i,
    ...(LARGE_LAYERS.has(layer.token) ? { maxBytes: LARGE_MAX_BYTES } : {}),
    ...(stale ? { unconditional: true } : {}),
  });
}

/** The land-mask file (`cb_2025_us_state_500k.zip`, D-208). */
export function ensureMaskFile(ctx: RunContext): Promise<string> {
  return requireDatasetFile(ctx, {
    dataset: CB_STATE_DATASET,
    edition: CB_STATE_EDITION,
    url: CB_STATE_URL,
    file: CB_STATE_FILE,
    expectContentType: /^application\/(zip|x-zip-compressed|octet-stream)\b/i,
  });
}

/** A layer file that is not a readable zip holding one `.dbf` table. */
export class TigerFormatError extends Error {
  override readonly name = 'TigerFormatError';
}

export type DbfRow = Readonly<Record<string, string | number | null>>;

async function entryBytes(path: string, name: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await openZipEntry(path, name)) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Reads a `.dbf` table's rows with mapshaper; `fields` keeps only those columns. */
export async function readDbfBytes(
  dbf: Uint8Array,
  fields?: readonly string[],
): Promise<readonly DbfRow[]> {
  if (fields !== undefined && fields.some((field) => !/^[A-Za-z0-9_]+$/.test(field))) {
    throw new TypeError('a dbf field name holds only letters, digits and underscores');
  }
  const filter =
    fields === undefined || fields.length === 0 ? '' : ` -filter-fields ${fields.join(',')}`;
  let output: Record<string, Uint8Array | string>;
  try {
    output = await mapshaper.applyCommands(
      `-i in.dbf encoding=utf8${filter} -o out.json format=json`,
      { 'in.dbf': dbf },
    );
  } catch (error) {
    throw new TigerFormatError(
      `the attribute table could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  const out = output['out.json'];
  if (out === undefined) {
    throw new TigerFormatError('the attribute table gave no rows');
  }
  const parsed: unknown = JSON.parse(
    typeof out === 'string' ? out : Buffer.from(out).toString('utf8'),
  );
  if (!Array.isArray(parsed)) {
    throw new TigerFormatError('the attribute table gave no rows');
  }
  return parsed as DbfRow[];
}

/**
 * The attribute rows of the layer zip at `zipKey`: the zip is copied to a temporary file, its one
 * `.dbf` member is read (the `.shp` is never extracted), and `fields` keeps only those columns.
 * A zip that cannot be opened or holds no `.dbf` throws TigerFormatError.
 */
export async function readDbf(
  zipKey: string,
  ctx: RunContext,
  fields?: readonly string[],
): Promise<readonly DbfRow[]> {
  const temp = await datasetTempFile(ctx, zipKey, '.zip');
  try {
    let entries;
    try {
      entries = await listZip(temp.path);
    } catch (error) {
      throw new TigerFormatError(
        `the layer file is not a readable zip: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    const dbf = entries.filter((entry) => entry.name.toLowerCase().endsWith('.dbf'));
    if (dbf.length !== 1 || dbf[0] === undefined) {
      throw new TigerFormatError('the layer file does not hold exactly one .dbf table');
    }
    return await readDbfBytes(await entryBytes(temp.path, dbf[0].name), fields);
  } finally {
    await temp.remove();
  }
}

/** Reads a `.dbf` file from disk (saved samples and scratch tools). */
export async function readDbfFile(
  path: string,
  fields?: readonly string[],
): Promise<readonly DbfRow[]> {
  return readDbfBytes(await readFile(path), fields);
}
