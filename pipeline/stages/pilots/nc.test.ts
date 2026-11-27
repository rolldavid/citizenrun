// North Carolina's template expanded in process over the captured rows of Durham County (37063) and
// Orange County (37135) with the state's own rules module (PIPE-state-unit). Every expected value
// below is written by hand from data/templates/nc.yaml, the capture's listing rows and the published
// fixtures of the rules package.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ncRules } from '@citizenrun/rules/states/nc';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadReferenceIds } from '../shared/reference.ts';
import { repoRoot } from '../shared/repo.ts';
import { validateTemplateText } from '../../templates/validate.ts';
import {
  electionsOf,
  loadPilotUnits,
  officesOf,
  placeholderCount,
  runPilotExpansion,
  tracksOf,
} from './harness.ts';
import type { PilotRun, PilotUnits } from './harness.ts';

const TODAY = '2026-11-16';
const NOW = new Date('2026-11-16T12:00:00.000Z');
const TEMPLATE = join(repoRoot(), 'data', 'templates', 'nc.yaml');
const FIXTURE = join(repoRoot(), 'pipeline', 'stages', 'pilots', '__fixtures__', 'nc');

const DURHAM_COUNTY = 'census:171094';
const ORANGE_COUNTY = 'census:194511';
const PARTIES = ['democratic', 'green', 'libertarian', 'republican'];

let units: PilotUnits;
let run: PilotRun;

beforeAll(async () => {
  units = await loadPilotUnits(FIXTURE);
  run = await runPilotExpansion({
    templatePath: TEMPLATE,
    rules: ncRules,
    units,
    today: TODAY,
    now: NOW,
  });
}, 60_000);

