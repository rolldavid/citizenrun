// The listing's checks and kinds (D-310, P8-06, P8-07): national unit counts, the kind of
// each unit, the corrections of data/unit-overrides.yaml and the name rule for unjoined units.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { UnitOverride } from '../../lib/data-files.ts';
import { repoRoot } from '../../lib/paths.ts';
import { ListingHeaderError, readListing } from '../../sources/census-gus.ts';
import type { ParsedListingRow } from '../../sources/census-gus.ts';

export type UnitKind = 'county' | 'city' | 'township' | 'special_district' | 'school_district';
export const UNIT_KINDS: readonly UnitKind[] = [
  'county',
  'city',
  'township',
  'special_district',
  'school_district',
];

/** The six national counts of the unit-count gate: the two school tabs are counted apart. */
export type CountKind = UnitKind | 'dependent_school';
export const COUNT_KINDS: readonly CountKind[] = [...UNIT_KINDS, 'dependent_school'];
export type UnitCounts = Readonly<Record<CountKind, number>>;

/** The 2026 edition's counts as measured for the 2026 edition (P8-07). */
export const MEASURED_2026_COUNTS: UnitCounts = Object.freeze({
  county: 3031,
  city: 19489,
  township: 16173,
  special_district: 40511,
  school_district: 12525,
  dependent_school: 1323,
});

/** A later edition's count may move by at most this share of the previous edition's (P8-07). */
export const UNIT_COUNT_TOLERANCE_PERCENT = 5;

/** The saved list of General Purpose `UNIT_TYPE` strings of the 2026 edition. */
export const UNIT_TYPES_FILE = 'pipeline/__fixtures__/s01/census-gus/unit-types-2026.json';

export type Check = { name: string; passed: boolean; detail: string };

/** A General Purpose row whose `UNIT_TYPE` does not begin with the code 1, 2 or 3. */
export class UnitTypeError extends Error {
  override readonly name = 'UnitTypeError';
}

/** The integer before the first space or hyphen of `UNIT_TYPE`, or null when there is none. */
export function unitTypeCode(unitType: string | null): number | null {
  if (unitType === null) {
    return null;
  }
  const head = /^(\d+)(?=[ -]|$)/.exec(unitType.trim());
  return head?.[1] === undefined ? null : Number.parseInt(head[1], 10);
}

const GENERAL_PURPOSE_KINDS: ReadonlyMap<number, UnitKind> = new Map([
  [1, 'county'],
  [2, 'city'],
  [3, 'township'],
]);

/** The unit's kind: General Purpose by its `UNIT_TYPE` code, the other tabs by the tab. */
export function unitKind(row: Pick<ParsedListingRow, 'tab' | 'unit_type' | 'pid6'>): UnitKind {
  switch (row.tab) {
    case 'General Purpose': {
      const kind = GENERAL_PURPOSE_KINDS.get(unitTypeCode(row.unit_type) ?? -1);
      if (kind === undefined) {
        throw new UnitTypeError(`PID6 ${row.pid6} has a UNIT_TYPE with no known code`);
      }
      return kind;
    }
    case 'Special District':
      return 'special_district';
    case 'School District':
    case 'DEP School Dist':
      return 'school_district';
  }
}

function countKind(row: Pick<ParsedListingRow, 'tab' | 'unit_type'>): CountKind | null {
  switch (row.tab) {
    case 'General Purpose':
      return GENERAL_PURPOSE_KINDS.get(unitTypeCode(row.unit_type) ?? -1) ?? null;
    case 'Special District':
      return 'special_district';
    case 'School District':
      return 'school_district';
    case 'DEP School Dist':
      return 'dependent_school';
  }
}

/** The national counts by kind, the dependent school systems apart from the independent ones. */
export function nationalCounts(
  rows: Iterable<Pick<ParsedListingRow, 'tab' | 'unit_type'>>,
): UnitCounts {
  const counts: Record<CountKind, number> = {
    county: 0,
    city: 0,
    township: 0,
    special_district: 0,
    school_district: 0,
    dependent_school: 0,
  };
  for (const row of rows) {
    const kind = countKind(row);
    if (kind !== null) {
      counts[kind] += 1;
    }
  }
  return counts;
}

function describeCounts(counts: UnitCounts): string {
  return COUNT_KINDS.map((kind) => `${kind} ${String(counts[kind])}`).join(', ');
}

/**
 * The blocking check `unit_counts`: the 2026 edition must hold exactly the measured counts; a later
 * edition may move each kind by at most 5% of the previous edition's count. Integer arithmetic.
 */
