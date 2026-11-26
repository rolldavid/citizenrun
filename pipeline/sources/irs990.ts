// Form 990 e-file returns (PIPE-coops steps 3 to 5): the yearly index, the monthly batches named in
// it (of which only the matched returns are kept, D-316) and the board facts of a co-op's return.
import { bucketKeys } from '../lib/bucket.ts';
import { readDelimited } from '../lib/csv.ts';
import type { RunContext } from '../lib/runner.ts';
import { parseXml } from '../lib/xml.ts';
import { listZip, openZipEntry, toTempFile } from '../lib/zip.ts';
import { openDatasetFile, requireDatasetFile } from './dataset.ts';

export const SOURCE_IDS = ['irs990'] as const;

export const IRS990_DATASET = 'irs990';
export const IRS990_ROOT = 'https://apps.irs.gov/pub/epostcard/990/xml/';
/** Form 990 batches are 71 to 521 MB; the fetcher's default limit for datasets is 200 MB. */
const BATCH_MAX_BYTES = 1_000_000_000;

export type IndexYear = 2026 | 2025;

export const INDEX_COLUMNS = [
  'RETURN_ID',
  'FILING_TYPE',
  'EIN',
  'TAX_PERIOD',
  'SUB_DATE',
  'TAXPAYER_NAME',
  'RETURN_TYPE',
  'DLN',
  'OBJECT_ID',
  'XML_BATCH_ID',
] as const;

export type IndexRow = {
  readonly returnId: string;
  readonly filingType: string;
  readonly ein: string;
  readonly taxPeriod: string;
  readonly subDate: string;
  readonly taxpayerName: string;
  readonly returnType: string;
  readonly dln: string;
  readonly objectId: string;
  readonly batch: string;
};

export type ReturnFile = {
  readonly objectId: string;
  readonly batch: string;
  readonly year: IndexYear;
  readonly xml: string;
  readonly retrievedAt: string;
};

/** An index whose header lacks one of its ten columns. */
export class IrsIndexHeaderError extends Error {
  override readonly name = 'IrsIndexHeaderError';
}

export function indexFile(year: IndexYear): string {
  return `index_${String(year)}.csv`;
}

export function indexUrl(year: IndexYear): string {
  return `${IRS990_ROOT}${String(year)}/${indexFile(year)}`;
}

export function batchUrl(year: IndexYear, batch: string): string {
  return `${IRS990_ROOT}${String(year)}/${batch}.zip`;
}

/** The `field_meta` source of a value read from a return: the batch, with the file as fragment. */
export function returnSourceUrl(ret: Pick<ReturnFile, 'year' | 'batch' | 'objectId'>): string {
  return `${batchUrl(ret.year, ret.batch)}#${ret.objectId}_public.xml`;
}

const OBJECT_ID = /^\d{1,30}$/;
const BATCH_ID = /^[A-Za-z0-9_]{1,80}$/;

function returnFileName(objectId: string): string {
  return `${objectId}_public.xml`;
}

/** The kept return of `objectId`: `datasets/irs990/<year>/<OBJECT_ID>_public.xml`. */
export function returnKey(year: IndexYear, objectId: string): string {
  return bucketKeys.dataset(IRS990_DATASET, String(year), returnFileName(objectId));
}

/** Where a batch is held while its matched returns are extracted; deleted right after. */
export function batchKey(year: IndexYear, batch: string): string {
  return bucketKeys.dataset(IRS990_DATASET, String(year), `batch-${batch}.zip`);
}

/**
 * The year's index, downloaded or confirmed through the fetcher. `rows(eins)` streams the stored
 * file and keeps the rows whose EIN is in the set; it throws IrsIndexHeaderError on a bad header.
 */
export async function loadIndex(
  ctx: RunContext,
  year: IndexYear,
): Promise<{ key: string; rows: (eins: ReadonlySet<string>) => Promise<readonly IndexRow[]> }> {
  const key = await requireDatasetFile(ctx, {
    dataset: IRS990_DATASET,
    edition: String(year),
    url: indexUrl(year),
    file: indexFile(year),
    sourceUrl: IRS990_ROOT,
  });
  return {
    key,
    rows: async (eins) => {
      const out: IndexRow[] = [];
      let at: readonly number[] | null = null;
      for await (const { record } of readDelimited(await openDatasetFile(ctx, key), {
        delimiter: ',',
        header: true,
        encoding: 'utf8',
      })) {
        if (at === null) {
          const header = record.map((cell) => cell.trim());
          at = INDEX_COLUMNS.map((column) => header.indexOf(column));
          if (at.some((index) => index === -1)) {
            throw new IrsIndexHeaderError('the Form 990 index header lacks a column');
          }
          continue;
        }
        const cells = at.map((index) => (record[index] ?? '').trim());
        const ein = cells[2] ?? '';
        if (!eins.has(ein)) continue;
        const objectId = cells[8] ?? '';
        const batch = cells[9] ?? '';
        if (!OBJECT_ID.test(objectId) || !BATCH_ID.test(batch)) continue;
        out.push({
          returnId: cells[0] ?? '',
          filingType: cells[1] ?? '',
          ein,
          taxPeriod: cells[3] ?? '',
          subDate: cells[4] ?? '',
          taxpayerName: cells[5] ?? '',
          returnType: cells[6] ?? '',
          dln: cells[7] ?? '',
          objectId,
          batch,
        });
      }
      return out;
    },
  };
}

