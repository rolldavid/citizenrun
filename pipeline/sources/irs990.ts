// Form 990 e-file returns (PIPE-coops steps 3 to 5): the yearly index, the monthly batches named in
// it (of which only the matched returns are kept, D-316) and the board facts of a co-op's return.
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
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
/** The most bytes one return may hold when the system unzip extracts it. */
export const RETURN_MAX_BYTES = 64 * 1024 * 1024;
/** How long the system unzip may take to extract one return. */
export const UNZIP_TIMEOUT_MS = 120_000;

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

/** The zip reader's refusal of an entry it cannot decompress, such as Deflate64 (method 9). */
const UNSUPPORTED_METHOD = /^unsupported compression method\b/;
/** The same refusal for Deflate64, which the system unzip reads (D-880). */
const DEFLATE64_METHOD = /^unsupported compression method: 9$/;

function isUnsupportedMethod(error: unknown): boolean {
  return error instanceof Error && UNSUPPORTED_METHOD.test(error.message);
}

function isDeflate64(error: unknown): boolean {
  return error instanceof Error && DEFLATE64_METHOD.test(error.message);
}

/** Runs a program with its arguments as an array and no shell, resolving with its stdout. */
export type FileRunner = (
  file: string,
  args: readonly string[],
  options: { readonly maxBuffer: number; readonly timeout: number },
) => Promise<Buffer>;

const execFileRunner: FileRunner = (file, args, options) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      file,
      [...args],
      {
        encoding: 'buffer',
        maxBuffer: options.maxBuffer,
        timeout: options.timeout,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error instanceof Error ? error : new Error('unzip failed'));
          return;
        }
        resolvePromise(stdout);
      },
    );
  });

const DEFLATE64 = 9;
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** Version 2.1, the first that names Deflate64. */
const ZIP_VERSION_DEFLATE64 = 21;
/** The one name of the archive unzip is given; it holds no wildcard and is no option. */
const SINGLE_MEMBER = 'return.xml';

/** An entry's packed bytes with the facts of the central directory that describe them. */
export type PackedEntry = {
  readonly method: number;
  readonly packed: Uint8Array;
  readonly crc32: number;
  readonly size: number;
};

/**
 * A zip of the one entry `entry`, named `name`, its bytes copied as packed: a local file header, the
 * bytes, the central directory and its end record, with no Zip64 record (the entry is small).
 */
