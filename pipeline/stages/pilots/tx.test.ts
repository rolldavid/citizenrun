// Texas's template expanded in process over the captured rows of Travis County (48453) and Hays
// County (48209) with the state's own rules module (PIPE-state-pilots, D-080's scope). Expected
// values are written by hand from the template, the captured listing and the published fixtures.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { txRules } from '@citizenrun/rules/states/tx';
import { beforeAll, describe, expect, it } from 'vitest';
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

const FIXTURE_DIR = join(repoRoot(), 'pipeline/stages/pilots/__fixtures__/tx');
const TEMPLATE_PATH = join(repoRoot(), 'data/templates/tx.yaml');
const TRAVIS = 'census:191593';
const HAYS = 'census:175894';
const AUSTIN = 'census:176394';
const PARTIES = ['democratic', 'republican'] as const;

// Copied by hand from packages/rules/src/__fixtures__/tx/2026-uniform.fixtures.ts (the November
// 2026 uniform election and its city and school filing window).
const NOVEMBER_2026 = '2026-11-03';
const NOVEMBER_2026_WINDOW = {
  opens_on: '2026-07-18',
  closes_on: '2026-08-17',
  closes_time: '17:00',
};
// Copied by hand from packages/rules/src/__fixtures__/tx/2026-primary.fixtures.ts.
const PRIMARY_2026 = '2026-03-03';
const RUNOFF_2026 = '2026-05-26';
const GENERAL_2026 = '2026-11-03';
const PRIMARY_2028 = '2028-03-07';

let run: PilotRun;
let units: PilotUnits;

beforeAll(async () => {
  units = await loadPilotUnits(FIXTURE_DIR);
  run = await runPilotExpansion({
    templatePath: TEMPLATE_PATH,
    rules: txRules,
    units,
    today: '2026-11-16',
    now: new Date('2026-11-16T12:00:00.000Z'),
  });
});

function typesOf(jurisdictionKey: string): string[] {
  return officesOf(run, jurisdictionKey)
    .map((o) => o.office_type_id)
    .sort();
}

