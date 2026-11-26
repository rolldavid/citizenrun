import { Readable } from 'node:stream';
import { STREET_ADDRESS } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { readXlsxSheets, writeXlsx } from '../lib/xlsx.ts';
import type { XlsxValue } from '../lib/xlsx.ts';
import {
  LISTING_HEADERS,
  LISTING_TABS,
  ListingHeaderError,
  PENSION_TAB,
  readListing,
  readParsedListing,
  writeParsedListing,
} from './census-gus.ts';
import type { ParsedListingRow } from './census-gus.ts';
import { s01Sample, scriptedRun } from './dataset.fixtures.ts';

const SAMPLE = 'census-gus/govt-units-2026-first50.xlsx';

type Sheet = { name: string; rows: (string | number | null)[][] };

async function sampleSheets(): Promise<Sheet[]> {
  const sheets: Sheet[] = [];
  for await (const row of readXlsxSheets(
    Readable.from([Buffer.from(await s01Sample(SAMPLE))]),
    {},
  )) {
    let sheet = sheets.find((entry) => entry.name === row.sheet);
    if (sheet === undefined) {
      sheet = { name: row.sheet, rows: [] };
      sheets.push(sheet);
    }
    sheet.rows.push(
      row.values.map((value: XlsxValue) => (typeof value === 'boolean' ? String(value) : value)),
    );
  }
  return sheets;
}

async function readAll(bytes: Uint8Array): Promise<ParsedListingRow[]> {
  const rows: ParsedListingRow[] = [];
  for await (const row of readListing(Readable.from([Buffer.from(bytes)]))) {
    rows.push(row);
  }
  return rows;
}

/** A copy of the saved sample with `change` applied to its sheets, written with writeXlsx. */
async function changedCopy(change: (sheets: Sheet[]) => Sheet[]): Promise<Uint8Array> {
  return writeXlsx(change(await sampleSheets()));
}

function setCell(
  sheets: Sheet[],
  tab: string,
  rowIndex: number,
  column: string,
  value: string | number | null,
): void {
  const sheet = sheets.find((entry) => entry.name === tab);
  const header = sheet?.rows[0];
  const row = sheet?.rows[rowIndex];
  if (header === undefined || row === undefined) throw new Error('no such row');
  row[header.indexOf(column)] = value;
}

