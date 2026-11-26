// The Census Government Units Listing, 2026 edition (D-310): four tabs read with their headers
// checked, codes padded, and the unit office address columns dropped at parse.
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { RunContext } from '../lib/runner.ts';
import { readXlsxSheets } from '../lib/xlsx.ts';
import type { XlsxValue } from '../lib/xlsx.ts';
import { openZipEntry } from '../lib/zip.ts';
import {
  datasetTempFile,
  ensureDatasetFile,
  readDatasetRows,
  writeDatasetRows,
} from './dataset.ts';
import type { DatasetFileResult } from './dataset.ts';

export const SOURCE_IDS = ['census-gus'] as const;

export const LISTING_DATASET = 'census-gus';
export const LISTING_EDITION = '2026';
export const LISTING_URL =
  'https://www2.census.gov/programs-surveys/gus/datasets/2026/gov_units_2026.zip';
export const LISTING_ZIP = 'gov_units_2026.zip';
export const LISTING_FILE = 'Govt_Units_2026_Final.xlsx';
export const PARSED_LISTING_FILE = 'parsed.ndjson.gz';

export type ListingTab =
  'General Purpose' | 'Special District' | 'School District' | 'DEP School Dist';
export const LISTING_TABS: readonly ListingTab[] = [
  'General Purpose',
  'Special District',
  'School District',
  'DEP School Dist',
];
/** The listing's fifth tab, which is not loaded (D-310). */
export const PENSION_TAB = 'Public Pension Sys';

/** Each tab's header row, in the order the 2026 file holds it. */
export const LISTING_HEADERS: Readonly<Record<ListingTab, readonly string[]>> = Object.freeze({
  'General Purpose': [
    'CENSUS_ID_PID6',
    'UNIT_NAME',
    'UNIT_TYPE',
    'TITLE',
    'ADDRESS1',
    'ADDRESS2',
    'CITY',
    'STATE',
    'ZIP',
    'ZIP4',
    'WEB_ADDRESS',
    'POLITICAL_CODE_DESCRIPTION',
    'POPULATION',
    'POPULATION_SOURCE_YEAR',
    'FIPS_STATE',
    'FIPS_COUNTY',
    'FIPS_PLACE',
    'COUNTY_AREA_NAME',
    'ACTIVE',
  ],
  'Special District': [
    'CENSUS_ID_PID6',
    'UNIT_NAME',
    'UNIT_TYPE',
    'FUNCTION_NAME',
    'TITLE',
    'ADDRESS1',
    'ADDRESS2',
    'CITY',
    'STATE',
    'ZIP',
    'ZIP4',
    'WEB_ADDRESS',
    'FIPS_STATE',
    'FIPS_COUNTY',
    'COUNTY_AREA_NAME',
    'ACTIVE',
  ],
  'School District': [
    'CENSUS_ID_PID6',
    'UNIT_NAME',
    'UNIT_TYPE',
    'TITLE',
    'ADDRESS1',
    'ADDRESS2',
    'CITY',
    'STATE',
    'ZIP',
    'ZIP4',
    'WEB_ADDRESS',
    'SCHOOL_ENROLLMENT',
    'ENROLLMENT_YEAR',
    'SCHOOL_LEVEL_DESCRIPTION',
    'FIPS_STATE',
    'FIPS_COUNTY',
    'COUNTY_AREA_NAME',
    'ACTIVE',
  ],
  'DEP School Dist': [
    'CENSUS_ID_PID6',
    'UNIT_NAME',
    'UNIT_TYPE',
    'TITLE',
    'ADDRESS1',
    'ADDRESS2',
    'CITY',
    'STATE',
    'ZIP',
    'ZIP4',
    'WEB_ADDRESS',
    'SCHOOL_ENROLLMENT',
    'ENROLLMENT_YEAR',
    'SCHOOL_LEVEL_DESCRIPTION',
    'FIPS_STATE',
    'FIPS_COUNTY',
    'COUNTY_AREA_NAME',
    'ACTIVE',
    'PARENT_CENSUS_ID_PID6',
    'PARENT_UNIT_NAME',
  ],
});

const digits = (width: number) => z.string().regex(new RegExp(`^\\d{${String(width)}}$`));
const optionalText = z.string().min(1).max(500).nullable();
const count = z.int().min(0).nullable();
const year = z.int().min(1900).max(2100).nullable();

export const ParsedListingRowSchema = z.strictObject({
  tab: z.enum(['General Purpose', 'Special District', 'School District', 'DEP School Dist']),
  pid6: digits(6),
  unit_name: z.string().min(1).max(500),
  unit_type: optionalText,
  title: optionalText,
  city: optionalText,
  state: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  zip: digits(5).nullable(),
  web_address: z.string().min(1).max(2000).nullable(),
  political_code_description: optionalText,
  population: count,
  population_source_year: year,
  fips_state: digits(2),
  fips_county: digits(3).nullable(),
  fips_place: digits(5).nullable(),
  county_area_name: optionalText,
  active: z.boolean(),
  function_name: optionalText,
  school_enrollment: count,
  enrollment_year: year,
  school_level_description: optionalText,
  parent_pid6: digits(6).nullable(),
  parent_unit_name: optionalText,
});
export type ParsedListingRow = z.infer<typeof ParsedListingRowSchema>;

