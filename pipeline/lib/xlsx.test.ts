import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { XlsxFormatError, readXlsxSheets, writeXlsx } from './xlsx.ts';
import type { XlsxValue } from './xlsx.ts';
import { storedZip } from './zip.fixtures.ts';

type ReadRow = { sheet: string; rowNumber: number; values: readonly XlsxValue[] };

async function readAll(bytes: Uint8Array, sheets?: readonly string[]): Promise<ReadRow[]> {
  const rows: ReadRow[] = [];
  const body = Readable.from([Buffer.from(bytes)]);
  for await (const row of readXlsxSheets(body, sheets === undefined ? {} : { sheets })) {
    rows.push(row);
  }
  return rows;
}

describe('xlsx', () => {
  it('reads back what writeXlsx wrote, with null for an empty cell', async () => {
    const bytes = await writeXlsx([
      {
        name: 'Fixture Units',
        rows: [
          ['CODE', 'NAME', 'COUNT'],
          ['01234', null, 12],
          ['00077', 'Fixture Town', 3.5],
        ],
      },
      { name: 'Second', rows: [['x'], [42]] },
    ]);
    expect(await readAll(bytes)).toEqual([
      { sheet: 'Fixture Units', rowNumber: 1, values: ['CODE', 'NAME', 'COUNT'] },
      { sheet: 'Fixture Units', rowNumber: 2, values: ['01234', null, 12] },
      { sheet: 'Fixture Units', rowNumber: 3, values: ['00077', 'Fixture Town', 3.5] },
      { sheet: 'Second', rowNumber: 1, values: ['x'] },
      { sheet: 'Second', rowNumber: 2, values: [42] },
    ]);
  });

  it('a leading-zero code stored as text stays text', async () => {
    const bytes = await writeXlsx([{ name: 'Codes', rows: [['000123', 123]] }]);
    const [row] = await readAll(bytes);
    expect(row?.values).toEqual(['000123', 123]);
    expect(typeof row?.values[0]).toBe('string');
  });

  it('reads only the sheets asked for', async () => {
    const bytes = await writeXlsx([
      { name: 'Skip Me', rows: [['a']] },
      { name: 'Keep', rows: [['b'], ['c']] },
    ]);
    expect(await readAll(bytes, ['Keep'])).toEqual([
      { sheet: 'Keep', rowNumber: 1, values: ['b'] },
      { sheet: 'Keep', rowNumber: 2, values: ['c'] },
    ]);
  });

  it('joins rich text and takes a formula result', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Mixed');
    sheet.getCell('A1').value = {
      richText: [{ text: 'Fixture ' }, { text: 'Town', font: { bold: true } }],
    };
    sheet.getCell('B1').value = { formula: '1+1', result: 2 };
    sheet.getCell('C1').value = true;
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    expect(await readAll(bytes)).toEqual([
      { sheet: 'Mixed', rowNumber: 1, values: ['Fixture Town', 2, true] },
    ]);
  });

  it('a date stored as a serial number arrives as that number while styles are ignored', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Dates').getCell('A1').value = new Date(Date.UTC(2026, 0, 15));
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    // 15 January 2026 is day 46037 of Excel's 1900 date system.
    expect(await readAll(bytes)).toEqual([{ sheet: 'Dates', rowNumber: 1, values: [46037] }]);
  });

  it('a sheet whose name cannot be read throws XlsxFormatError', async () => {
    const sheetXml =
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>';
    const bytes = storedZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml) }]);
    await expect(readAll(bytes)).rejects.toThrow(XlsxFormatError);
  });
});