describe('the Texas pilot expansion', () => {
  it('the template validates with the state module', async () => {
    const { officeTypeIds, powerIds } = await loadReferenceIds(repoRoot());
    const result = validateTemplateText(await readFile(TEMPLATE_PATH, 'utf8'), {
      state: 'TX',
      officeTypeIds,
      powerIds,
      rules: txRules,
      isFixture: false,
    });
    expect(result.ok).toBe(true);
    expect(run.template.template.special_districts).toEqual([]);
    expect(run.template.template.parties_with_primaries).toEqual([...PARTIES]);
  });

  it('the commissioners court of Travis County', () => {
    const offices = officesOf(run, TRAVIS);
    const judge = offices.filter((o) => o.office_type_id === 'county-executive');
    expect(judge.map((o) => [o.title, o.district_key, o.placeholder])).toEqual([
      ['Travis County Judge', 'tiger:county:48453', false],
    ]);
    const commissioners = offices
      .filter((o) => o.office_type_id === 'county-commission')
      .map((o) => [o.title, o.district_key, o.seats]);
    expect(commissioners).toEqual(
      [1, 2, 3, 4].map((n) => [
        `Travis County Commissioner, Precinct ${String(n)}`,
        `parent_fallback:${TRAVIS}:precinct-${String(n)}`,
        1,
      ]),
    );
    for (const [, districtKey] of commissioners) {
      const district = run.expand.districts.find((d) => d.source_key === districtKey);
      expect(district?.geometry_quality).toBe('parent_fallback');
    }
    // The row officers the template fixes for every county (the assessor-collector from 10,000).
    expect(
      offices
        .filter((o) => !['county-executive', 'county-commission'].includes(o.office_type_id))
        .map((o) => [o.office_type_id, o.title])
        .sort(),
    ).toEqual([
      ['county-assessor', 'Travis County Tax Assessor-Collector'],
      ['county-clerk', 'Travis County Clerk'],
      ['county-row-other', 'Travis County District Clerk'],
      ['sheriff', 'Travis County Sheriff'],
    ]);
    expect(offices).toHaveLength(9);
  });

  it('Hays County follows the cut rule', () => {
    // D-383's cut was not applied: every county keeps the county entries, so Hays (the 19th most
    // populous county) has Travis's offices by type and no placeholder.
    expect(typesOf(HAYS)).toEqual(typesOf(TRAVIS));
    expect(officesOf(run, HAYS).some((o) => o.placeholder)).toBe(false);
    expect(placeholderCount(run, 'county')).toBe(0);
  });

  it('special districts are placeholders', () => {
    const special = units.jurisdictions.filter((j) => j.kind === 'special_district');
    const active = special.filter((j) => j.census_active !== false);
    const inactive = special.filter((j) => j.census_active === false);
    // Counted by hand from the captured listing: 51 active in Hays, 110 in Travis; 5 and 3 inactive.
    expect(active).toHaveLength(161);
    expect(inactive).toHaveLength(8);
    for (const j of active) {
      const offices = officesOf(run, j.source_key);
      expect(offices.map((o) => [o.office_type_id, o.placeholder])).toEqual([
        ['special-district-other', true],
      ]);
      expect(electionsOf(run, offices[0]?.slug ?? '')).toEqual([]);
    }
    for (const j of inactive) {
      expect(officesOf(run, j.source_key)).toEqual([]);
    }
    expect(placeholderCount(run, 'special_district')).toBe(161);
  });

  it('the 2026 uniform elections carry the published windows', () => {
    const district1 = officesOf(run, AUSTIN).find(
      (o) => o.title === 'Austin City Council Member, District 1',
    );
    expect(district1?.partisan).toBe(false);
    const november = electionsOf(run, district1?.slug ?? '').filter(
      (e) => e.election_date === NOVEMBER_2026,
    );
    expect(november.map((e) => [e.kind, e.party])).toEqual([['general', null]]);
    const tracks = tracksOf(run, november[0]?.source_key ?? '');
    expect(tracks.map((t) => [t.track, t.opens_on, t.closes_on, t.closes_time])).toEqual([
      [
        'nonpartisan',
        NOVEMBER_2026_WINDOW.opens_on,
        NOVEMBER_2026_WINDOW.closes_on,
        NOVEMBER_2026_WINDOW.closes_time,
      ],
    ]);
  });

  it('party chairs stand on the primary ballot', () => {
    const party = run.expand.jurisdictions
      .filter((j) => j.kind === 'party')
      .map((j) => j.source_key)
      .sort();
    expect(party).toEqual([
      'party:TX:48209:democratic',
      'party:TX:48209:republican',
      'party:TX:48453:democratic',
      'party:TX:48453:republican',
    ]);
    for (const key of party) {
      const partyKey = key.split(':')[3];
      const offices = officesOf(run, key);
      expect(offices.map((o) => o.office_type_id).sort()).toEqual([
        'party-committee',
        'party-precinct-committee',
      ]);
      for (const o of offices) {
        expect(o.party_selection).toBe('primary_ballot');
        const primaries = electionsOf(run, o.slug).filter((e) => e.election_date === PRIMARY_2028);
        expect(primaries.map((e) => [e.kind, e.party])).toEqual([['primary', partyKey]]);
      }
    }
  });

  it('the 2026 primaries have their runoff', () => {
    const judge = officesOf(run, TRAVIS).find((o) => o.office_type_id === 'county-executive');
    const elections = electionsOf(run, judge?.slug ?? '');
    expect(elections.map((e) => [e.election_date, e.kind, e.party])).toEqual([
      [PRIMARY_2026, 'primary', 'democratic'],
      [PRIMARY_2026, 'primary', 'republican'],
      [RUNOFF_2026, 'primary_runoff', 'democratic'],
      [RUNOFF_2026, 'primary_runoff', 'republican'],
      [GENERAL_2026, 'general', null],
    ]);
    for (const runoff of elections.filter((e) => e.kind === 'primary_runoff')) {
      expect(runoff.turnout_class).toBe('runoff');
      expect(tracksOf(run, runoff.source_key)).toEqual([]);
    }
  });

  it('by-district seats are elected only in their own years (D-894)', () => {
    // Written by hand: the window runs from 2025-10-12 to 2029-11-15. Precincts 2 and 4 are on the
    // Secretary of State's 2026 list, Precincts 1 and 3 four years after 2024; Austin's Districts
    // 1, 3, 5, 8 and 9 are on its 2026 ballot and the other half in 2028.
    const generalsOf = (jurisdictionKey: string, title: string): string[] => {
      const office = officesOf(run, jurisdictionKey).find((o) => o.title === title);
      expect(office).toBeDefined();
      return electionsOf(run, office?.slug ?? '')
        .filter((e) => e.kind === 'general')
        .map((e) => e.election_date)
        .sort();
    };
    for (const county of [TRAVIS, HAYS]) {
      const name = county === TRAVIS ? 'Travis' : 'Hays';
      for (const n of [1, 3]) {
        expect(generalsOf(county, `${name} County Commissioner, Precinct ${String(n)}`)).toEqual([
          '2028-11-07',
        ]);
      }
      for (const n of [2, 4]) {
        expect(generalsOf(county, `${name} County Commissioner, Precinct ${String(n)}`)).toEqual([
          GENERAL_2026,
        ]);
      }
    }
    for (const n of [1, 3, 5, 8, 9]) {
      expect(generalsOf(AUSTIN, `Austin City Council Member, District ${String(n)}`)).toEqual([
        NOVEMBER_2026,
      ]);
    }
    for (const n of [2, 4, 6, 7, 10]) {
      expect(generalsOf(AUSTIN, `Austin City Council Member, District ${String(n)}`)).toEqual([
        '2028-11-07',
      ]);
    }
  });

  it('rules_plausible passed', () => {
    expect(run.deadlines.checks.find((c) => c.name === 'rules_plausible')?.passed).toBe(true);
  });
});
