// EIA-861 (PIPE-coops step 1): the utilities, their ownership, the counties they serve by name and
// their retail customers, from the national 2025 zip, and the county-name rule that turns EIA's
// county names into county GEOIDs.
import type { CountyNameOverride } from '../lib/data-files.ts';
import type { RunContext } from '../lib/runner.ts';
import type { XlsxValue } from '../lib/xlsx.ts';
import { readXlsxSheets } from '../lib/xlsx.ts';
import { listZip, openZipEntry } from '../lib/zip.ts';
import { datasetTempFile, requireDatasetFile } from './dataset.ts';

export const SOURCE_IDS = ['eia861'] as const;

export const EIA_DATASET = 'eia861';
export const EIA_EDITION = '2025';
export const EIA_FILE = 'f8612025.zip';
export const EIA_URL = 'https://www.eia.gov/electricity/data/eia861/zip/f8612025.zip';

/** The member name prefixes read from the zip; the last two may be absent. */
const MEMBERS = {
  utilityData: 'Utility_Data_2025',
  shortForm: 'Short_Form_2025',
  serviceTerritory: 'Service_Territory_2025',
  salesUltCust: 'Sales_Ult_Cust_2025',
} as const;
type MemberId = keyof typeof MEMBERS;

/** How many rows from the top of a sheet may hold its header row. */
const HEADER_ROWS = 5;
const UTILITY_NUMBER = 'Utility Number';

export type SheetRow = {
  readonly sheet: string;
  readonly rowNumber: number;
  readonly values: readonly XlsxValue[];
};

/** The rows of each member read, in file order; null for a member the zip does not hold. */
export type Eia861Files = {
  readonly utilityData: readonly SheetRow[];
  readonly shortForm: readonly SheetRow[] | null;
  readonly serviceTerritory: readonly SheetRow[];
  readonly salesUltCust: readonly SheetRow[] | null;
};

export type EiaUtility = {
  readonly utilityNumber: string;
  readonly name: string;
  readonly state: string;
  readonly ownership: 'cooperative' | 'political_subdivision' | 'other';
  readonly city: string | null;
  readonly website: string | null;
};

export type EiaTerritory = {
  readonly utilityNumber: string;
  readonly state: string;
  readonly county: string;
};

/** A sheet with no `Utility Number` header in its first rows, or a required member that is absent. */
export class EiaHeaderError extends Error {
  override readonly name = 'EiaHeaderError';
}

// ---------------------------------------------------------------------------------------------
// Reading the zip

function memberName(names: readonly string[], prefix: string): string | null {
  return names.find((name) => name.startsWith(prefix) && name.endsWith('.xlsx')) ?? null;
}

async function readMember(path: string, entry: string): Promise<SheetRow[]> {
  const rows: SheetRow[] = [];
  for await (const row of readXlsxSheets(await openZipEntry(path, entry), {})) {
    rows.push(row);
  }
  return rows;
}

/** Reads the members of the stored zip at `zipKey`; throws EiaHeaderError for a missing one. */
export async function readEia861Zip(ctx: RunContext, zipKey: string): Promise<Eia861Files> {
  const temp = await datasetTempFile(ctx, zipKey, '.zip');
  try {
    const names = (await listZip(temp.path)).map((entry) => entry.name);
    const read = async (id: MemberId, required: boolean): Promise<SheetRow[] | null> => {
      const entry = memberName(names, MEMBERS[id]);
      if (entry === null) {
        if (required) {
          throw new EiaHeaderError(`the EIA-861 zip holds no ${MEMBERS[id]} workbook`);
        }
        return null;
      }
      return readMember(temp.path, entry);
    };
    const utilityData = await read('utilityData', true);
    const serviceTerritory = await read('serviceTerritory', true);
    const files: Eia861Files = {
      utilityData: utilityData ?? [],
      shortForm: await read('shortForm', false),
      serviceTerritory: serviceTerritory ?? [],
      salesUltCust: await read('salesUltCust', false),
    };
    for (const rows of [
      files.utilityData,
      files.shortForm,
      files.serviceTerritory,
      files.salesUltCust,
    ]) {
      if (rows !== null) {
        for (const sheet of bySheet(rows)) {
          headerIndex(sheet.rows);
        }
      }
    }
    return files;
  } finally {
    await temp.remove();
  }
}