export function unitCountsCheck(
  edition: string,
  counts: UnitCounts,
  previousCounts: UnitCounts | null,
): Check {
  const detail = describeCounts(counts);
  if (edition === '2026') {
    const off = COUNT_KINDS.filter((kind) => counts[kind] !== MEASURED_2026_COUNTS[kind]);
    return off.length === 0
      ? { name: 'unit_counts', passed: true, detail }
      : {
          name: 'unit_counts',
          passed: false,
          detail: `${detail}; differs from the measured 2026 counts in ${off.join(', ')}`,
        };
  }
  if (previousCounts === null) {
    return {
      name: 'unit_counts',
      passed: false,
      detail: `${detail}; no previous edition to compare with`,
    };
  }
  const moved = COUNT_KINDS.filter((kind) => {
    const before = previousCounts[kind];
    const change = Math.abs(counts[kind] - before);
    return change * 100 > before * UNIT_COUNT_TOLERANCE_PERCENT;
  });
  return moved.length === 0
    ? { name: 'unit_counts', passed: true, detail }
    : {
        name: 'unit_counts',
        passed: false,
        detail: `${detail}; moved more than ${String(UNIT_COUNT_TOLERANCE_PERCENT)}% from the previous edition in ${moved.join(', ')}`,
      };
}

const UnitTypesSchema = z.array(z.string().min(1).max(200)).min(1).max(100);

/** The General Purpose `UNIT_TYPE` strings the 2026 edition holds, from the saved list. */
export async function loadKnownUnitTypes(): Promise<ReadonlySet<string>> {
  const raw: unknown = JSON.parse(await readFile(join(repoRoot(), UNIT_TYPES_FILE), 'utf8'));
  return new Set(UnitTypesSchema.parse(raw));
}

/**
 * The part of `listing_header` that reads the rows: every General Purpose `UNIT_TYPE` must be one
 * the saved list holds and begin with the code 1, 2 or 3.
 */
export function unitTypesCheck(
  rows: Iterable<Pick<ParsedListingRow, 'tab' | 'unit_type'>>,
  known: ReadonlySet<string>,
): Check {
  const unknown = new Set<string>();
  let read = 0;
  for (const row of rows) {
    if (row.tab !== 'General Purpose') {
      continue;
    }
    read += 1;
    const type = row.unit_type ?? '';
    if (!known.has(type) || !GENERAL_PURPOSE_KINDS.has(unitTypeCode(row.unit_type) ?? -1)) {
      unknown.add(type === '' ? '(empty)' : type);
    }
  }
  return unknown.size === 0
    ? {
        name: 'listing_header',
        passed: true,
        detail: `four tabs with their headers; ${String(read)} General Purpose rows of known types`,
      }
    : {
        name: 'listing_header',
        passed: false,
        detail:
          `unknown General Purpose UNIT_TYPE: ${[...unknown].sort().slice(0, 10).join(', ')}`.slice(
            0,
            2000,
          ),
      };
}

/**
 * The blocking check `listing_header` on a workbook: each tab's header row (a mismatch names the
 * tab and column) and then the General Purpose types. The rows are returned only when it passes.
 */
export async function readCheckedListing(
  workbook: Readable,
  known: ReadonlySet<string>,
): Promise<{ rows: ParsedListingRow[] | null; check: Check }> {
  const rows: ParsedListingRow[] = [];
  try {
    for await (const row of readListing(workbook)) {
      rows.push(row);
    }
  } catch (error) {
    if (!(error instanceof ListingHeaderError)) throw error;
    return {
      rows: null,
      check: { name: 'listing_header', passed: false, detail: error.message.slice(0, 2000) },
    };
  }
  const check = unitTypesCheck(rows, known);
  return { rows: check.passed ? rows : null, check };
}

/**
 * Applies data/unit-overrides.yaml by PID6: `exclude` drops the unit; `name`, `website` and
 * `fips_place` replace (D-887; the stage refuses a place code TIGER does not have).
 */
export function applyUnitOverrides(
  rows: readonly ParsedListingRow[],
  overrides: readonly UnitOverride[],
): ParsedListingRow[] {
  const byPid6 = new Map(overrides.map((row) => [row.pid6, row]));
  const out: ParsedListingRow[] = [];
  for (const row of rows) {
    const override = byPid6.get(row.pid6);
    if (override === undefined) {
      out.push(row);
      continue;
    }
    if (override.exclude === true) {
      continue;
    }
    out.push({
      ...row,
      unit_name: override.name ?? row.unit_name,
      web_address: override.website ?? row.web_address,
      fips_place: override.fips_place ?? row.fips_place,
    });
  }
  return out;
}

const SMALL_WORDS: ReadonlySet<string> = new Set([
  'of',
  'and',
  'the',
  'at',
  'in',
  'on',
  'for',
  'by',
]);
const ROMAN_NUMERALS: ReadonlySet<string> = new Set([
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
  'XIX',
  'XX',
]);

/**
 * A listing name in title case (P8-06): lower-case, split on spaces; a token holding a digit, or a
 * Roman numeral from I to XX (a trailing `.` or `,` ignored), is upper-case; `of`, `and`, `the`,
 * `at`, `in`, `on`, `for` and `by` stay lower-case unless first; every other token gets its first
 * letter upper-cased.
 */
export function titleCaseUnitName(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map((token, index) => {
      if (token === '') {
        return token;
      }
      const upper = token.toUpperCase();
      if (/\d/.test(token) || ROMAN_NUMERALS.has(upper.replace(/[.,]+$/, ''))) {
        return upper;
      }
      if (index > 0 && SMALL_WORDS.has(token)) {
        return token;
      }
      return `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
    })
    .join(' ');
}
