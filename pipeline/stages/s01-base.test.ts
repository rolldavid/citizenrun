import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { StageOutput } from '../lib/runner.ts';
import { timezoneRegister } from '../lib/timezones.ts';
import { readXlsxSheets, writeXlsx } from '../lib/xlsx.ts';
import type { XlsxValue } from '../lib/xlsx.ts';
import { storedZip } from '../lib/zip.fixtures.ts';
import { readB01001 } from '../sources/acs.ts';
import { LISTING_FILE, LISTING_URL, readListing } from '../sources/census-gus.ts';
import type { ParsedListingRow } from '../sources/census-gus.ts';
import { s01Sample, scriptedRun } from '../sources/dataset.fixtures.ts';
import {
  approxDistrictRow,
  approxGeometryRow,
  fallbackRow,
  planApproxDistricts,
} from './base/districts.ts';
import type { ApproxUnit } from './base/districts.ts';
import { fallbackGeomHash } from './base/geometry.ts';
import type { GeometryRow } from './base/geometry.ts';
import { joinRateCheck } from './base/joins.ts';
import type { JoinResult } from './base/joins.ts';
import { stateJurisdictionRow, unitJurisdictionRow, unitTimezone } from './base/jurisdictions.ts';
import {
  MEASURED_2026_COUNTS,
  loadKnownUnitTypes,
  readCheckedListing,
  titleCaseUnitName,
  unitCountsCheck,
  unitKind,
} from './base/listing.ts';
import type { UnitCounts } from './base/listing.ts';
import { acsIndex, acsPopulation } from './base/population.ts';
import { runState, s01Base } from './s01-base.ts';

const LISTING_SAMPLE = 'census-gus/govt-units-2026-first50.xlsx';
const CHECKED_AT = '2026-11-26T12:00:00.000Z';

type Sheet = { name: string; rows: (string | number | null)[][] };