/** A tab whose header row is not the expected one, or a tab the workbook lacks. */
export class ListingHeaderError extends Error {
  override readonly name = 'ListingHeaderError';
  readonly tab: string;
  readonly column: string | null;

  constructor(tab: string, column: string | null, detail: string) {
    super(`listing tab "${tab}": ${detail}`);
    this.tab = tab;
    this.column = column;
  }
}

/** A data row with a value that cannot be read: names the tab, the row number and the column. */
export class ListingRowError extends Error {
  override readonly name = 'ListingRowError';

  constructor(tab: string, rowNumber: number, column: string) {
    super(`listing tab "${tab}" row ${String(rowNumber)}: unreadable ${column}`);
  }
}

function isListingTab(sheet: string): sheet is ListingTab {
  return (LISTING_TABS as readonly string[]).includes(sheet);
}

function trimTrailingNulls(values: readonly XlsxValue[]): readonly XlsxValue[] {
  let end = values.length;
  while (end > 0 && (values[end - 1] === null || values[end - 1] === '')) {
    end -= 1;
  }
  return values.slice(0, end);
}

function checkHeader(tab: ListingTab, values: readonly XlsxValue[]): void {
  const expected = LISTING_HEADERS[tab];
  const found = trimTrailingNulls(values).map((value) =>
    typeof value === 'string' ? value.trim() : value,
  );
  const width = Math.max(expected.length, found.length);
  for (let i = 0; i < width; i += 1) {
    if (found[i] !== expected[i]) {
      const column = expected[i] ?? String(found[i]);
      throw new ListingHeaderError(
        tab,
        column,
        `header column ${String(i + 1)} is ${JSON.stringify(found[i] ?? null)}, expected ${JSON.stringify(expected[i] ?? null)}`,
      );
    }
  }
}

type Cells = {
  readonly tab: ListingTab;
  readonly rowNumber: number;
  get(column: string): XlsxValue;
};

/** A cell as text: trimmed, with an empty string read as null. */
function text(cells: Cells, column: string): string | null {
  const value = cells.get(column);
  if (value === null) return null;
  const out = String(value).trim();
  return out === '' ? null : out;
}

/** A fixed-width code: a numeric cell loses its leading zeros, so every code is padded. */
function code(cells: Cells, column: string, width: number): string | null {
  const value = cells.get(column);
  if (value === null) return null;
  const raw =
    typeof value === 'number'
      ? Number.isInteger(value)
        ? String(value)
        : ''
      : String(value).trim();
  if (raw === '') {
    if (typeof value === 'number') throw new ListingRowError(cells.tab, cells.rowNumber, column);
    return null;
  }
  if (!/^\d+$/.test(raw) || raw.length > width) {
    throw new ListingRowError(cells.tab, cells.rowNumber, column);
  }
  return raw.padStart(width, '0');
}

function requiredCode(cells: Cells, column: string, width: number): string {
  const value = code(cells, column, width);
  if (value === null) throw new ListingRowError(cells.tab, cells.rowNumber, column);
  return value;
}

/** A whole number, written with or without thousands separators. */
function wholeNumber(cells: Cells, column: string): number | null {
  const value = cells.get(column);
  if (value === null) return null;
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0) return value;
    throw new ListingRowError(cells.tab, cells.rowNumber, column);
  }
  const raw = String(value).trim();
  if (raw === '') return null;
  if (!/^(\d{1,3}(,\d{3})+|\d+)$/.test(raw)) {
    throw new ListingRowError(cells.tab, cells.rowNumber, column);
  }
  return Number.parseInt(raw.replaceAll(',', ''), 10);
}

function state(cells: Cells): string | null {
  const value = text(cells, 'STATE');
  if (value === null) return null;
  if (!/^[A-Z]{2}$/.test(value)) throw new ListingRowError(cells.tab, cells.rowNumber, 'STATE');
  return value;
}

function active(cells: Cells): boolean {
  const value = text(cells, 'ACTIVE');
  if (value === 'Y') return true;
  if (value === 'N') return false;
  throw new ListingRowError(cells.tab, cells.rowNumber, 'ACTIVE');
}

