// Louisiana's template expanded in process over East Baton Rouge and West Baton Rouge parishes
// (PIPE-state-pilots, PIPE-state-unit item 1). Expected values are written by hand from the
// template, the capture's listing rows and the published fixtures.
import { join } from 'node:path';
import { laRules } from '@citizenrun/rules/states/la';
import type { BElection, BOffice } from '@citizenrun/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { readTemplateFile } from '../../templates/load.ts';
import { validateTemplateText } from '../../templates/validate.ts';
import { toRulesOfficeRef } from '../shared/office-ref.ts';
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

const TEMPLATE = join(repoRoot(), 'data', 'templates', 'la.yaml');
const CAPTURE = join(repoRoot(), 'pipeline', 'stages', 'pilots', '__fixtures__', 'la');
const WEST_BATON_ROUGE_PARISH = 'census:166023';
// The listing has no county unit for East Baton Rouge Parish: its consolidated government is the
// municipal unit "City-Parish of Baton Rouge-East Baton Rouge", named Baton Rouge city.
const BATON_ROUGE_CITY_PARISH = 'census:166054';
const EBR_UNION = 'county_union:LA:east-baton-rouge-parish';

let units: PilotUnits;
let run: PilotRun;

beforeAll(async () => {
  units = await loadPilotUnits(CAPTURE);
  run = await runPilotExpansion({
    templatePath: TEMPLATE,
    rules: laRules,
    units,
    today: '2026-11-16',
    now: new Date('2026-11-16T12:00:00.000Z'),
  });
}, 30_000);

function brief(offices: readonly BOffice[]) {
  return offices.map((office) => ({
    title: office.title,
    type: office.office_type_id,
    district: office.district_key,
    placeholder: office.placeholder,
  }));
}

function byTitle(jurisdictionKey: string, title: string): BOffice {
  const office = officesOf(run, jurisdictionKey).find((o) => o.title === title);
  if (office === undefined) {
    throw new Error(`no office titled ${title}`);
  }
  return office;
}

function dates(elections: readonly BElection[]) {
  return elections.map((e) => ({
    date: e.election_date,
    kind: e.kind,
    party: e.party,
    turnout: e.turnout_class,
  }));
}

