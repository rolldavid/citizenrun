// 2020 Census Redistricting Data (P.L. 94-171), legacy format (D-312): block counts of P1 (total
// population) and P3 (18 and over), joined to the TIGER 2020 block internal points.
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { RunContext } from '../lib/runner.ts';
import { stateByCode } from '../lib/states.ts';
import { listZip, openZipEntry } from '../lib/zip.ts';
import {
  datasetTempFile,
  fetchDirectoryLinks,
  requireDatasetFile,
  writeDatasetRows,
} from './dataset.ts';
import { TIGER_LAYERS, ensureLayerFile, readDbf } from './tiger.ts';
import type { DbfRow } from './tiger.ts';

export const SOURCE_IDS = ['pl94171'] as const;

export const PL_DATASET = 'pl94171';
export const PL_EDITION = '2020';
/**
 * The redistricting bulk directory, as data/sources.yaml records it. The host refuses the path with
 * its two hyphens written plainly, so they are written `%2D%2D`.
 */
export const PL_ROOT =
  'https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File%2D%2DPL_94-171/';
/** The field list these positions come from. */
export const PL_TECH_DOC =
  'https://www2.census.gov/programs-surveys/decennial/2020/technical-documentation/complete-tech-docs/summary-file/2020Census_PL94_171Redistricting_StatesTechDoc_English.pdf';

/**
 * Zero-based field positions of the pipe-delimited legacy files (the technical documentation's
 * Figure 2-4 for the geographic header; each data segment opens with FILEID, STUSAB, CHARITER,
 * CIFSN and LOGRECNO, then its cells in table order: P0010001 opens segment 1, P0030001 segment 2).
 */
export type PlFields = {
  readonly geo: {
    readonly sumlev: number;
    readonly geocomp: number;
    readonly logrecno: number;
    readonly state: number;
    readonly county: number;
    readonly tract: number;
    readonly block: number;
  };
  readonly seg1: { readonly logrecno: number; readonly p1: number };
  readonly seg2: { readonly logrecno: number; readonly p3: number };
};
export const PL_FIELDS: PlFields = Object.freeze({
  geo: Object.freeze({
    sumlev: 2,
    geocomp: 4,
    logrecno: 7,
    state: 12,
    county: 14,
    tract: 32,
    block: 34,
  }),
  seg1: Object.freeze({ logrecno: 4, p1: 5 }),
  seg2: Object.freeze({ logrecno: 4, p3: 5 }),
});

/** A state zip that lacks a file, a field that is not of its form, or a block one file lacks. */
export class PlFormatError extends Error {
  override readonly name = 'PlFormatError';
}

/** The block sums disagree with the state's summary-level 040 line. */
export class PlTotalsError extends Error {
  override readonly name = 'PlTotalsError';
}

/** A block present in the P.L. file and not in the TIGER block table, or the other way round. */
export class PlJoinError extends Error {
  override readonly name = 'PlJoinError';
}

export type PlBlock = { geoid: string; p1: number; p3: number };
export type BlockTableRow = { geoid: string; p1: number; p3: number; lng: number; lat: number };

