import type { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { listZip, openZipEntry, toTempFile } from './zip.ts';

export type XlsxValue = string | number | boolean | null;

/** A workbook the streaming reader cannot read as written, such as a sheet with no readable name. */
export class XlsxFormatError extends Error {
  override readonly name = 'XlsxFormatError';
}

/**
 * The parts of exceljs' streaming `WorkbookReader` this module drives. The reader's own walk over
 * the zip (through its bundled unzip stream) drops every entry after a worksheet it has to set
 * aside until the shared strings arrive, which is the usual order of a workbook Excel writes. So
 * the zip is walked here with yauzl, in the order the reader needs, and the reader's own parsers
 * read each part.
 */
type ReaderParts = {
  readonly model?: unknown;
  _parseRels(entry: Readable): Promise<void>;
  _parseWorkbook(entry: Readable): Promise<void>;
  _parseSharedStrings(entry: Readable): AsyncIterable<unknown>;
  _parseWorksheet(
    iterator: AsyncIterable<unknown>,
    sheetNo: string,
  ): Iterable<{ eventType: string; value: unknown }>;
};

/** What the streaming reader sets on each worksheet; its type declaration leaves these out. */
type WorksheetIdentity = { readonly id?: unknown; readonly name?: unknown };

type StreamedRow = { readonly number: number; readonly values: unknown };

const RELS_PART = 'xl/_rels/workbook.xml.rels';
const WORKBOOK_PART = 'xl/workbook.xml';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const WORKSHEET_PART = /^xl\/worksheets\/sheet(\d+)\.xml$/;

/**
 * The name of a streamed worksheet. The reader starts every worksheet as `Sheet<n>` with the
 * part's number as a string, and sets a numeric id and the real name only when it finds the sheet
 * in the workbook part; an id that is still not a number means the name was never read.
 */
function sheetName(reader: object): string {
  const { id, name } = reader as WorksheetIdentity;
  if (typeof id !== 'number' || typeof name !== 'string' || name === '') {
    throw new XlsxFormatError('a worksheet has no name in the workbook part');
  }
  return name;
}

function richText(value: object): string | null {
  const parts = (value as { richText?: unknown }).richText;
  if (!Array.isArray(parts)) return null;
  return parts.map((part: unknown) => (part as { text?: unknown }).text).join('');
}

function cellValue(value: unknown): XlsxValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('sharedString' in value) {
      throw new XlsxFormatError('a cell names a shared string, and the workbook has none');
    }
    const text = richText(value);
    if (text !== null) return text;
    if ('result' in value) return cellValue(value.result);
    if ('text' in value) return cellValue(value.text);
  }
  // An error cell (#N/A and the like) holds no value.
  return null;
}

/** A row's 1-based sparse values as a 0-based list with `null` for each empty cell. */
function rowValues(values: unknown): XlsxValue[] {
  if (!Array.isArray(values)) return [];
  const out: XlsxValue[] = [];
  for (let i = 1; i < values.length; i += 1) {
    out.push(cellValue(values[i]));
  }
  return out;
}

/**
 * Streams the rows of every sheet, or of the named sheets only, in the order the file holds them.
 * Rich text is joined to plain text and a date cell becomes its ISO date. With styles ignored, a
 * date stored as a serial number with a date format arrives as that number. The body is copied to
 * a temporary file first, because the zip is read with random access.
 */
export async function* readXlsxSheets(
  body: Readable,
  opts: { sheets?: readonly string[] },
): AsyncIterable<{ sheet: string; rowNumber: number; values: readonly XlsxValue[] }> {
  const wanted = opts.sheets === undefined ? null : new Set(opts.sheets);
  const file = await toTempFile(body, '.xlsx');
  try {
    const names = (await listZip(file.path)).map((entry) => entry.name);
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(file.path, {
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
      worksheets: 'emit',
    }) as unknown as ReaderParts;
    if (names.includes(RELS_PART)) {
      await reader._parseRels(await openZipEntry(file.path, RELS_PART));
    }
    if (names.includes(WORKBOOK_PART)) {
      await reader._parseWorkbook(await openZipEntry(file.path, WORKBOOK_PART));
    }
    if (names.includes(SHARED_STRINGS_PART)) {
      const strings = await openZipEntry(file.path, SHARED_STRINGS_PART);
      const parts = reader._parseSharedStrings(strings)[Symbol.asyncIterator]();
      while (!(await parts.next()).done) {
        // With `sharedStrings: 'cache'` the strings are kept on the reader and nothing is emitted.
      }
    }
    for (const name of names) {
      const sheetNo = WORKSHEET_PART.exec(name)?.[1];
      if (sheetNo === undefined) continue;
      if (reader.model === undefined) {
        throw new XlsxFormatError('a worksheet has no name: the workbook part is missing');
      }
      const part = await openZipEntry(file.path, name);
      try {
        for (const event of reader._parseWorksheet(part, sheetNo)) {
          if (
            event.eventType !== 'worksheet' ||
            typeof event.value !== 'object' ||
            event.value === null
          ) {
            continue;
          }
          const sheet = sheetName(event.value);
          if (wanted !== null && !wanted.has(sheet)) continue;
          for await (const row of event.value as AsyncIterable<StreamedRow>) {
            yield { sheet, rowNumber: row.number, values: rowValues(row.values) };
          }
        }
      } finally {
        part.destroy();
      }
    }
  } finally {
    await file.remove();
  }
}

/** A workbook of the given sheets and rows; `null` leaves a cell empty. */
export async function writeXlsx(
  sheets: readonly { name: string; rows: readonly (readonly (string | number | null)[])[] }[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) {
      worksheet.addRow([...row]);
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
