// Test helpers for the co-op stage: the saved samples under `__fixtures__/s02/coops/`, read and
// checked against their sidecars.
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { readXlsxSheets } from '../lib/xlsx.ts';
import { readSavedSample } from '../testing/saved-sample.ts';
import type { CountyAttributes, Eia861Files, SheetRow } from './eia861.ts';

export const COOPS_FIXTURES = join(import.meta.dirname, '..', '__fixtures__', 's02', 'coops');

/** The bytes of a saved sample under `__fixtures__/s02/coops/`, checked against its sidecar. */
export async function coopsSample(name: string): Promise<Uint8Array> {
  return (await readSavedSample(join(COOPS_FIXTURES, name))).bytes;
}

/** The text of a saved sample. */
export async function coopsText(name: string): Promise<string> {
  return Buffer.from(await coopsSample(name)).toString('utf8');
}

/** Rows of every sheet of a workbook, in file order. */
export async function workbookRows(bytes: Uint8Array): Promise<SheetRow[]> {
  const rows: SheetRow[] = [];
  for await (const row of readXlsxSheets(Readable.from(Buffer.from(bytes)), {})) {
    rows.push(row);
  }
  return rows;
}

/**
 * The saved rows of the two Colorado co-ops as the reader's files: each sheet of the sample holds
 * the rows of the source member it is named after; neither co-op is in `Short_Form_2025`.
 */
export async function eiaFixtureFiles(): Promise<Eia861Files> {
  const rows = await workbookRows(await coopsSample('eia861-co-two-coops.xlsx'));
  const sheet = (name: string) => rows.filter((row) => row.sheet === name);
  return {
    utilityData: sheet('Utility_Data_2025'),
    shortForm: null,
    serviceTerritory: sheet('Service_Territory_2025'),
    salesUltCust: sheet('Sales_Ult_Cust_2025'),
  };
}

/** The Louisiana and Colorado counties of the national 2026 county attribute table. */
export async function fixtureCounties(): Promise<readonly CountyAttributes[]> {
  const rows = JSON.parse(await coopsText('counties-la-co.json')) as {
    GEOID: string;
    STATEFP: string;
    NAME: string;
  }[];
  return rows.map((row) => ({ geoid: row.GEOID, statefp: row.STATEFP, name: row.NAME }));
}

export const FIXTURE_STATE_FIPS: ReadonlyMap<string, string> = new Map([
  ['CO', '08'],
  ['LA', '22'],
  ['UT', '49'],
]);