export const BlockTableRowSchema = z.strictObject({
  geoid: z.string().regex(/^\d{15}$/),
  p1: z.int().min(0),
  p3: z.int().min(0),
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

type ZipFiles = { geo: string; seg1: string; seg2: string };

async function zipFiles(zipPath: string): Promise<ZipFiles> {
  const names = (await listZip(zipPath)).map((entry) => entry.name);
  const find = (pattern: RegExp, what: string): string => {
    const found = names.filter((name) => pattern.test(name));
    if (found.length !== 1 || found[0] === undefined) {
      throw new PlFormatError(`the P.L. 94-171 zip does not hold one ${what} file`);
    }
    return found[0];
  };
  return {
    geo: find(/^[a-z]{2}geo2020\.pl$/, 'geographic header'),
    seg1: find(/^[a-z]{2}000012020\.pl$/, 'segment 1'),
    seg2: find(/^[a-z]{2}000022020\.pl$/, 'segment 2'),
  };
}

/** The pipe-delimited lines of one member of the zip, split into fields. */
async function* lines(
  zipPath: string,
  name: string,
  encoding: 'latin1' | 'utf8',
): AsyncIterable<{ line: number; fields: readonly string[] }> {
  const entry = await openZipEntry(zipPath, name);
  entry.setEncoding(encoding);
  const reader = createInterface({ input: entry, crlfDelay: Infinity });
  let line = 0;
  try {
    for await (const text of reader) {
      line += 1;
      if (text === '') continue;
      yield { line, fields: text.split('|') };
    }
  } finally {
    reader.close();
    entry.destroy();
  }
}

function field(fields: readonly string[], index: number, line: number, what: string): string {
  const value = fields[index];
  if (value === undefined) {
    throw new PlFormatError(`line ${String(line)} has no ${what} field`);
  }
  return value;
}

function countField(fields: readonly string[], index: number, line: number, what: string): number {
  const value = field(fields, index, line, what);
  if (!/^\d+$/.test(value)) {
    throw new PlFormatError(`line ${String(line)}: ${what} is not a count`);
  }
  return Number.parseInt(value, 10);
}

type GeoLine = { logrecno: string; geoid: string };

/** The geographic header's lines of one summary level (whole geography, component 00). */
async function geoLines(
  zipPath: string,
  name: string,
  sumlev: string,
  fields: PlFields,
): Promise<GeoLine[]> {
  const out: GeoLine[] = [];
  for await (const { line, fields: f } of lines(zipPath, name, 'latin1')) {
    if (field(f, fields.geo.sumlev, line, 'SUMLEV') !== sumlev) continue;
    if (field(f, fields.geo.geocomp, line, 'GEOCOMP') !== '00') continue;
    const logrecno = field(f, fields.geo.logrecno, line, 'LOGRECNO');
    let geoid = field(f, fields.geo.state, line, 'STATE');
    if (sumlev === '750') {
      geoid +=
        field(f, fields.geo.county, line, 'COUNTY') +
        field(f, fields.geo.tract, line, 'TRACT') +
        field(f, fields.geo.block, line, 'BLOCK');
    }
    if (
      !/^\d{7}$/.test(logrecno) ||
      !/^\d+$/.test(geoid) ||
      (sumlev === '750' && geoid.length !== 15)
    ) {
      throw new PlFormatError(`line ${String(line)}: the geographic codes are not of their form`);
    }
    out.push({ logrecno, geoid });
  }
  return out;
}

/** One count per wanted LOGRECNO from a data segment. */
async function segmentCounts(
  zipPath: string,
  name: string,
  wanted: ReadonlySet<string>,
  at: { logrecno: number; value: number },
  what: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for await (const { line, fields } of lines(zipPath, name, 'utf8')) {
    const logrecno = field(fields, at.logrecno, line, 'LOGRECNO');
    if (wanted.has(logrecno)) {
      out.set(logrecno, countField(fields, at.value, line, what));
    }
  }
  return out;
}

async function joinSegments(zipPath: string, sumlev: string, fields: PlFields): Promise<PlBlock[]> {
  const files = await zipFiles(zipPath);
  const geo = await geoLines(zipPath, files.geo, sumlev, fields);
  const wanted = new Set(geo.map((row) => row.logrecno));
  const p1 = await segmentCounts(
    zipPath,
    files.seg1,
    wanted,
    { logrecno: fields.seg1.logrecno, value: fields.seg1.p1 },
    'P0010001',
  );
  const p3 = await segmentCounts(
    zipPath,
    files.seg2,
    wanted,
    { logrecno: fields.seg2.logrecno, value: fields.seg2.p3 },
    'P0030001',
  );
  return geo.map((row) => {
    const total = p1.get(row.logrecno);
    const adults = p3.get(row.logrecno);
    if (total === undefined || adults === undefined) {
      throw new PlFormatError(
        `LOGRECNO ${row.logrecno} has no line in ${total === undefined ? 'segment 1' : 'segment 2'}`,
      );
    }
    return { geoid: row.geoid, p1: total, p3: adults };
  });
}

/**
 * The blocks (summary level 750) of a state's legacy-format zip: the geographic header joined to
 * segment 1 (P0010001) and segment 2 (P0030001) by LOGRECNO; `geoid` is the state, county, tract
 * and block codes (15 digits). `fields` exists for tests that misread a position on purpose.
 */
export async function* readPlBlocks(
  zipPath: string,
  fields: PlFields = PL_FIELDS,
): AsyncIterable<PlBlock> {
  yield* await joinSegments(zipPath, '750', fields);
}

/** The state's own totals, from its summary-level 040 line. */
export async function plStateTotals(
  zipPath: string,
  fields: PlFields = PL_FIELDS,
): Promise<{ p1: number; p3: number }> {
  const rows = await joinSegments(zipPath, '040', fields);
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new PlFormatError(`the zip holds ${String(rows.length)} state lines, not one`);
  }
  return { p1: rows[0].p1, p3: rows[0].p3 };
}

function coordinate(
  value: string | number | null | undefined,
  min: number,
  max: number,
): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/**
 * Joins the P.L. blocks to the TIGER block internal points (`GEOID20`, `INTPTLAT20`,
 * `INTPTLON20`), sorted by `geoid`. A block in one table and not the other throws PlJoinError;
 * block sums that differ from the 040 line throw PlTotalsError, so a misread field fails here and
 * not silently in a district's population.
 */
export function joinBlockPoints(
  blocks: Iterable<PlBlock>,
  points: readonly DbfRow[],
  totals: { p1: number; p3: number },
): BlockTableRow[] {
  const located = new Map<string, { lng: number; lat: number }>();
  for (const point of points) {
    const geoid = point['GEOID20'];
    const lat = coordinate(point['INTPTLAT20'], -90, 90);
    const lng = coordinate(point['INTPTLON20'], -180, 180);
    if (typeof geoid !== 'string' || !/^\d{15}$/.test(geoid) || lat === null || lng === null) {
      throw new PlJoinError('a TIGER block row has no readable GEOID20 or internal point');
    }
    located.set(geoid, { lng, lat });
  }
  const rows: BlockTableRow[] = [];
  let p1 = 0;
  let p3 = 0;
  const seen = new Set<string>();
  for (const block of blocks) {
    const point = located.get(block.geoid);
    if (point === undefined) {
      throw new PlJoinError(
        `block ${block.geoid} is in the P.L. file and not in the TIGER block table`,
      );
    }
    seen.add(block.geoid);
    p1 += block.p1;
    p3 += block.p3;
    rows.push({ geoid: block.geoid, p1: block.p1, p3: block.p3, lng: point.lng, lat: point.lat });
  }
  for (const geoid of located.keys()) {
    if (!seen.has(geoid)) {
      throw new PlJoinError(`block ${geoid} is in the TIGER block table and not in the P.L. file`);
    }
  }
  if (p1 !== totals.p1 || p3 !== totals.p3) {
    throw new PlTotalsError(
      `block sums P1 ${String(p1)} and P3 ${String(p3)} differ from the state line's ${String(totals.p1)} and ${String(totals.p3)}`,
    );
  }
  rows.sort((a, b) => (a.geoid < b.geoid ? -1 : a.geoid > b.geoid ? 1 : 0));
  return rows;
}

/** The state's folder name in the redistricting directory, such as `District_of_Columbia/`. */
export function plStateFolder(state: string): string {
  return `${stateByCode(state).name.replaceAll(' ', '_')}/`;
}

/** Downloads (or confirms) the state's legacy-format zip, found by listing the state's folder. */
export async function ensurePlZip(ctx: RunContext, state: string): Promise<string> {
  const folder = `${PL_ROOT}${plStateFolder(state)}`;
  const file = `${state.toLowerCase()}2020.pl.zip`;
  const links = await fetchDirectoryLinks(ctx, folder);
  if (!links.includes(file)) {
    throw new PlFormatError(`the state folder does not list ${file}`);
  }
  return requireDatasetFile(ctx, {
    dataset: PL_DATASET,
    edition: PL_EDITION,
    url: `${folder}${file}`,
    file,
    sourceUrl: PL_ROOT,
    expectContentType: /^application\/(zip|x-zip-compressed|octet-stream)\b/i,
  });
}

const TABBLOCK20 = TIGER_LAYERS.find((layer) => layer.token === 'tabblock20');

/**
 * Builds `datasets/pl94171/2020/blocks-<ST>.ndjson.gz`: the state's blocks with P1, P3 and the
 * TIGER internal point, sorted by GEOID, checked against the state's own totals. Returns its key.
 */
export async function buildBlockTable(ctx: RunContext, state: string): Promise<string> {
  if (TABBLOCK20 === undefined) {
    throw new Error('the TABBLOCK20 layer is not listed');
  }
  const { fips } = stateByCode(state);
  const tabKey = await ensureLayerFile(ctx, TABBLOCK20, fips);
  if (tabKey === null) {
    throw new PlFormatError(`TIGER lists no block file for ${state}`);
  }
  const points = await readDbf(tabKey, ctx, ['GEOID20', 'INTPTLAT20', 'INTPTLON20']);
  const zipKey = await ensurePlZip(ctx, state);
  const temp = await datasetTempFile(ctx, zipKey, '.zip');
  let rows: BlockTableRow[];
  try {
    const blocks: PlBlock[] = [];
    for await (const block of readPlBlocks(temp.path)) {
      blocks.push(block);
    }
    rows = joinBlockPoints(blocks, points, await plStateTotals(temp.path));
  } finally {
    await temp.remove();
  }
  const written = await writeDatasetRows(
    ctx,
    { dataset: PL_DATASET, edition: PL_EDITION, file: `blocks-${state}.ndjson.gz` },
    rows,
  );
  return written.key;
}