describe('census-gus readListing', () => {
  it('reads the four tabs of the saved sample', async () => {
    const rows = await readAll(await s01Sample(SAMPLE));
    expect(rows).toHaveLength(200);
    const pids = (tab: string) => rows.filter((row) => row.tab === tab).map((row) => row.pid6);
    // First and last CENSUS_ID_PID6 of each tab, read by hand from the workbook.
    expect([
      pids('General Purpose').length,
      pids('General Purpose')[0],
      pids('General Purpose').at(-1),
    ]).toEqual([50, '100001', '160534']);
    expect([
      pids('Special District').length,
      pids('Special District')[0],
      pids('Special District').at(-1),
    ]).toEqual([50, '218259', '141075']);
    expect([
      pids('School District').length,
      pids('School District')[0],
      pids('School District').at(-1),
    ]).toEqual([50, '177885', '201055']);
    expect([
      pids('DEP School Dist').length,
      pids('DEP School Dist')[0],
      pids('DEP School Dist').at(-1),
    ]).toEqual([50, '251544', '115645']);
    // The first General Purpose row, as the workbook holds it (POPULATION is written "61,464").
    expect(rows[0]).toEqual({
      tab: 'General Purpose',
      pid6: '100001',
      unit_name: 'COUNTY OF AUTAUGA',
      unit_type: '1 - COUNTY',
      title: 'ADMINISTRATOR',
      city: 'PRATTVILLE',
      state: 'AL',
      zip: '36067',
      web_address: 'http://www.autaugaco.org',
      political_code_description: 'COUNTY',
      population: 61464,
      population_source_year: 2024,
      fips_state: '01',
      fips_county: '001',
      fips_place: '99001',
      county_area_name: 'AUTAUGA',
      active: true,
      function_name: null,
      school_enrollment: null,
      enrollment_year: null,
      school_level_description: null,
      parent_pid6: null,
      parent_unit_name: null,
    });
    const special = rows.find((row) => row.tab === 'Special District');
    expect(special).toMatchObject({
      pid6: '218259',
      function_name: '91 - WATER SUPPLY UTILITY',
      population: null,
      fips_place: null,
    });
    const dependent = rows.find((row) => row.tab === 'DEP School Dist');
    expect(dependent).toMatchObject({
      pid6: '251544',
      parent_pid6: '226085',
      parent_unit_name: 'ALABAMA',
      school_enrollment: 255,
      enrollment_year: 2024,
    });
  });

  it('the header is checked on every tab', async () => {
    const renamed = await changedCopy((sheets) => {
      setCell(sheets, 'General Purpose', 0, 'UNIT_NAME', 'UNIT_NAMES');
      return sheets;
    });
    const error = await readAll(renamed).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ListingHeaderError);
    expect(error).toMatchObject({ tab: 'General Purpose', column: 'UNIT_NAME' });
    for (const tab of LISTING_TABS) {
      const changed = await changedCopy((sheets) => {
        setCell(sheets, tab, 0, 'ACTIVE', 'IS_ACTIVE');
        return sheets;
      });
      await expect(readAll(changed)).rejects.toMatchObject({
        name: 'ListingHeaderError',
        tab,
        column: 'ACTIVE',
      });
    }
  });

  it('a missing tab fails', async () => {
    const missing = await changedCopy((sheets) =>
      sheets.filter((sheet) => sheet.name !== 'DEP School Dist'),
    );
    await expect(readAll(missing)).rejects.toMatchObject({
      name: 'ListingHeaderError',
      tab: 'DEP School Dist',
      column: null,
    });
  });

  it('codes keep their leading zeros', async () => {
    const numeric = await changedCopy((sheets) => {
      setCell(sheets, 'General Purpose', 1, 'FIPS_STATE', 1);
      setCell(sheets, 'General Purpose', 1, 'FIPS_COUNTY', 1);
      setCell(sheets, 'General Purpose', 1, 'CENSUS_ID_PID6', 1);
      setCell(sheets, 'DEP School Dist', 1, 'PARENT_CENSUS_ID_PID6', 26085);
      setCell(sheets, 'Special District', 1, 'ZIP', 2134);
      return sheets;
    });
    const rows = await readAll(numeric);
    expect(rows[0]).toMatchObject({
      pid6: '000001',
      fips_state: '01',
      fips_county: '001',
      fips_place: '99001',
    });
    expect(rows.find((row) => row.tab === 'DEP School Dist')?.parent_pid6).toBe('026085');
    expect(rows.find((row) => row.tab === 'Special District')?.zip).toBe('02134');
  });

  it('addresses are dropped', async () => {
    const rows = await readAll(await s01Sample(SAMPLE));
    // The sample holds unit office addresses in ADDRESS1, such as "135 N COURT ST".
    const sheets = await sampleSheets();
    const general = sheets.find((sheet) => sheet.name === 'General Purpose');
    expect(
      String(general?.rows[1]?.[LISTING_HEADERS['General Purpose'].indexOf('ADDRESS1')]),
    ).toMatch(STREET_ADDRESS);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('address1');
      expect(Object.keys(row)).not.toContain('address2');
      expect(Object.keys(row)).not.toContain('zip4');
      for (const value of Object.values(row)) {
        if (typeof value === 'string') {
          expect(value).not.toMatch(STREET_ADDRESS);
        }
      }
    }
  });

  it('pension rows are skipped', async () => {
    const withPension = await changedCopy((sheets) => {
      const pension = sheets.find((sheet) => sheet.name === PENSION_TAB);
      if (pension === undefined) throw new Error('the sample has the pension tab');
      pension.rows.push([
        '999999',
        'FIXTURE PENSION FUND',
        '0 - STATE',
        'X1 - FIXTURE',
        null,
        null,
        null,
        null,
        'ZZ',
        '00000',
        null,
        null,
        '01',
        null,
        null,
        'Y',
        '226085',
        'ALABAMA',
      ]);
      return sheets;
    });
    const rows = await readAll(withPension);
    expect(rows).toHaveLength(200);
    expect(rows.some((row) => row.pid6 === '999999')).toBe(false);
  });

  it('ACTIVE N is false', async () => {
    const inactive = await changedCopy((sheets) => {
      setCell(sheets, 'Special District', 2, 'ACTIVE', 'N');
      return sheets;
    });
    const rows = await readAll(inactive);
    const special = rows.filter((row) => row.tab === 'Special District');
    expect(special[1]?.active).toBe(false);
    expect(special.filter((row) => !row.active)).toHaveLength(1);
    const bad = await changedCopy((sheets) => {
      setCell(sheets, 'Special District', 2, 'ACTIVE', 'maybe');
      return sheets;
    });
    await expect(readAll(bad)).rejects.toMatchObject({ name: 'ListingRowError' });
  });

  it('the parsed rows round-trip through parsed.ndjson.gz', async () => {
    const rows = await readAll(await s01Sample(SAMPLE));
    const { ctx, bucket } = scriptedRun(() => undefined);
    const written = await writeParsedListing(ctx, rows);
    expect(written).toMatchObject({ key: 'datasets/census-gus/2026/parsed.ndjson.gz', rows: 200 });
    expect(bucket.keys()).toEqual(['datasets/census-gus/2026/parsed.ndjson.gz']);
    const back: ParsedListingRow[] = [];
    for await (const row of readParsedListing(ctx, '2026')) {
      back.push(row);
    }
    expect(back).toEqual(rows);
    const missing = readParsedListing(ctx, '2025')[Symbol.asyncIterator]();
    await expect(missing.next()).rejects.toMatchObject({ name: 'DatasetFileMissingError' });
  });
});