async function sampleSheets(): Promise<Sheet[]> {
  const sheets: Sheet[] = [];
  for await (const row of readXlsxSheets(
    Readable.from([Buffer.from(await s01Sample(LISTING_SAMPLE))]),
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

function setCell(sheets: Sheet[], tab: string, rowIndex: number, column: string, value: string) {
  const sheet = sheets.find((entry) => entry.name === tab);
  const header = sheet?.rows[0];
  const row = sheet?.rows[rowIndex];
  if (header === undefined || row === undefined) throw new Error('no such row');
  row[header.indexOf(column)] = value;
}

async function changedCopy(change: (sheets: Sheet[]) => void): Promise<Uint8Array> {
  const sheets = await sampleSheets();
  change(sheets);
  return writeXlsx(sheets);
}

async function rowsOf(bytes: Uint8Array): Promise<ParsedListingRow[]> {
  const rows: ParsedListingRow[] = [];
  for await (const row of readListing(Readable.from([Buffer.from(bytes)]))) rows.push(row);
  return rows;
}

const bytesStream = (bytes: Uint8Array) => Readable.from([Buffer.from(bytes)]);

const renameColumn = (sheets: Sheet[]) => {
  const header = sheets.find((sheet) => sheet.name === 'Special District')?.rows[0];
  if (header === undefined) throw new Error('no header');
  header[header.indexOf('FUNCTION_NAME')] = 'FUNCTION';
};

describe('stage 1: the listing', () => {
  it('header validation passes on the saved first 50 rows of each 2026 tab and fails on a copy with one renamed column', async () => {
    const known = await loadKnownUnitTypes();
    const good = await readCheckedListing(bytesStream(await s01Sample(LISTING_SAMPLE)), known);
    expect(good.check).toMatchObject({ name: 'listing_header', passed: true });
    expect(good.rows).toHaveLength(200);
    const bad = await readCheckedListing(bytesStream(await changedCopy(renameColumn)), known);
    expect(bad.rows).toBeNull();
    expect(bad.check.name).toBe('listing_header');
    expect(bad.check.passed).toBe(false);
    expect(bad.check.detail).toContain('Special District');
  });

  it('kinds map from UNIT_TYPE and ACTIVE N is flagged', async () => {
    const rows = await rowsOf(await s01Sample(LISTING_SAMPLE));
    const general = rows.filter((row) => row.tab === 'General Purpose').slice(0, 5);
    // The first five General Purpose rows of the saved sample, read by hand: the counties of
    // Autauga, Baldwin, Barbour, Bibb and Blount, each UNIT_TYPE "1 - COUNTY".
    expect(general.map((row) => [row.pid6, row.unit_type, unitKind(row)])).toEqual([
      ['100001', '1 - COUNTY', 'county'],
      ['160514', '1 - COUNTY', 'county'],
      ['189541', '1 - COUNTY', 'county'],
      ['183723', '1 - COUNTY', 'county'],
      ['160515', '1 - COUNTY', 'county'],
    ]);
    const firstOf = (tab: string): ParsedListingRow => {
      const found = rows.find((row) => row.tab === tab);
      if (found === undefined) throw new Error(`no ${tab} row`);
      return found;
    };
    expect(unitKind(firstOf('Special District'))).toBe('special_district');
    expect(unitKind(firstOf('School District'))).toBe('school_district');
    expect(unitKind(firstOf('DEP School Dist'))).toBe('school_district');
    expect(unitKind({ tab: 'General Purpose', unit_type: '2 - MUNICIPAL', pid6: '1' })).toBe(
      'city',
    );
    expect(unitKind({ tab: 'General Purpose', unit_type: '3-TOWNSHIP', pid6: '1' })).toBe(
      'township',
    );

    // The sample holds no inactive unit, so one row is copied with ACTIVE set to N.
    const inactive = await rowsOf(
      await changedCopy((sheets) => {
        setCell(sheets, 'General Purpose', 1, 'ACTIVE', 'N');
      }),
    );
    const autauga = inactive.find((row) => row.pid6 === '100001');
    expect(autauga?.active).toBe(false);
    if (autauga === undefined) throw new Error('no row');
    const row = unitJurisdictionRow({
      state: 'AL',
      kind: 'county',
      listed: autauga,
      name: 'Autauga County',
      parentKey: null,
      website: null,
      register: timezoneRegister([]),
      budget: null,
      label: null,
      checkedAt: CHECKED_AT,
    });
    expect(row).toMatchObject({
      source_key: 'census:100001',
      census_active: false,
      population: 61464,
      field_meta: {
        population: {
          source_url: LISTING_URL,
          quote: 'PID6 100001: COUNTY OF AUTAUGA',
          confidence: 'medium',
          checked_at: CHECKED_AT,
          population_source: 'census-gus',
          population_year: 2024,
        },
      },
    });
  });

  it('an unknown UNIT_TYPE code fails listing_header', async () => {
    const known = await loadKnownUnitTypes();
    const unknownCode = await changedCopy((sheets) => {
      setCell(sheets, 'General Purpose', 2, 'UNIT_TYPE', '7 - BOROUGH');
    });
    const read = await readCheckedListing(bytesStream(unknownCode), known);
    expect(read.rows).toBeNull();
    expect(read.check).toEqual({
      name: 'listing_header',
      passed: false,
      detail: 'unknown General Purpose UNIT_TYPE: 7 - BOROUGH',
    });
    const unknownString = await changedCopy((sheets) => {
      setCell(sheets, 'General Purpose', 2, 'UNIT_TYPE', '1 - PARISH');
    });
    expect((await readCheckedListing(bytesStream(unknownString), known)).check.passed).toBe(false);
  });

  it('titleCaseUnitName follows the fixed rule', () => {
    expect(titleCaseUnitName('ADAMS SCHOOL DISTRICT 14')).toBe('Adams School District 14');
    expect(titleCaseUnitName('TOWN OF THE PINES')).toBe('Town of the Pines');
    expect(titleCaseUnitName('SCHOOL DISTRICT NO. IV')).toBe('School District No. IV');
    expect(titleCaseUnitName('R-1 SCHOOL DIST')).toBe('R-1 School Dist');
    expect(titleCaseUnitName('THE VILLAGE OF IV, AND XX.')).toBe('The Village of IV, and XX.');
  });

  it('unit_counts passes on the measured 2026 counts and fails one off', () => {
    expect(unitCountsCheck('2026', MEASURED_2026_COUNTS, null)).toEqual({
      name: 'unit_counts',
      passed: true,
      detail:
        'county 3031, city 19489, township 16173, special_district 40511, school_district 12525, dependent_school 1323',
    });
    const oneOff = { ...MEASURED_2026_COUNTS, township: 16172 };
    const check = unitCountsCheck('2026', oneOff, null);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain('township');
  });

  it('a later edition may move 5% and no more', () => {
    const before: UnitCounts = {
      county: 1000,
      city: 1000,
      township: 1000,
      special_district: 1000,
      school_district: 1000,
      dependent_school: 1000,
    };
    expect(unitCountsCheck('2031', { ...before, city: 1050 }, before).passed).toBe(true);
    expect(unitCountsCheck('2031', { ...before, city: 950 }, before).passed).toBe(true);
    expect(unitCountsCheck('2031', { ...before, city: 1051 }, before).passed).toBe(false);
    expect(unitCountsCheck('2031', before, null).passed).toBe(false);
  });
});

describe('stage 1: joins, populations, districts and zones', () => {
  const result = (counts: JoinResult['counts']): JoinResult => ({
    joins: new Map(),
    owners: new Map(),
    shared: [],
    counts,
  });

  it('join_rate fails at 98.9% and passes at 99.0%', () => {
    const zero = { units: 0, matched: 0 };
    const at = (matched: number) =>
      joinRateCheck(
        result({
          county: { units: 1000, matched: 1000 },
          city: { units: 1000, matched },
          township: zero,
          school_district: { units: 100, matched: 80 },
        }),
      );
    expect(at(989).joinRate.passed).toBe(false);
    expect(at(989).joinRate.detail).toContain('below 99.0%: city');
    expect(at(990).joinRate.passed).toBe(true);
    // A kind with no units passes; the school rate is reported apart and never blocks.
    expect(at(990).joinRate.detail).toContain('township 0/0');
    expect(at(990).schoolRate).toEqual({
      name: 'school_join_rate',
      passed: false,
      detail: 'school_district 80/100',
    });
  });

  it('the B01001 18-and-over sum of one saved ACS row', async () => {
    const rows = [];
    for await (const row of readB01001(
      Readable.from([Buffer.from(await s01Sample('acs/b01001-dc-nc.dat'))]),
    )) {
      rows.push(row);
    }
    const url =
      'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01001.dat';
    // The same row and hand-computed values as the reader's test: total 681294; 18 and over
    // 259287 (male E007 to E025) + 294693 (female E031 to E049) = 553980.
    expect(acsPopulation(acsIndex(rows, '11'), 'county', '11001', url, CHECKED_AT)).toEqual({
      population: 681294,
      population_18: 553980,
      meta: {
        source_url: url,
        quote: 'GEO_ID 0500000US11001: B01001',
        confidence: 'medium',
        checked_at: CHECKED_AT,
        population_source: 'acs5',
        population_year: 2024,
      },
    });
    // A congressional district takes a block sum, never an ACS row.
    expect(acsPopulation(acsIndex(rows, '11'), 'cd', '1198', url, CHECKED_AT)).toBeNull();
  });

  it('approximate districts and their fallback rows', async () => {
    // Made-up ZZ units: a special district in county 99001, a dependent school system with no
    // NCES match whose parent (the county) has an exact district, and one in a county the layer lacks.
    const unit = (over: Partial<ApproxUnit> & Pick<ApproxUnit, 'pid6' | 'kind' | 'tab'>) =>
      ({
        fips_state: '99',
        fips_county: '001',
        parent_pid6: null,
        name: `Fixture unit ${over.pid6}`,
        ...over,
      }) satisfies ApproxUnit;
    const { approx, unplaced } = planApproxDistricts({
      units: [
        unit({ pid6: '990010', kind: 'county', tab: 'General Purpose' }),
        unit({ pid6: '990020', kind: 'special_district', tab: 'Special District' }),
        unit({
          pid6: '990030',
          kind: 'school_district',
          tab: 'DEP School Dist',
          parent_pid6: '990010',
        }),
        unit({ pid6: '990040', kind: 'school_district', tab: 'School District' }),
        unit({
          pid6: '990050',
          kind: 'special_district',
          tab: 'Special District',
          fips_county: '077',
        }),
      ],
      exactByPid6: new Map([['990010', 'tiger:county:99001']]),
      countyGeoids: new Set(['99001']),
    });
    expect(unplaced).toEqual(['990050']);
    expect(approx.map((district) => [district.key, district.level, district.via])).toEqual([
      ['county_approx:census:990020', 'special', 'tiger:county:99001'],
      ['parent_fallback:census:990030:all', 'local', 'tiger:county:99001'],
      ['county_approx:census:990040', 'local', 'tiger:county:99001'],
    ]);
    const [special, dependent] = approx;
    if (special === undefined || dependent === undefined) throw new Error('no district');
    expect(approxDistrictRow(special)).toEqual({
      source_key: 'county_approx:census:990020',
      jurisdiction_key: 'census:990020',
      name: 'Fixture unit 990020',
      level: 'special',
      geometry_quality: 'county_approx',
      geom_hash: fallbackGeomHash(['tiger:county:99001']),
      population: null,
      population_18: null,
      lean: null,
      lean_basis: null,
      field_meta: {},
    });
    expect(fallbackRow(special)).toEqual({
      source_key: 'county_approx:census:990020|tiger:county:99001',
      district_key: 'county_approx:census:990020',
      via_district_key: 'tiger:county:99001',
    });
    expect(approxDistrictRow(dependent).geometry_quality).toBe('parent_fallback');
    const via: GeometryRow = {
      source_key: 'tiger:county:99001',
      lookup_wkb: 'ab',
      display_wkb: 'cd',
      label_point: [-80.5, 35.5],
      outline_svg: 'M0 0L1000 0L1000 1000Z',
      outline_bbox: [0, 0, 10, 10],
      geom_hash: 'e'.repeat(64),
    };
    const square = [
      [
        [
          [-81, 35],
          [-80, 35],
          [-80, 36],
          [-81, 35],
        ] as [number, number][],
      ],
    ];
    expect(await approxGeometryRow(dependent, via, square)).toEqual({
      source_key: 'parent_fallback:census:990030:all',
      lookup_wkb: null,
      display_wkb: null,
      label_point: [-80.5, 35.5],
      outline_svg: 'M0 0L1000 0L1000 1000Z',
      outline_bbox: [0, 0, 10, 10],
      geom_hash: fallbackGeomHash(['tiger:county:99001']),
    });
  });

  it('time zones follow the register', () => {
    const register = timezoneRegister([
      {
        state: 'ZZ',
        default: 'America/Chicago',
        county_overrides: [{ county_geoid: '99002', zone: 'America/Denver' }],
        source_url: 'https://www.ecfr.gov/current/title-49/part-71',
        quote: 'A fixture quote.',
        citation: '49 CFR 71 (fixture)',
      },
    ]);
    const unit = (kind: 'county' | 'special_district', county: string | null) => ({
      kind,
      fips_state: '99',
      fips_county: county,
    });
    expect(unitTimezone(register, 'ZZ', unit('county', '001'))).toBe('America/Chicago');
    expect(unitTimezone(register, 'ZZ', unit('county', '002'))).toBe('America/Denver');
    expect(unitTimezone(register, 'ZZ', unit('special_district', '002'))).toBe('America/Denver');
    // With a county override in the state, a unit with no county code cannot be placed.
    expect(unitTimezone(register, 'ZZ', unit('special_district', null))).toBeNull();
    expect(unitTimezone(register, 'YY', unit('county', '001'))).toBeNull();
    const state = stateJurisdictionRow({
      state: 'ZZ',
      name: 'Fixture State',
      population: null,
      register,
      label: null,
      checkedAt: CHECKED_AT,
    });
    expect(state.timezone).toBe('America/Chicago');
    expect(state.field_meta['timezone']).toMatchObject({
      confidence: 'medium',
      rule_citation: '49 CFR 71 (fixture)',
    });
    expect(
      stateJurisdictionRow({
        state: 'YY',
        name: 'Other Fixture State',
        population: null,
        register,
        label: null,
        checkedAt: CHECKED_AT,
      }).timezone,
    ).toBeNull();
  });
});

describe('stage 1: the module and the state run', () => {
  it('declares its blocking checks and the 51 states', async () => {
    expect(s01Base.id).toBe('s01-base');
    expect(s01Base.blockingChecks).toEqual([
      'listing_header',
      'unit_counts',
      'join_rate',
      'geometry_valid',
    ]);
    const { ctx } = scriptedRun(() => undefined);
    const states = await s01Base.states(ctx);
    expect(states).toHaveLength(51);
    expect(states).toContain('DC');
    expect(states).not.toContain('US');
  });

  it('a listing header failure stops the state early', async () => {
    const workbook = await changedCopy(renameColumn);
    const zip = storedZip([{ name: LISTING_FILE, data: workbook }]);
    const { ctx, fetcher } = scriptedRun((url) =>
      url === LISTING_URL ? { kind: 'body', contentType: 'application/zip', body: zip } : undefined,
    );
    const out: StageOutput = {
      writeRows() {
        throw new Error('a stage that failed its listing header writes nothing');
      },
    };
    const result = await runState(ctx, 'NC', { dryRun: false, out });
    expect(result.files).toEqual([]);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ name: 'listing_header', passed: false });
    expect(fetcher.requests.map((request) => [request.mode, request.url])).toEqual([
      ['download', LISTING_URL],
    ]);
  });
});