function compareDigits(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Per EIN, the row with the largest `TAX_PERIOD`; a tie goes to the larger `OBJECT_ID`. */
export function latestReturns(rows: readonly IndexRow[]): ReadonlyMap<string, IndexRow> {
  const out = new Map<string, IndexRow>();
  for (const row of rows) {
    const best = out.get(row.ein);
    if (
      best === undefined ||
      compareDigits(row.taxPeriod, best.taxPeriod) > 0 ||
      (row.taxPeriod === best.taxPeriod && compareDigits(row.objectId, best.objectId) > 0)
    ) {
      out.set(row.ein, row);
    }
  }
  return out;
}

async function streamBytes(body: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const HTML = /^text\/html\b/i;

/**
 * The returns of `wanted`, keyed by OBJECT_ID. A return already kept under
 * `datasets/irs990/<year>/` is read and not fetched. For the rest each named batch is downloaded
 * once through the fetcher, copied to a temporary file, and only the wanted returns are written to
 * their kept keys; the temporary file and the batch object are deleted in every case. A batch that
 * cannot be fetched or opened leaves its returns missing and is counted.
 */
export async function fetchReturns(
  ctx: RunContext,
  year: IndexYear,
  wanted: readonly IndexRow[],
): Promise<{ returns: ReadonlyMap<string, ReturnFile>; batchUnavailable: readonly string[] }> {
  const returns = new Map<string, ReturnFile>();
  const missing = new Map<string, Set<string>>();
  for (const row of wanted) {
    if (returns.has(row.objectId)) continue;
    const key = returnKey(year, row.objectId);
    const head = await ctx.bucket.head(key);
    const found = head === null ? null : await ctx.bucket.getStream(key);
    if (head !== null && found !== null) {
      returns.set(row.objectId, {
        objectId: row.objectId,
        batch: row.batch,
        year,
        xml: (await streamBytes(found.body)).toString('utf8'),
        retrievedAt: head.lastModified.toISOString(),
      });
      continue;
    }
    const set = missing.get(row.batch) ?? new Set<string>();
    set.add(row.objectId);
    missing.set(row.batch, set);
  }
  const unavailable: string[] = [];
  for (const batch of [...missing.keys()].sort()) {
    const objectIds = missing.get(batch) ?? new Set<string>();
    const key = batchKey(year, batch);
    let temp: { path: string; remove(): Promise<void> } | null = null;
    try {
      const result = await ctx.fetcher.download(
        { url: batchUrl(year, batch), class: 'dataset', maxBytes: BATCH_MAX_BYTES },
        key,
      );
      if (result.kind !== 'ok' || HTML.test(result.contentType ?? '')) {
        unavailable.push(batch);
        continue;
      }
      const stored = await ctx.bucket.getStream(key);
      if (stored === null) {
        unavailable.push(batch);
        continue;
      }
      temp = await toTempFile(stored.body, '.zip');
      let names: readonly string[];
      try {
        names = (await listZip(temp.path)).map((entry) => entry.name);
      } catch {
        unavailable.push(batch);
        continue;
      }
      const byBase = new Map<string, string>();
      for (const name of names) {
        byBase.set(name.slice(name.lastIndexOf('/') + 1), name);
      }
      const retrievedAt = ctx.now.toISOString();
      for (const objectId of [...objectIds].sort()) {
        const entry = byBase.get(returnFileName(objectId));
        if (entry === undefined) continue;
        const bytes = await streamBytes(await openZipEntry(temp.path, entry));
        await ctx.bucket.putBytes(returnKey(year, objectId), bytes, 'application/xml');
        returns.set(objectId, { objectId, batch, year, xml: bytes.toString('utf8'), retrievedAt });
      }
    } finally {
      if (temp !== null) await temp.remove();
      await ctx.bucket.delete([key]);
    }
  }
  return { returns, batchUnavailable: unavailable };
}

// ---------------------------------------------------------------------------------------------
// The return

export type CoopDirector = {
  readonly name: string;
  /** Whole dollars as written; 0 when the element is absent; null when it is not a whole number. */
  readonly comp: number | null;
  readonly other: number | null;
  readonly hours: number | null;
  readonly quotes: {
    readonly comp: string | null;
    readonly other: string | null;
    readonly hours: string | null;
  };
};

export type CoopBoard = {
  readonly is501c12: boolean;
  readonly boardSize: number | null;
  readonly boardSizeQuote: string | null;
  readonly membersElect: boolean | null;
  readonly website: string | null;
  readonly directors: readonly CoopDirector[];
};

type Node = Readonly<Record<string, unknown>>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every element and attribute name without its namespace prefix. */
function stripPrefixes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPrefixes);
  if (!isNode(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const attribute = key.startsWith('@_');
    const bare = attribute ? key.slice(2) : key;
    const local =
      bare.includes(':') && !bare.startsWith('xmlns') ? bare.slice(bare.indexOf(':') + 1) : bare;
    out[attribute ? `@_${local}` : local] = stripPrefixes(inner);
  }
  return out;
}

function child(node: unknown, name: string): unknown {
  return isNode(node) ? node[name] : undefined;
}

function list(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** An element's text as the file holds it, or null when the element is absent. */
function textOf(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? (value as readonly unknown[])[0] : value;
  if (typeof first === 'string') return first;
  if (isNode(first)) {
    const inner = first['#text'];
    return typeof inner === 'string' ? inner : '';
  }
  return null;
}

/** `<Name>text</Name>` with the text exactly as the file holds it. */
function quoteOf(name: string, text: string | null): string | null {
  return text === null ? null : `<${name}>${text}</${name}>`;
}

function wholeDollars(text: string | null): number | null {
  if (text === null) return 0;
  const trimmed = text.trim();
  return /^-?\d{1,15}$/.test(trimmed) ? Number(trimmed) : null;
}

function hoursOf(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  return /^\d{1,3}(\.\d{1,4})?$/.test(trimmed) ? Number(trimmed) : null;
}

function indicator(text: string | null): boolean | null {
  if (text === null) return null;
  const value = text.trim().toLowerCase();
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return null;
}

const SET_MARKS: ReadonlySet<string> = new Set(['x', '1', 'true']);

/**
 * The board facts of a Form 990 return; `'not_990'` when the file has no `Return/ReturnData/IRS990`.
 * Values are read as written, never as numbers before the quote is taken.
 */
export function parseCoopReturn(xml: string): CoopBoard | 'not_990' {
  const doc = stripPrefixes(parseXml(xml.replace(/^\uFEFF/u, '')));
  const form = child(child(child(doc, 'Return'), 'ReturnData'), 'IRS990');
  if (!isNode(form)) return 'not_990';
  const c501 = list(form['Organization501cInd'])[0];
  const is501c12 = isNode(c501) && c501['@_organization501cTypeTxt'] === '12';
  const sizeText = textOf(form['VotingMembersGoverningBodyCnt']);
  const sizeTrimmed = sizeText?.trim() ?? '';
  const boardSize = /^\d{1,4}$/.test(sizeTrimmed) ? Number(sizeTrimmed) : null;
  const websiteText = textOf(form['WebsiteAddressTxt'])?.trim() ?? '';
  const directors: CoopDirector[] = [];
  for (const item of list(form['Form990PartVIISectionAGrp'])) {
    if (!isNode(item)) continue;
    const mark = textOf(item['IndividualTrusteeOrDirectorInd']);
    if (mark === null || !SET_MARKS.has(mark.trim().toLowerCase())) continue;
    const comp = textOf(item['ReportableCompFromOrgAmt']);
    const other = textOf(item['OtherCompensationAmt']);
    const hours = textOf(item['AverageHoursPerWeekRt']);
    directors.push({
      name: (textOf(item['PersonNm']) ?? '').trim(),
      comp: wholeDollars(comp),
      other: wholeDollars(other),
      hours: hoursOf(hours),
      quotes: {
        comp: quoteOf('ReportableCompFromOrgAmt', comp),
        other: quoteOf('OtherCompensationAmt', other),
        hours: quoteOf('AverageHoursPerWeekRt', hours),
      },
    });
  }
  return {
    is501c12,
    boardSize,
    boardSizeQuote: boardSize === null ? null : quoteOf('VotingMembersGoverningBodyCnt', sizeText),
    membersElect: indicator(textOf(form['ElectionOfBoardMembersInd'])),
    website: websiteText === '' ? null : websiteText,
    directors,
  };
}
