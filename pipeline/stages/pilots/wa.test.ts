// Washington's pilot expansion (PIPE-state-pilots, PIPE-state-unit item 1): the template expanded
// over the captured Thurston and Mason county units with the state's own rules module. Every
// expected value below is written by hand from the template, the capture and the published
// fixtures, never computed by the code under test.
import { join } from 'node:path';
import { waRules } from '@citizenrun/rules/states/wa';
import { beforeAll, describe, expect, it } from 'vitest';
import { readTemplateFile } from '../../templates/load.ts';
import { validateTemplateText } from '../../templates/validate.ts';
import { loadReferenceIds } from '../shared/reference.ts';
import { repoRoot } from '../shared/repo.ts';
import {
  electionsOf,
  loadPilotUnits,
  officesOf,
  placeholderCount,
  runPilotExpansion,
  tracksOf,
} from './harness.ts';
import type { PilotRun, PilotUnits } from './harness.ts';

const TEMPLATE = join(repoRoot(), 'data', 'templates', 'wa.yaml');
const FIXTURE = join(repoRoot(), 'pipeline', 'stages', 'pilots', '__fixtures__', 'wa');
const TODAY = '2026-11-16';
const NOW = new Date('2026-11-16T12:00:00.000Z');

const THURSTON = 'census:176805';
const MASON = 'census:114608';

let units: PilotUnits;
let run: PilotRun;

beforeAll(async () => {
  units = await loadPilotUnits(FIXTURE);
  run = await runPilotExpansion({
    templatePath: TEMPLATE,
    rules: waRules,
    units,
    today: TODAY,
    now: NOW,
  });
}, 120_000);