export function singleEntryZip(name: string, entry: PackedEntry): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const packed = Buffer.from(entry.packed);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(ZIP_LOCAL_HEADER, 0);
  local.writeUInt16LE(ZIP_VERSION_DEFLATE64, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(entry.method, 8);
  local.writeUInt32LE(entry.crc32 >>> 0, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(entry.size, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(ZIP_CENTRAL_HEADER, 0);
  central.writeUInt16LE(ZIP_VERSION_DEFLATE64, 4);
  central.writeUInt16LE(ZIP_VERSION_DEFLATE64, 6);
  central.writeUInt16LE(entry.method, 10);
  central.writeUInt32LE(entry.crc32 >>> 0, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(entry.size, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  // Times, extra fields, comment, disk, attributes and the local header's offset (0) stay zero.
  const directory = Buffer.concat([central, nameBytes]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(local.length + nameBytes.length + packed.length, 16);
  return Buffer.concat([local, nameBytes, packed, directory, end]);
}

/**
 * The packed bytes of the Deflate64 entry `member` of the archive at `path`, read without
 * decompressing, or null when there is no such entry, it is not Deflate64, it is encrypted, or
 * either of its sizes passes `RETURN_MAX_BYTES`.
 */
async function packedDeflate64Entry(path: string, member: string): Promise<PackedEntry | null> {
  const zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false });
  try {
    const entry = await new Promise<yauzl.Entry | null>((resolvePromise, reject) => {
      zip.on('error', reject);
      zip.on('end', () => {
        resolvePromise(null);
      });
      zip.on('entry', (seen: yauzl.Entry) => {
        if (seen.fileName === member) {
          resolvePromise(seen);
          return;
        }
        zip.readEntry();
      });
      zip.readEntry();
    });
    if (
      entry === null ||
      entry.compressionMethod !== DEFLATE64 ||
      entry.isEncrypted() ||
      entry.compressedSize > RETURN_MAX_BYTES ||
      entry.uncompressedSize > RETURN_MAX_BYTES
    ) {
      return null;
    }
    const packed = await streamBytes(
      await zip.openReadStreamPromise(entry, { decodeFileData: false }),
    );
    return { method: DEFLATE64, packed, crc32: entry.crc32, size: entry.uncompressedSize };
  } finally {
    zip.close();
  }
}

/**
 * The bytes of the Deflate64 (zip method 9) entry `member` of the archive at `batchPath`, which
 * yauzl refuses (D-880), extracted by the system `unzip -p`; null when unzip exits non-zero, runs
 * past `UNZIP_TIMEOUT_MS`, writes more than `RETURN_MAX_BYTES`, or writes bytes whose size or
 * CRC-32 differ from the central directory's. unzip is given a one-entry copy of the member, in a
 * temporary file deleted afterwards, not the batch itself: macOS's UnZip 6.00 misreads the Zip64
 * end records of the IRS batches and exits 3 even when the member it wrote is whole. That UnZip lists
 * USE_DEFLATE64 in `unzip -v`, and the ubuntu-24.04 runners ship Info-ZIP unzip with Deflate64.
 */
export async function unzipMember(
  batchPath: string,
  member: string,
  run: FileRunner = execFileRunner,
): Promise<Buffer | null> {
  let entry: PackedEntry | null;
  try {
    entry = await packedDeflate64Entry(batchPath, member);
  } catch {
    return null;
  }
  if (entry === null) return null;
  const single = await toTempFile(Readable.from([singleEntryZip(SINGLE_MEMBER, entry)]), '.zip');
  try {
    const out = await run('unzip', ['-p', single.path, SINGLE_MEMBER], {
      maxBuffer: RETURN_MAX_BYTES,
      timeout: UNZIP_TIMEOUT_MS,
    });
    if (out.length !== entry.size || crc32(out) !== entry.crc32 >>> 0) return null;
    return out;
  } catch {
    return null;
  } finally {
    await single.remove();
  }
}

export type FetchReturnsOptions = {
  /** Runs the system unzip for Deflate64 members; the default is `execFile`. */
  readonly run?: FileRunner;
};

/**
 * The returns of `wanted`, keyed by OBJECT_ID. A return already kept under
 * `datasets/irs990/<year>/` is read and not fetched. For the rest each named batch is downloaded
 * once through the fetcher, copied to a temporary file, and only the wanted returns are written to
 * their kept keys; the temporary file and the batch object are deleted in every case. An entry
 * packed with Deflate64 is extracted by the system unzip (D-880). A batch that cannot be fetched or
 * opened, or one with a return neither reader can decompress, leaves those returns missing and is
 * counted.
 */
export async function fetchReturns(
  ctx: RunContext,
  year: IndexYear,
  wanted: readonly IndexRow[],
  opts: FetchReturnsOptions = {},
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
      let unreadable = false;
      for (const objectId of [...objectIds].sort()) {
        const entry = byBase.get(returnFileName(objectId));
        if (entry === undefined) continue;
        let bytes: Buffer;
        try {
          bytes = await streamBytes(await openZipEntry(temp.path, entry));
        } catch (error) {
          // An entry the reader cannot decompress leaves its return missing, as a batch that cannot be opened.
          if (!isUnsupportedMethod(error)) throw error;
          // A Deflate64 entry is read from the same temporary file by the system unzip (D-880).
          const extracted = isDeflate64(error)
            ? await unzipMember(temp.path, entry, opts.run)
            : null;
          if (extracted === null) {
            ctx.log.warn('irs990.entry_unreadable', { year, batch });
            unreadable = true;
            continue;
          }
          bytes = extracted;
        }
        await ctx.bucket.putBytes(returnKey(year, objectId), bytes, 'application/xml');
        returns.set(objectId, { objectId, batch, year, xml: bytes.toString('utf8'), retrievedAt });
      }
      if (unreadable) unavailable.push(batch);
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