function titlesAndTypes(jurisdictionKey: string): [string, string, boolean][] {
  return officesOf(run, jurisdictionKey)
    .map((o): [string, string, boolean] => [o.title, o.office_type_id, o.placeholder])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

describe('North Carolina pilot expansion', () => {
  it('the template validates with the state’s module', async () => {
    const text = await readFile(TEMPLATE, 'utf8');
    const { officeTypeIds, powerIds } = await loadReferenceIds(repoRoot());
    const result = validateTemplateText(text, {
      state: 'NC',
      officeTypeIds,
      powerIds,
      rules: ncRules,
      isFixture: false,
    });
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual([]);
  });

  it('Durham and Orange counties get their offices', () => {
    // The county type's general entries (sheriff, register of deeds, clerk of superior court) and
    // the board of commissioners entry written for Durham County only.
    expect(titlesAndTypes(DURHAM_COUNTY)).toEqual([
      ['Durham County Board of Commissioners', 'county-commission', false],
      ['Durham County Clerk of Superior Court', 'county-row-other', false],
      ['Durham County Register of Deeds', 'county-row-other', false],
      ['Durham County Sheriff', 'sheriff', false],
    ]);
    expect(titlesAndTypes(ORANGE_COUNTY)).toEqual([
      ['Orange County Clerk of Superior Court', 'county-row-other', false],
      ['Orange County Register of Deeds', 'county-row-other', false],
      ['Orange County Sheriff', 'sheriff', false],
    ]);
  });

  it('every active unit of an elected type is an office holder or a placeholder', () => {
    // The capture's thirteen census units. No listing row of the two counties is inactive.
    // Placeholders: the four municipalities (no charter entry is written for them) and the three
    // elementary and secondary school units (no local act is written). No office: Durham Technical
    // Community College (community-college type, elected: false), the Durham City Housing Authority
    // (housing-authority block), the Orange Water and Sewer Authority (water-sewer-authority block)
    // and Alliance Health (area-authority block), each of a type or block with elected: false.
    const expected: Record<string, 'offices' | 'placeholder' | 'none'> = {
      'census:171094': 'offices', // Durham County
      'census:194511': 'offices', // Orange County
      'census:208963': 'placeholder', // Durham city
      'census:171254': 'placeholder', // Carrboro town
      'census:211806': 'placeholder', // Chapel Hill town
      'census:212214': 'placeholder', // Hillsborough town
      'census:183767': 'placeholder', // Durham Public Schools
      'census:110014': 'placeholder', // Orange County Schools
      'census:202295': 'placeholder', // Chapel Hill-Carrboro Schools
      'census:121593': 'none', // Durham Technical Community College
      'census:110146': 'none', // Durham City Housing Authority
      'census:205092': 'none', // Orange Water and Sewer Authority
      'census:245154': 'none', // Alliance Health
    };
    const census = units.jurisdictions.filter((j) => j.source_key.startsWith('census:'));
    expect(census.map((j) => j.source_key).sort()).toEqual(Object.keys(expected).sort());
    expect(units.listing.filter((row) => !row.active)).toEqual([]);
    for (const [key, outcome] of Object.entries(expected)) {
      const offices = officesOf(run, key);
      if (outcome === 'none') {
        expect(offices, key).toEqual([]);
      } else if (outcome === 'placeholder') {
        expect(
          offices.map((o) => o.placeholder),
          key,
        ).toEqual([true]);
      } else {
        expect(offices.length, key).toBeGreaterThan(0);
        expect(
          offices.every((o) => !o.placeholder),
          key,
        ).toBe(true);
      }
    }
    expect(placeholderCount(run, 'city')).toBe(4);
    expect(placeholderCount(run, 'school_district')).toBe(3);
    expect(placeholderCount(run, 'special_district')).toBe(0);
    expect(placeholderCount(run, 'county')).toBe(0);
    expect(placeholderCount(run)).toBe(7);
  });

  it('special districts are placed by function', () => {
    // The three special districts of the two counties. Their functions, from the listing:
    // 50 (housing), 98 (sewerage and water supply, matched by the authority pattern) and 32 (health);
    // each block they match is elected: false, so none gets an office. No unit of the two counties
    // has function 88, the elected soil and water block, and none is left unplaced.
    const functions = Object.fromEntries(
      units.listing
        .filter((row) => row.tab === 'Special District')
        .map((row) => [row.pid6, row.function_name]),
    );
    expect(functions).toEqual({
      '110146': '50 - HOUSING AND COMMUNITY DEVELOPMENT',
      '205092': '98 - SEWERAGE AND WATER SUPPLY',
      '245154': '32 - HEALTH',
    });
    for (const pid6 of Object.keys(functions)) {
      expect(officesOf(run, `census:${pid6}`), pid6).toEqual([]);
    }
    expect(run.expand.offices.filter((o) => o.office_type_id === 'special-district-other')).toEqual(
      [],
    );
  });

  it('the 2026 contests of a county office carry the published dates', () => {
    const sheriff = officesOf(run, DURHAM_COUNTY).find((o) => o.office_type_id === 'sheriff');
    expect(sheriff).toBeDefined();
    const elections = electionsOf(run, sheriff?.slug ?? '');
    // packages/rules/src/__fixtures__/nc/2026-primary.fixtures.ts: the primary on Tuesday, March 3,
    // 2026, and filing from noon on Monday, December 1, 2025 to noon on Friday, December 19, 2025.
    const primaries = elections.filter(
      (e) => e.kind === 'primary' && e.election_date === '2026-03-03',
    );
    expect(primaries.map((e) => e.party)).toEqual(PARTIES);
    for (const primary of primaries) {
      const tracks = tracksOf(run, primary.source_key);
      expect(
        tracks.map((t) => [t.track, t.opens_on, t.closes_on, t.closes_time]),
        primary.party ?? 'null',
      ).toEqual([['party_primary', '2025-12-01', '2025-12-19', '12:00']]);
    }
    const general = elections.find((e) => e.kind === 'general' && e.election_date === '2026-11-03');
    expect(general).toBeDefined();
  });

  it('partisan offices get a party-primary and an independent track', () => {
    const partisan = run.expand.officeRefs.filter(
      (ref) => ref.partisan === true && ref.schedule !== 'nc_no_public_election',
    );
    // Four row offices of each county, the Durham board and the ten Council of State offices.
    expect(partisan.length).toBe(17);
    for (const ref of partisan) {
      const elections = electionsOf(run, ref.slug);
      const nextGeneral = elections.find((e) => e.kind === 'general' && e.election_date >= TODAY);
      expect(nextGeneral, ref.slug).toBeDefined();
      expect(
        tracksOf(run, nextGeneral?.source_key ?? '').map((t) => t.track),
        ref.slug,
      ).toContain('independent');
      const primaries = elections.filter((e) => e.kind === 'primary');
      expect(primaries.length, ref.slug).toBeGreaterThan(0);
      for (const primary of primaries) {
        expect(
          tracksOf(run, primary.source_key).map((t) => t.track),
          primary.source_key,
        ).toEqual(['party_primary']);
      }
    }
  });

  it('party committees per county and party', () => {
    // selection party_meeting (G.S. 163-99): one jurisdiction per county and party, each with the
    // county executive committee office, its party_selection set, and no election.
    const keys = run.expand.jurisdictions
      .filter((j) => j.kind === 'party')
      .map((j) => j.source_key)
      .sort();
    expect(keys).toEqual(
      ['37063', '37135'].flatMap((geoid) => PARTIES.map((party) => `party:NC:${geoid}:${party}`)),
    );
    for (const key of keys) {
      const offices = officesOf(run, key);
      expect(
        offices.map((o) => [o.office_type_id, o.party_selection]),
        key,
      ).toEqual([['party-committee', 'party_meeting']]);
      expect(electionsOf(run, offices[0]?.slug ?? ''), key).toEqual([]);
    }
  });

  it('the rules are plausible', () => {
    expect(run.deadlines.checks.find((c) => c.name === 'rules_plausible')?.passed).toBe(true);
    expect(run.deadlines.counts['ref_missing']).toBe(0);
  });
});