describe('Louisiana pilot expansion', () => {
  it('the template validates with the state module', async () => {
    const text = await readTemplateFile(TEMPLATE);
    const ids = await loadReferenceIds(repoRoot());
    const result = validateTemplateText(text, {
      state: 'LA',
      ...ids,
      rules: laRules,
      isFixture: false,
    });
    expect(result.ok ? [] : result.errors.map((error) => error.path)).toEqual([]);
  });

  it('both parishes get their constitutional officers', () => {
    expect(brief(officesOf(run, WEST_BATON_ROUGE_PARISH))).toEqual([
      {
        title: 'West Baton Rouge Parish Assessor',
        type: 'county-assessor',
        district: 'tiger:county:22121',
        placeholder: false,
      },
      {
        title: 'West Baton Rouge Parish Clerk of Court',
        type: 'county-clerk',
        district: 'tiger:county:22121',
        placeholder: false,
      },
      {
        title: 'West Baton Rouge Parish Coroner',
        type: 'county-row-other',
        district: 'tiger:county:22121',
        placeholder: false,
      },
      {
        title: 'West Baton Rouge Parish Sheriff',
        type: 'sheriff',
        district: 'tiger:county:22121',
        placeholder: false,
      },
    ]);
    const ebr = brief(officesOf(run, BATON_ROUGE_CITY_PARISH)).filter(
      (office) => office.district === EBR_UNION,
    );
    expect(ebr).toEqual([
      {
        title: 'East Baton Rouge Parish Assessor',
        type: 'county-assessor',
        district: EBR_UNION,
        placeholder: false,
      },
      {
        title: 'East Baton Rouge Parish Clerk of Court',
        type: 'county-clerk',
        district: EBR_UNION,
        placeholder: false,
      },
      {
        title: 'East Baton Rouge Parish Coroner',
        type: 'county-row-other',
        district: EBR_UNION,
        placeholder: false,
      },
      {
        title: 'East Baton Rouge Parish Sheriff',
        type: 'sheriff',
        district: EBR_UNION,
        placeholder: false,
      },
      {
        title: 'Mayor-President of the City of Baton Rouge and Parish of East Baton Rouge',
        type: 'mayor',
        district: EBR_UNION,
        placeholder: false,
      },
    ]);
    const union = run.expand.districts.find((district) => district.source_key === EBR_UNION);
    expect(union?.jurisdiction_key).toBe('state:LA');
  });

  it('the Metropolitan Council has twelve district seats over the parish', () => {
    const council = officesOf(run, BATON_ROUGE_CITY_PARISH).filter(
      (office) => office.office_type_id === 'city-council',
    );
    expect(council.map((office) => office.title).sort()).toEqual(
      Array.from(
        { length: 12 },
        (_, i) =>
          `Metropolitan Council of the Parish of East Baton Rouge and the City of Baton Rouge, District ${String(i + 1)}`,
      ).sort(),
    );
    expect(new Set(council.map((office) => office.district_key))).toEqual(
      new Set(
        Array.from(
          { length: 12 },
          (_, i) => `parent_fallback:${BATON_ROUGE_CITY_PARISH}:district-${String(i + 1)}`,
        ),
      ),
    );
    for (const office of council) {
      expect(office.pay_amount_cents).toBe(100000);
      expect(office.pay_period).toBe('month');
    }
  });

  it('the 2027 elections are a primary that elects outright and a general', () => {
    for (const [key, title] of [
      [WEST_BATON_ROUGE_PARISH, 'West Baton Rouge Parish Sheriff'],
      [BATON_ROUGE_CITY_PARISH, 'East Baton Rouge Parish Sheriff'],
    ] as const) {
      const sheriff = byTitle(key, title);
      expect(dates(electionsOf(run, sheriff.source_key))).toEqual([
        { date: '2027-10-09', kind: 'primary', party: null, turnout: 'odd_year_statewide' },
        { date: '2027-11-20', kind: 'general', party: null, turnout: 'standalone_local' },
      ]);
      const ref = run.expand.officeRefs.find((row) => row.slug === sheriff.slug);
      if (ref === undefined) {
        throw new Error('no office ref for the sheriff');
      }
      const contests = laRules.contests({ office: toRulesOfficeRef(ref, 'LA'), year: 2027 });
      expect(contests.map((c) => [c.date, c.kind, c.party, c.electsOutright])).toEqual([
        ['2027-10-09', 'primary', null, true],
        ['2027-11-20', 'general', null, false],
      ]);
    }
  });

  it('the Public Service Commission is elected by district', () => {
    const psc = officesOf(run, 'state:LA').filter(
      (office) => office.office_type_id === 'utility-commission',
    );
    expect(brief(psc)).toEqual(
      [1, 2, 3, 4, 5].map((n) => ({
        title: `Public Service Commission, District ${String(n)}`,
        type: 'utility-commission',
        district: `parent_fallback:state:LA:district-${String(n)}`,
        placeholder: false,
      })),
    );
    const made = new Set(run.expand.districts.map((district) => district.source_key));
    for (const office of psc) {
      expect(made.has(office.district_key)).toBe(true);
    }
  });

  it('every active unit of an elected type is an office holder or a placeholder', () => {
    // No listing row of the two parishes is inactive, and no captured unit matches a block or a
    // type the template marks not elected, so every unit has an office or one placeholder.
    expect(units.listing.filter((row) => !row.active)).toEqual([]);
    for (const jurisdiction of units.jurisdictions) {
      if (!jurisdiction.source_key.startsWith('census:')) {
        continue;
      }
      const offices = officesOf(run, jurisdiction.source_key);
      expect(offices.length, jurisdiction.name).toBeGreaterThan(0);
      if (offices.some((office) => office.placeholder)) {
        expect(offices, jurisdiction.name).toHaveLength(1);
      }
    }
    // Special districts (17): the twelve crime prevention, security and development districts of
    // function 89 with the East Baton Rouge Redevelopment Authority (89), the recreation and park
    // commission (61), the school risk management agency (09), the municipal natural gas authority
    // (93) and the Capital Area Groundwater Conservation District (88): no block of the template
    // classifies them.
    expect(placeholderCount(run, 'special_district')).toBe(17);
    // School districts (5): East Baton Rouge Parish, West Baton Rouge Parish, City of Baker,
    // Zachary Community and Central Community: boards each unit sets, no general entry.
    expect(placeholderCount(run, 'school_district')).toBe(5);
    // Municipalities (7): Baker, Central, St. George and Zachary cities, Port Allen city, Addis and
    // Brusly towns: the template writes only the consolidated government's offices.
    expect(placeholderCount(run, 'city')).toBe(7);
    expect(placeholderCount(run, 'county')).toBe(0);
    expect(placeholderCount(run)).toBe(29);
  });

  it('the published 2026 qualifying dates', () => {
    // packages/rules/src/__fixtures__/la/2026-general-parish-qualifying.fixtures.ts: the 2026 fall
    // qualifying period, 5 to 7 August 2026, closing at 4:30 p.m.
    const council = byTitle(
      BATON_ROUGE_CITY_PARISH,
      'Metropolitan Council of the Parish of East Baton Rouge and the City of Baton Rouge, District 1',
    );
    const primary = electionsOf(run, council.source_key).find(
      (e) => e.election_date === '2026-11-03' && e.kind === 'primary',
    );
    if (primary === undefined) {
      throw new Error('no 2026 primary');
    }
    expect(
      tracksOf(run, primary.source_key).map((t) => [
        t.track,
        t.opens_on,
        t.closes_on,
        t.closes_time,
      ]),
    ).toEqual([['nonpartisan', '2026-08-05', '2026-08-07', '16:30']]);
    // packages/rules/src/__fixtures__/la/2026-spring.fixtures.ts: party primary qualifying for the
    // 16 May 2026 primaries opened on 11 February 2026.
    const psc = byTitle('state:LA', 'Public Service Commission, District 1');
    const partyPrimaries = electionsOf(run, psc.source_key).filter(
      (e) => e.election_date === '2026-05-16' && e.kind === 'primary',
    );
    expect(partyPrimaries.map((e) => e.party)).toEqual(['democratic', 'republican']);
    for (const e of partyPrimaries) {
      expect(tracksOf(run, e.source_key).map((t) => [t.track, t.opens_on])).toEqual([
        ['party_primary', '2026-02-11'],
      ]);
    }
  });

  it('parish executive committee members stand on the presidential preference primary', () => {
    for (const parish of ['22033', '22121']) {
      for (const party of ['democratic', 'republican'] as const) {
        const offices = officesOf(run, `party:LA:${parish}:${party}`);
        expect(offices.map((office) => [office.office_type_id, office.seats])).toEqual([
          ['party-committee', 5],
        ]);
        const office = offices[0];
        if (office === undefined) {
          throw new Error('no committee office');
        }
        expect(
          dates(electionsOf(run, office.source_key)).map((e) => [e.date, e.kind, e.party]),
        ).toEqual([['2028-03-25', 'primary', party]]);
      }
    }
  });

  it('the rules are plausible', () => {
    const plausible = run.deadlines.checks.find((check) => check.name === 'rules_plausible');
    expect(plausible?.passed).toBe(true);
    const deadlines = run.deadlines.checks.find((check) => check.name === 'deadlines');
    expect(deadlines?.detail).toMatch(/\bref_missing=0\b/);
  });
});
