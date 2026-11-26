import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readXlsxSheets, writeXlsx } from '../lib/xlsx.ts';
import { s01Sample } from './dataset.fixtures.ts';
import {
  SCHOOL_FINANCE_SHEET,
  SchoolFinanceHeaderError,
  readSchoolFinance,
} from './school-finance.ts';

const SAMPLE = 'school-finance/elsec24t-first50.xlsx';

async function sampleRows(): Promise<(string | number | null)[][]> {
  const rows: (string | number | null)[][] = [];
  for await (const row of readXlsxSheets(
    Readable.from([Buffer.from(await s01Sample(SAMPLE))]),
    {},
  )) {
    rows.push(row.values.map((value) => (typeof value === 'boolean' ? String(value) : value)));
  }
  return rows;
}

const read = (bytes: Uint8Array) => readSchoolFinance(Readable.from([Buffer.from(bytes)]));

describe('school-finance', () => {
  it('maps PID6 to NCESID with padding', async () => {
    const map = await read(await s01Sample(SAMPLE));
    expect(map.size).toBe(50);
    // Rows 2 and 3 of the sample, read by hand: BALDWIN COUNTY and ONEONTA CITY SCHOOL DISTRICT.
    expect(map.get('100191')).toBe('0100270');
    expect(map.get('100192')).toBe('0102550');
    // A numeric cell loses its leading zeros; the reader pads both codes back.
    const rows = await sampleRows();
    const first = rows[1];
    if (first === undefined) throw new Error('the sample has rows');
    first[1] = 100191;
    first[9] = 100270;
    const numeric = await read(await writeXlsx([{ name: SCHOOL_FINANCE_SHEET, rows }]));
    expect(numeric.get('100191')).toBe('0100270');
  });

  it('a renamed header column fails', async () => {
    const rows = await sampleRows();
    const header = rows[0];
    if (header === undefined) throw new Error('the sample has a header');
    header[9] = 'NCES_ID';
    await expect(
      read(await writeXlsx([{ name: SCHOOL_FINANCE_SHEET, rows }])),
    ).rejects.toBeInstanceOf(SchoolFinanceHeaderError);
    await expect(
      read(await writeXlsx([{ name: 'Sheet1', rows: await sampleRows() }])),
    ).rejects.toBeInstanceOf(SchoolFinanceHeaderError);
  });

  it('a row with an empty NCESID is skipped', async () => {
    const rows = await sampleRows();
    const first = rows[1];
    if (first === undefined) throw new Error('the sample has rows');
    first[9] = null;
    const map = await read(await writeXlsx([{ name: SCHOOL_FINANCE_SHEET, rows }]));
    expect(map.size).toBe(49);
    expect(map.has('100191')).toBe(false);
  });
});
