// The Annual Survey of School System Finances unit file, 2024 (D-311): the PID6 to NCESID
// crosswalk that joins listing school districts to TIGER school district GEOIDs.
import type { Readable } from 'node:stream';
import type { RunContext } from '../lib/runner.ts';
import { readXlsxSheets } from '../lib/xlsx.ts';
import type { XlsxValue } from '../lib/xlsx.ts';
import { ensureDatasetFile } from './dataset.ts';
import type { DatasetFileResult } from './dataset.ts';

export const SOURCE_IDS = ['school-finance'] as const;

export const SCHOOL_FINANCE_DATASET = 'school-finance';
export const SCHOOL_FINANCE_EDITION = '2024';
export const SCHOOL_FINANCE_URL =
  'https://www2.census.gov/programs-surveys/school-finances/tables/2024/secondary-education-finance/elsec24t.xlsx';
export const SCHOOL_FINANCE_FILE = 'elsec24t.xlsx';
/** The data sheet; the workbook's other sheet, File Information, is not read. */
export const SCHOOL_FINANCE_SHEET = 'elsec24t';

/** The first twelve header columns, in the file's order; the finance columns after them are not read. */
export const SCHOOL_FINANCE_HEADER = [
  'STATE',
  'PID6',
  'UNIT_TYPE',
  'FIPST',
  'NAME',
  'CONUM',
  'CSA',
  'CBSA',
  'SCHLEV',
  'NCESID',
  'YRDATA',
  'ENROLL',
] as const;

const PID6_INDEX = SCHOOL_FINANCE_HEADER.indexOf('PID6');
const NCESID_INDEX = SCHOOL_FINANCE_HEADER.indexOf('NCESID');

/** A header that differs from SCHOOL_FINANCE_HEADER, or a workbook without the data sheet. */
export class SchoolFinanceHeaderError extends Error {
  override readonly name = 'SchoolFinanceHeaderError';
}

/** A data row whose PID6 or NCESID is not a code. */
export class SchoolFinanceRowError extends Error {
  override readonly name = 'SchoolFinanceRowError';

  constructor(rowNumber: number, column: string) {
    super(`school finance row ${String(rowNumber)}: unreadable ${column}`);
  }
}

function cellText(value: XlsxValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return String(value).trim();
}

/** A numeric cell loses its leading zeros: digits are padded to the width; NCES ids may hold letters. */
function padded(value: XlsxValue | undefined, width: number, pattern: RegExp): string | null {
  const raw = cellText(value);
  if (raw === '') return null;
  if (/^\d+$/.test(raw) && raw.length <= width) return raw.padStart(width, '0');
  return pattern.test(raw) ? raw : null;
}

/** PID6 (six digits) to NCESID (seven characters); rows with an empty NCESID are skipped. */
export async function readSchoolFinance(xlsx: Readable): Promise<ReadonlyMap<string, string>> {
  const map = new Map<string, string>();
  let headed = false;
  for await (const row of readXlsxSheets(xlsx, { sheets: [SCHOOL_FINANCE_SHEET] })) {
    if (!headed) {
      SCHOOL_FINANCE_HEADER.forEach((name, i) => {
        const found = cellText(row.values[i]);
        if (found !== name) {
          throw new SchoolFinanceHeaderError(
            `school finance header column ${String(i + 1)} is ${JSON.stringify(found)}, expected ${name}`,
          );
        }
      });
      headed = true;
      continue;
    }
    if (row.values.every((value) => value === null || value === '')) {
      continue;
    }
    const pid6 = padded(row.values[PID6_INDEX], 6, /^\d{6}$/);
    if (pid6 === null) {
      throw new SchoolFinanceRowError(row.rowNumber, 'PID6');
    }
    if (cellText(row.values[NCESID_INDEX]) === '') {
      continue;
    }
    const ncesid = padded(row.values[NCESID_INDEX], 7, /^[0-9A-Z]{7}$/);
    if (ncesid === null) {
      throw new SchoolFinanceRowError(row.rowNumber, 'NCESID');
    }
    map.set(pid6, ncesid);
  }
  if (!headed) {
    throw new SchoolFinanceHeaderError(`the workbook has no ${SCHOOL_FINANCE_SHEET} sheet`);
  }
  return map;
}

/** Downloads (or confirms) `elsec24t.xlsx` into `datasets/school-finance/2024/`. */
export function ensureSchoolFinanceFile(ctx: RunContext): Promise<DatasetFileResult> {
  return ensureDatasetFile(ctx, {
    dataset: SCHOOL_FINANCE_DATASET,
    edition: SCHOOL_FINANCE_EDITION,
    url: SCHOOL_FINANCE_URL,
    file: SCHOOL_FINANCE_FILE,
    expectContentType:
      /^application\/(vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|octet-stream)\b/i,
  });
}