function parseRow(cells: Cells): ParsedListingRow {
  const unitName = text(cells, 'UNIT_NAME');
  if (unitName === null) throw new ListingRowError(cells.tab, cells.rowNumber, 'UNIT_NAME');
  return {
    tab: cells.tab,
    pid6: requiredCode(cells, 'CENSUS_ID_PID6', 6),
    unit_name: unitName,
    unit_type: text(cells, 'UNIT_TYPE'),
    title: text(cells, 'TITLE'),
    city: text(cells, 'CITY'),
    state: state(cells),
    zip: code(cells, 'ZIP', 5),
    web_address: text(cells, 'WEB_ADDRESS'),
    political_code_description: text(cells, 'POLITICAL_CODE_DESCRIPTION'),
    population: wholeNumber(cells, 'POPULATION'),
    population_source_year: wholeNumber(cells, 'POPULATION_SOURCE_YEAR'),
    fips_state: requiredCode(cells, 'FIPS_STATE', 2),
    fips_county: code(cells, 'FIPS_COUNTY', 3),
    fips_place: code(cells, 'FIPS_PLACE', 5),
    county_area_name: text(cells, 'COUNTY_AREA_NAME'),
    active: active(cells),
    function_name: text(cells, 'FUNCTION_NAME'),
    school_enrollment: wholeNumber(cells, 'SCHOOL_ENROLLMENT'),
    enrollment_year: wholeNumber(cells, 'ENROLLMENT_YEAR'),
    school_level_description: text(cells, 'SCHOOL_LEVEL_DESCRIPTION'),
    parent_pid6: code(cells, 'PARENT_CENSUS_ID_PID6', 6),
    parent_unit_name: text(cells, 'PARENT_UNIT_NAME'),
  };
}

/**
 * Streams the listing workbook's units. The Public Pension Sys tab is skipped; each of the four
 * tabs must open with its header row exactly (ListingHeaderError names the tab and the first
 * column that differs), and a tab the file lacks throws the same error once the file is read.
 * The columns ADDRESS1, ADDRESS2 and ZIP4 are never read.
 */
export async function* readListing(xlsx: Readable): AsyncIterable<ParsedListingRow> {
  const headed = new Set<ListingTab>();
  for await (const row of readXlsxSheets(xlsx, {})) {
    if (!isListingTab(row.sheet)) {
      continue;
    }
    const tab = row.sheet;
    if (!headed.has(tab)) {
      checkHeader(tab, row.values);
      headed.add(tab);
      continue;
    }
    if (trimTrailingNulls(row.values).length === 0) {
      continue;
    }
    const header = LISTING_HEADERS[tab];
    const values = row.values;
    yield parseRow({
      tab,
      rowNumber: row.rowNumber,
      get(column) {
        const index = header.indexOf(column);
        return index === -1 ? null : (values[index] ?? null);
      },
    });
  }
  for (const tab of LISTING_TABS) {
    if (!headed.has(tab)) {
      throw new ListingHeaderError(tab, null, 'the tab is missing from the workbook');
    }
  }
}

export type ListingDownload =
  | { key: string; fromCache: boolean; openWorkbook(): Promise<Readable> }
  | { needsSeed: true }
  | { failed: string };

/** The workbook inside the listing zip at `zipKey`; its temporary copy is removed when it closes. */
export async function openListingWorkbook(ctx: RunContext, zipKey: string): Promise<Readable> {
  const temp = await datasetTempFile(ctx, zipKey, '.zip');
  try {
    const entry = await openZipEntry(temp.path, LISTING_FILE);
    entry.once('close', () => {
      void temp.remove();
    });
    return entry;
  } catch (error) {
    await temp.remove();
    throw error;
  }
}

/** Downloads (or confirms) the listing zip; on success the workbook opens from the stored zip. */
export async function downloadListing(ctx: RunContext): Promise<ListingDownload> {
  const result: DatasetFileResult = await ensureDatasetFile(ctx, {
    dataset: LISTING_DATASET,
    edition: LISTING_EDITION,
    url: LISTING_URL,
    file: LISTING_ZIP,
    expectContentType: /^application\/(zip|x-zip-compressed|octet-stream)\b/i,
  });
  if (!('key' in result)) {
    return result;
  }
  const { key } = result;
  return { key, fromCache: result.fromCache, openWorkbook: () => openListingWorkbook(ctx, key) };
}

/** Writes the parsed rows as `datasets/census-gus/2026/parsed.ndjson.gz`. */
export async function writeParsedListing(
  ctx: RunContext,
  rows: AsyncIterable<ParsedListingRow> | Iterable<ParsedListingRow>,
): Promise<{ key: string; rows: number; sha256: string }> {
  return writeDatasetRows(
    ctx,
    { dataset: LISTING_DATASET, edition: LISTING_EDITION, file: PARSED_LISTING_FILE },
    rows,
  );
}

/** Reads an edition's parsed rows (the previous edition's when this year's header check failed). */
export function readParsedListing(
  ctx: RunContext,
  edition: string,
): AsyncIterable<ParsedListingRow> {
  return readDatasetRows(
    ctx,
    { dataset: LISTING_DATASET, edition, file: PARSED_LISTING_FILE },
    ParsedListingRowSchema,
  );
}