/** [title, office type] of every office of a jurisdiction, by title. */
function titles(key: string): readonly (readonly [string, string])[] {
  return officesOf(run, key)
    .map((o) => [o.title, o.office_type_id] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function officesByName(name: string) {
  const unit = units.jurisdictions.find((j) => j.name === name);
  if (unit === undefined) {
    throw new Error(`no captured unit named ${name}`);
  }
  return officesOf(run, unit.source_key);
}

/** The captured units whose block is appointed (`elected: false`): no office and no placeholder. */
const NOT_ELECTED = [
  'Mason County Housing Authority', // housing-authority: RCW 35.82.040
  'Thurston County Housing Authority', // housing-authority: RCW 35.82.040
  'Timberland Regional Library District', // library-district: RCW 27.12.190
];

/** Cities and code cities: no general entry fixes their councils, and none of them has its own. */
const CITY_PLACEHOLDERS = [
  'Lacey city',
  'Olympia city',
  'Rainier city',
  'Shelton city',
  'Tenino city',
  'Tumwater city',
  'Yelm city',
];

/**
 * Special districts with no block, no matching name pattern, or (hospital districts) a block with
 * no default board size.
 */
const SPECIAL_DISTRICT_PLACEHOLDERS = [
  'Association of Washington Cities Employee Benefit Trust Health Care',
  'Association of Washington Cities Risk Management Service Agency',
  'Capital Area Regional Public Facilities District',
  'Chambers Lake Drainage District 3',
  'Coalition for Clean Water',
  'Hopkins Drainage District 2',
  'Intercity Transit Authority',
  'Law Enforcement Record Management System',
  'Lott Alliance',
  'Mason County Public Hospital District 1',
  'Mason County Public Hospital District No 2',
  'Mason County Public Transportation Benefit Authority',
  'North Mason Regional Fire Authority',
  'Olympic Region Clean Air Agency',
  'Pacific Mountain Workforce Development Council',
  'South Thurston Fire & Ems',
  'Southeast Thurston Fire Authority',
  'Thurston 911 Communications (TCOMM911)',
  'Thurston County (scott Lake) Drainage District 11',
  'Thurston County Narcotics Task Force',
  'Thurston-mason Behavioral Health Organization',
  'Washington Counties Insurance Fund',
  'Washington Counties Risk Pool',
  'Washington State Transit Insurance Pool',
  'West Mason Fire',
  'West Thurston Regional Fire Protection Authority',
];

describe('WA pilot expansion', () => {
  it("the template validates with the state's module", async () => {
    const text = await readTemplateFile(TEMPLATE);
    const { officeTypeIds, powerIds } = await loadReferenceIds(repoRoot());
    const result = validateTemplateText(text, {
      state: 'WA',
      officeTypeIds,
      powerIds,
      rules: waRules,
      isFixture: false,
    });
    expect(result.ok ? [] : result.errors.map((error) => error.path)).toEqual([]);
  });

  it("the worked example's offices come out", () => {
    expect(titles(THURSTON)).toEqual([
      ['Thurston County Assessor', 'county-assessor'],
      ['Thurston County Auditor', 'county-row-other'],
      ['Thurston County Clerk', 'county-clerk'],
      ['Thurston County Commissioner, District 1', 'county-commission'],
      ['Thurston County Commissioner, District 2', 'county-commission'],
      ['Thurston County Commissioner, District 3', 'county-commission'],
      ['Thurston County Commissioner, District 4', 'county-commission'],
      ['Thurston County Commissioner, District 5', 'county-commission'],
      ['Thurston County Prosecuting Attorney', 'district-attorney'],
      ['Thurston County Sheriff', 'sheriff'],
      ['Thurston County Treasurer', 'county-treasurer'],
    ]);
    // Mason County (69,632 people) must elect its coroner; Thurston County (302,912) may replace
    // the office with a medical examiner (RCW 36.16.030), so it has none here.
    expect(titles(MASON)).toEqual([
      ['Mason County Assessor', 'county-assessor'],
      ['Mason County Auditor', 'county-row-other'],
      ['Mason County Clerk', 'county-clerk'],
      ['Mason County Commissioner, District 1', 'county-commission'],
      ['Mason County Commissioner, District 2', 'county-commission'],
      ['Mason County Commissioner, District 3', 'county-commission'],
      ['Mason County Coroner', 'county-row-other'],
      ['Mason County Prosecuting Attorney', 'district-attorney'],
      ['Mason County Sheriff', 'sheriff'],
      ['Mason County Treasurer', 'county-treasurer'],
    ]);
    for (const key of [THURSTON, MASON]) {
      expect(officesOf(run, key).every((o) => !o.placeholder && o.partisan === true)).toBe(true);
    }
  });

  it('public utility districts get commissioners', () => {
    // Mason County's two and Thurston County's one, named from the capture (function names 99, 92
    // and 91, each named a public utility district). Three commissioner districts each (RCW
    // 54.12.010). No district's election year is cited, so no commissioner has a contest: the
    // office stands and its next election is not known yet.
    for (const name of [
      'Mason County Public Utility District 1',
      'Mason County Public Utility District 3',
      'Thurston County Public Utility District 1',
    ]) {
      const offices = officesByName(name);
      expect(offices.map((o) => [o.office_type_id, o.title, o.seats, o.placeholder])).toEqual(
        [1, 2, 3].map((n) => [
          'public-power-board',
          `${name} Commissioner, District ${String(n)}`,
          1,
          false,
        ]),
      );
      for (const office of offices) {
        expect(electionsOf(run, office.slug)).toEqual([]);
      }
    }
  });

  it('every active unit of an elected type is an office holder or a placeholder', () => {
    const census = units.jurisdictions.filter((j) => j.source_key.startsWith('census:'));
    expect(census.every((j) => j.census_active === true)).toBe(true);
    const placeholders: string[] = [];
    const none: string[] = [];
    for (const unit of census) {
      const offices = officesOf(run, unit.source_key);
      if (offices.length === 0) {
        none.push(unit.name);
      } else if (offices.some((o) => o.placeholder)) {
        expect(offices).toHaveLength(1);
        placeholders.push(unit.name);
      }
    }
    expect(none.sort()).toEqual(NOT_ELECTED);
    expect(placeholders.sort()).toEqual(
      [...CITY_PLACEHOLDERS, ...SPECIAL_DISTRICT_PLACEHOLDERS].sort(),
    );
    expect(placeholderCount(run, 'county')).toBe(0);
    expect(placeholderCount(run, 'city')).toBe(7);
    expect(placeholderCount(run, 'school_district')).toBe(0);
    expect(placeholderCount(run, 'special_district')).toBe(26);
    // The fire, water-sewer, port, park and cemetery blocks place their districts by function and name.
    expect(
      officesByName('Mason County Fire Protection District 5').map((o) => [o.title, o.seats]),
    ).toEqual([['Mason County Fire Protection District 5 Commissioner', 3]]);
    expect(
      officesByName('Hartstene Pointe Water-sewer District').map((o) => o.office_type_id),
    ).toEqual(['water-district-board']);
    expect(officesByName('Port of Grapeview').map((o) => o.title)).toEqual([
      'Port of Grapeview Commissioner, District 1',
      'Port of Grapeview Commissioner, District 2',
      'Port of Grapeview Commissioner, District 3',
    ]);
    expect(officesByName('Tanglewilde Park and Recreation District 1').map((o) => o.seats)).toEqual(
      [5],
    );
    expect(
      officesByName('Bucoda town')
        .map((o) => [o.office_type_id, o.seats])
        .sort(),
    ).toEqual([
      ['city-council', 5],
      ['city-officer', 1],
      ['mayor', 1],
    ]);
  });

  it('the 2025 local contests carry the published filing week', () => {
    const [director] = officesByName('Olympia School District');
    expect(director?.title).toBe('Olympia School District Director');
    const general = electionsOf(run, director?.slug ?? '').find(
      (e) => e.election_date === '2025-11-04' && e.kind === 'general',
    );
    expect(general).toBeDefined();
    // packages/rules/src/__fixtures__/wa/2025-general.fixtures.ts: "Candidate filing week for the
    // 2025 election cycle was held from May 5 through May 9, 2025." The 5 p.m. close is RCW 29A.24.050's.
    expect(
      tracksOf(run, general?.source_key ?? '').map((t) => [
        t.track,
        t.opens_on,
        t.closes_on,
        t.closes_time,
      ]),
    ).toEqual([['nonpartisan', '2025-05-05', '2025-05-09', '17:00']]);
  });

  it('precinct committee officers stand on the even-year primary', () => {
    const parties = run.expand.jurisdictions
      .filter((j) => j.kind === 'party')
      .map((j) => j.source_key)
      .sort();
    expect(parties).toEqual([
      'party:WA:53045:democratic',
      'party:WA:53045:republican',
      'party:WA:53067:democratic',
      'party:WA:53067:republican',
    ]);
    for (const key of parties) {
      const party = key.split(':')[3];
      const offices = officesOf(run, key);
      expect(offices.map((o) => [o.office_type_id, o.party_selection])).toEqual([
        ['party-precinct-committee', 'primary_ballot'],
      ]);
      // The first Tuesday of August 2028 (RCW 29A.04.311, RCW 29A.80.051).
      const primary = electionsOf(run, offices[0]?.slug ?? '').find(
        (e) => e.election_date === '2028-08-01',
      );
      expect(primary).toMatchObject({ kind: 'primary', party });
    }
  });

  it('no party-primary track anywhere', () => {
    expect(run.deadlines.tracks.length).toBeGreaterThan(0);
    expect(run.deadlines.tracks.filter((t) => t.track !== 'nonpartisan')).toEqual([]);
  });

  it('the rules are plausible', () => {
    expect(run.deadlines.checks.find((c) => c.name === 'rules_plausible')?.passed).toBe(true);
    expect(run.deadlines.counts['ref_missing'] ?? 0).toBe(0);
  });
});