const loaded = new WeakMap<RunContext, Promise<{ key: string; files: Eia861Files }>>();

/**
 * The national EIA-861 file of the run, downloaded or confirmed through the fetcher (or the copy
 * the edition record lists), with its four members read. Memoised per run.
 */
export function loadEia861(ctx: RunContext): Promise<{ key: string; files: Eia861Files }> {
  let found = loaded.get(ctx);
  if (found === undefined) {
    found = (async () => {
      const key = await requireDatasetFile(ctx, {
        dataset: EIA_DATASET,
        edition: EIA_EDITION,
        url: EIA_URL,
        file: EIA_FILE,
      });
      return { key, files: await readEia861Zip(ctx, key) };
    })();
    loaded.set(ctx, found);
    found.catch(() => loaded.delete(ctx));
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Sheets, headers and cells

/** The rows of each sheet, in file order. */
export function bySheet(
  rows: readonly SheetRow[],
): readonly { sheet: string; rows: readonly SheetRow[] }[] {
  const sheets: { sheet: string; rows: SheetRow[] }[] = [];
  for (const row of rows) {
    let last = sheets[sheets.length - 1];
    if (last?.sheet !== row.sheet) {
      last = { sheet: row.sheet, rows: [] };
      sheets.push(last);
    }
    last.rows.push(row);
  }
  return sheets;
}

function cellText(value: XlsxValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** The position in `rows` of the sheet's header row: the first of rows 1 to 5 holding `Utility Number`. */
export function headerIndex(rows: readonly SheetRow[]): number {
  for (let i = 0; i < rows.length && i < HEADER_ROWS; i += 1) {
    if (rows[i]?.values.some((value) => cellText(value) === UTILITY_NUMBER) === true) {
      return i;
    }
  }
  throw new EiaHeaderError(
    `the EIA-861 sheet ${rows[0]?.sheet ?? ''} has no Utility Number header`,
  );
}

function columnOf(header: readonly XlsxValue[], test: (text: string) => boolean): number {
  return header.findIndex((value) => {
    const text = cellText(value);
    return text !== null && test(text);
  });
}

const exactly = (name: string) => (text: string) => text === name;

/** A utility number as written in a cell: a whole number, or a string of digits. */
function utilityNumber(value: XlsxValue | undefined): string | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? String(value) : null;
  }
  const text = cellText(value);
  return text !== null && /^\d{1,8}$/.test(text) ? String(Number(text)) : null;
}

type Table = {
  readonly header: readonly XlsxValue[];
  readonly data: readonly SheetRow[];
  readonly sheet: string;
};

function tables(rows: readonly SheetRow[] | null): readonly Table[] {
  if (rows === null) return [];
  return bySheet(rows).map(({ sheet, rows: sheetRows }) => {
    const at = headerIndex(sheetRows);
    return { sheet, header: sheetRows[at]?.values ?? [], data: sheetRows.slice(at + 1) };
  });
}

function ownershipOf(text: string | null): EiaUtility['ownership'] {
  if (text === 'Cooperative') return 'cooperative';
  if (text === 'Political Subdivision') return 'political_subdivision';
  return 'other';
}

const CITY = (text: string) => text.toLowerCase() === 'city';
const WEBSITE = (text: string) => text.toLowerCase().includes('website');

type ColumnSource = { member: string; sheet: string; column: string };

function memberTables(files: Eia861Files): readonly { member: string; tables: readonly Table[] }[] {
  return [
    { member: MEMBERS.utilityData, tables: tables(files.utilityData) },
    { member: MEMBERS.shortForm, tables: tables(files.shortForm) },
    { member: MEMBERS.serviceTerritory, tables: tables(files.serviceTerritory) },
    { member: MEMBERS.salesUltCust, tables: tables(files.salesUltCust) },
  ];
}

function firstColumn(
  files: Eia861Files,
  test: (text: string) => boolean,
): { source: ColumnSource; values: ReadonlyMap<string, string> } | null {
  for (const { member, tables: list } of memberTables(files)) {
    for (const table of list) {
      const col = columnOf(table.header, test);
      const numberCol = columnOf(table.header, exactly(UTILITY_NUMBER));
      if (col === -1) continue;
      const values = new Map<string, string>();
      for (const row of table.data) {
        const n = utilityNumber(row.values[numberCol]);
        const text = cellText(row.values[col]);
        if (n !== null && text !== null && !values.has(n)) values.set(n, text);
      }
      return {
        source: { member, sheet: table.sheet, column: cellText(table.header[col]) ?? '' },
        values,
      };
    }
  }
  return null;
}

/**
 * Which member, sheet and column the city and website were read from: the first sheet of the four
 * members whose header holds `City`, and one whose header contains `Website`; null when none does.
 */
export function eiaColumnSources(files: Eia861Files): {
  city: string | null;
  website: string | null;
} {
  const describe = (found: ReturnType<typeof firstColumn>) =>
    found === null ? null : `${found.source.member}/${found.source.sheet}/${found.source.column}`;
  return {
    city: describe(firstColumn(files, CITY)),
    website: describe(firstColumn(files, WEBSITE)),
  };
}

/**
 * One utility per Utility Number, from `Utility_Data` (`Ownership Type`) and then `Short_Form`
 * (`Ownership`); the first row of a number wins. City and website come from whichever member has
 * those columns, else null.
 */
export function eiaUtilities(files: Eia861Files): readonly EiaUtility[] {
  const city = firstColumn(files, CITY)?.values ?? new Map<string, string>();
  const website = firstColumn(files, WEBSITE)?.values ?? new Map<string, string>();
  const out = new Map<string, EiaUtility>();
  const read = (list: readonly Table[], ownershipHeader: string) => {
    for (const table of list) {
      const numberCol = columnOf(table.header, exactly(UTILITY_NUMBER));
      const nameCol = columnOf(table.header, exactly('Utility Name'));
      const stateCol = columnOf(table.header, exactly('State'));
      const ownershipCol = columnOf(table.header, exactly(ownershipHeader));
      for (const row of table.data) {
        const n = utilityNumber(row.values[numberCol]);
        const name = cellText(row.values[nameCol]);
        const state = cellText(row.values[stateCol]);
        if (n === null || name === null || state === null || out.has(n)) continue;
        out.set(n, {
          utilityNumber: n,
          name,
          state: state.toUpperCase(),
          ownership: ownershipOf(ownershipCol === -1 ? null : cellText(row.values[ownershipCol])),
          city: city.get(n) ?? null,
          website: website.get(n) ?? null,
        });
      }
    }
  };
  read(tables(files.utilityData), 'Ownership Type');
  read(tables(files.shortForm), 'Ownership');
  return [...out.values()];
}

/** Every `Service_Territory` row: the utility, the state and the county name as EIA writes it. */
export function eiaTerritory(files: Eia861Files): readonly EiaTerritory[] {
  const out: EiaTerritory[] = [];
  for (const table of tables(files.serviceTerritory)) {
    const numberCol = columnOf(table.header, exactly(UTILITY_NUMBER));
    const stateCol = columnOf(table.header, exactly('State'));
    const countyCol = columnOf(table.header, exactly('County'));
    for (const row of table.data) {
      const n = utilityNumber(row.values[numberCol]);
      const state = cellText(row.values[stateCol]);
      const county = cellText(row.values[countyCol]);
      if (n !== null && state !== null && county !== null) {
        out.push({ utilityNumber: n, state: state.toUpperCase(), county });
      }
    }
  }
  return out;
}

/**
 * The column of a sheet's TOTAL customers: the cell `TOTAL` in a row above the header marks the
 * group, which runs to the next labelled cell of that row; the group's column headed `Customers`
 * (or, failing that, `Count`) below it is the one. -1 when the sheet has none.
 */
function totalCustomersColumn(rows: readonly SheetRow[]): number {
  const at = headerIndex(rows);
  for (let r = 0; r < at; r += 1) {
    const group = rows[r]?.values ?? [];
    const start = group.findIndex((value) => cellText(value) === 'TOTAL');
    if (start === -1) continue;
    let end = group.length;
    for (let c = start + 1; c < group.length; c += 1) {
      if (cellText(group[c]) !== null) {
        end = c;
        break;
      }
    }
    const width = Math.max(end, ...rows.slice(r + 1, at + 1).map((row) => row.values.length));
    for (const label of ['Customers', 'Count']) {
      for (let c = start; c < width; c += 1) {
        if (rows.slice(r + 1, at + 1).some((row) => cellText(row.values[c]) === label)) {
          return c;
        }
      }
    }
  }
  return -1;
}

/** True when some sheet of the customers file has its TOTAL customers column. */
export function customersReadable(rows: readonly SheetRow[] | null): boolean {
  if (rows === null) return false;
  return bySheet(rows).some((sheet) => totalCustomersColumn(sheet.rows) !== -1);
}

/**
 * The TOTAL customers of each utility, summed over every row of every sheet that has the column
 * (a utility has one row per state and part); empty when the file has no such column.
 */
export function retailCustomers(rows: readonly SheetRow[] | null): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (rows === null) return out;
  for (const sheet of bySheet(rows)) {
    const col = totalCustomersColumn(sheet.rows);
    if (col === -1) continue;
    const at = headerIndex(sheet.rows);
    const numberCol = columnOf(sheet.rows[at]?.values ?? [], exactly(UTILITY_NUMBER));
    for (const row of sheet.rows.slice(at + 1)) {
      const n = utilityNumber(row.values[numberCol]);
      const count = row.values[col];
      if (n === null || typeof count !== 'number' || !Number.isInteger(count) || count < 0)
        continue;
      out.set(n, (out.get(n) ?? 0) + count);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// County names

/** Removed from the end of a name, longest first; only one is removed. */
const COUNTY_SUFFIXES = [
  ' city and borough',
  ' municipality',
  ' census area',
  ' borough',
  ' parish',
  ' county',
];

/**
 * EIA and TIGER county names in one form: lower-case; one suffix (` county`, ` parish`,
 * ` borough`, ` census area`, ` municipality`, ` city and borough`) removed from the end; `st ` and
 * `ste ` at a word start written `st. ` and `ste. `; every other punctuation character removed;
 * spaces collapsed; trimmed.
 */
export function normaliseCountyName(s: string): string {
  let text = s.toLowerCase().replace(/\s+/gu, ' ').trim();
  for (const suffix of COUNTY_SUFFIXES) {
    if (text.endsWith(suffix)) {
      text = text.slice(0, -suffix.length);
      break;
    }
  }
  text = text.replace(/(?<=^| )(ste?) /gu, '$1. ');
  return text
    .split(' ')
    .map((token) =>
      token === 'st.' || token === 'ste.' ? token : token.replace(/[^\p{L}\p{N}]/gu, ''),
    )
    .filter((token) => token !== '')
    .join(' ');
}

export type CountyAttributes = {
  readonly geoid: string;
  readonly statefp: string;
  readonly name: string;
};

/**
 * Each utility's served counties as GEOIDs (sorted, without repeats): an override entry for the
 * state and EIA name wins; otherwise the one TIGER county of that state whose normalised NAME
 * equals the normalised EIA name. Anything else, a name that matches two counties included, is
 * unresolved and listed; nothing is guessed.
 */
export function resolveCounties(
  territory: readonly EiaTerritory[],
  tigerCounties: readonly CountyAttributes[],
  stateFips: ReadonlyMap<string, string>,
  overrides: readonly CountyNameOverride[],
): {
  resolved: ReadonlyMap<string, readonly string[]>;
  unresolved: readonly { utilityNumber: string; state: string; county: string }[];
} {
  const byName = new Map<string, string[]>();
  for (const county of tigerCounties) {
    const key = `${county.statefp}|${normaliseCountyName(county.name)}`;
    const list = byName.get(key) ?? [];
    list.push(county.geoid);
    byName.set(key, list);
  }
  const sets = new Map<string, Set<string>>();
  const unresolved: { utilityNumber: string; state: string; county: string }[] = [];
  for (const row of territory) {
    const override = overrides.find((o) => o.state === row.state && o.eia_name === row.county);
    let geoids: readonly string[] | null = null;
    if (override !== undefined) {
      geoids = override.geoids;
    } else {
      const fips = stateFips.get(row.state);
      const matches =
        fips === undefined ? [] : (byName.get(`${fips}|${normaliseCountyName(row.county)}`) ?? []);
      if (matches.length === 1) geoids = matches;
    }
    if (geoids === null) {
      unresolved.push({ utilityNumber: row.utilityNumber, state: row.state, county: row.county });
      continue;
    }
    const set = sets.get(row.utilityNumber) ?? new Set<string>();
    for (const geoid of geoids) set.add(geoid);
    sets.set(row.utilityNumber, set);
  }
  const resolved = new Map<string, readonly string[]>();
  for (const [n, set] of sets) resolved.set(n, [...set].sort());
  return { resolved, unresolved };
}
