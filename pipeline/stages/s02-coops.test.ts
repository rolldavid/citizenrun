import { BGeometrySchema, looksPersonal } from '@citizenrun/shared';
import type { BGeometry } from '@citizenrun/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTimezoneRegister, zoneForCoop } from '../lib/timezones.ts';
import type { TimezoneRegister } from '../lib/timezones.ts';
import { multiPolygonToWkb, toHex } from '../lib/wkb.ts';
import type { Position } from '../lib/wkb.ts';
import { eiaTerritory, eiaUtilities, resolveCounties, retailCustomers } from '../sources/eia861.ts';
import {
  FIXTURE_STATE_FIPS,
  coopsText,
  eiaFixtureFiles,
  fixtureCounties,
} from '../sources/eia861.fixtures.ts';
import { parseCoopReturn } from '../sources/irs990.ts';
import type { CoopBoard } from '../sources/irs990.ts';
import { assignState, buildCoops, matchEin, matchPublicPower, selectCoops } from './s02-coops.ts';
import type { CoopFacts, CoopReturn, CoopsInput, ServedCounty } from './s02-coops.ts';
import { fallbackGeomHash } from './base/geometry.ts';
import { fallbackRow } from './shared/geometry-rows.ts';
import { loadRelevanceDefaults } from './shared/reference.ts';
import type { RelevanceDefaults } from './shared/reference.ts';
import { repoRoot } from './shared/repo.ts';

let relevance: RelevanceDefaults;
let register: TimezoneRegister;
let savedBoard: CoopBoard;

beforeAll(async () => {
  relevance = await loadRelevanceDefaults(repoRoot());
  register = await loadTimezoneRegister();
  const board = parseCoopReturn(await coopsText('202640159349301609_public.xml'));
  if (board === 'not_990') throw new Error('the saved return is a Form 990');
  savedBoard = board;
});

function square(x: number, y: number): Position[][][] {
  return [
    [
      [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x, y],
      ],
    ],
  ];
}

function countyGeometry(geoid: string, x: number): BGeometry {
  const hex = toHex(multiPolygonToWkb(square(x, 0)));
  return BGeometrySchema.parse({
    source_key: `tiger:county:${geoid}`,
    lookup_wkb: null,
    display_wkb: hex,
    label_point: [x + 0.5, 0.5],
    outline_svg: 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z',
    outline_bbox: [x, 0, x + 1, 1],
    geom_hash: 'a'.repeat(64),
  });
}

function counties(
  list: readonly { geoid: string; population: number | null }[],
): Map<string, ServedCounty> {
  return new Map(
    list.map((c, i) => [
      c.geoid,
      {
        districtKey: `tiger:county:${c.geoid}`,
        population: c.population,
        timezone: null,
        geometry: countyGeometry(c.geoid, i),
      },
    ]),
  );
}

function returnOf(board: CoopBoard | 'not_990'): CoopReturn {
  return {
    ein: '630153273',
    objectId: '202640159349301609',
    batch: '2026_TEOS_XML_01A',
    year: 2026,
    retrievedAt: '2026-11-26T22:18:03.304Z',
    board,
  };
}

function input(coops: readonly CoopFacts[], overrides: Partial<CoopsInput> = {}): CoopsInput {
  const geoids = [...new Set(coops.flatMap((c) => c.counties))].sort();
  return {
    state: 'CO',
    today: '2026-11-26',
    now: new Date('2026-11-26T23:00:00.000Z'),
    coops,
    counties: counties(geoids.map((geoid) => ({ geoid, population: null }))),
    publicPower: [],
    relevanceDefaults: relevance,
    assignSlugs: (requests) => new Map(requests.map((r) => [r.identity, r.base])),
    fallbackRow,
    zoneForCoop: (state, served) => zoneForCoop(register, state, served),
    ...overrides,
  };
}

/** The fixture's Empire co-op (5862), with its EIA rows and its Colorado counties. */
async function empire(match: CoopFacts['match']): Promise<CoopFacts> {
  const files = await eiaFixtureFiles();
  const utility = eiaUtilities(files).find((u) => u.utilityNumber === '5862');
  if (utility === undefined) throw new Error('fixture co-op');
  const { resolved } = resolveCounties(
    eiaTerritory(files),
    await fixtureCounties(),
    FIXTURE_STATE_FIPS,
    [],
  );
  return {
    utilityNumber: utility.utilityNumber,
    name: utility.name,
    counties: resolved.get('5862') ?? [],
    customers: retailCustomers(files.salesUltCust).get('5862') ?? null,
    match,
  };
}

describe('selection and state', () => {
  it('keeps co-ops with territory and assigns the state of most served counties', async () => {
    const files = await eiaFixtureFiles();
    const utilities = eiaUtilities(files);
    const territory = new Set(eiaTerritory(files).map((t) => t.utilityNumber));
    expect(selectCoops(utilities, territory).map((u) => u.utilityNumber)).toEqual(['5086', '5862']);
    expect(selectCoops(utilities, new Set(['5086'])).map((u) => u.utilityNumber)).toEqual(['5086']);
    const fips = new Map([
      ['08', 'CO'],
      ['49', 'UT'],
    ]);
    expect(assignState({ state: 'CO' }, ['08033', '08083', '49037'], fips)).toBe('CO');
    // A tie goes to the alphabetically first state.
    expect(assignState({ state: 'ZZ' }, ['49037', '08033'], fips)).toBe('CO');
    expect(assignState({ state: 'UT' }, [], fips)).toBe('UT');
  });
});

describe('the co-op core', () => {
  it('a matched co-op gets its jurisdiction, district, fallbacks, office and roster', async () => {
    const coop = await empire({ kind: 'return', ret: returnOf(savedBoard) });
    const out = await buildCoops(input([coop]));
    expect(out.jurisdictions.map((j) => [j.source_key, j.kind, j.name, j.state])).toEqual([
      ['coop:5862', 'coop', 'Empire Electric Assn, Inc', 'CO'],
    ]);
    expect(
      out.districts.map((d) => [d.source_key, d.jurisdiction_key, d.level, d.geometry_quality]),
    ).toEqual([['county_approx:coop:5862', 'coop:5862', 'special', 'county_approx']]);
    expect(out.districtFallbacks.map((f) => f.source_key)).toEqual([
      'county_approx:coop:5862|tiger:county:08033',
      'county_approx:coop:5862|tiger:county:08083',
      'county_approx:coop:5862|tiger:county:08113',
    ]);
    expect(out.offices).toHaveLength(1);
    const office = out.offices[0];
    expect(office?.slug).toBe('co-empire-electric-assn-inc-director');
    expect(office?.title).toBe('Director');
    expect(office?.office_type_id).toBe('coop-board');
    expect(office?.partisan).toBe(false);
    expect(office?.electorate).toBe(15986 + 1308);
    expect(office?.field_meta['electorate']?.quote).toBe(
      'Utility Number 5862: Empire Electric Assn, Inc, total retail customers 17294',
    );
    expect(office?.seats_up_next).toBeNull();
    expect(out.officePowers.map((p) => [p.power_id, p.relevance, p.confidence])).toEqual([
      ['large-load-contracts', 2, 'low'],
      ['public-power-governance', 3, 'low'],
    ]);
    expect(out.people).toHaveLength(9);
    expect(
      out.people.every((p) => p.roster_only && p.source_key.startsWith('irs990:630153273:')),
    ).toBe(true);
    expect(out.people.every((p) => p.origin.datasets.join(',') === 'irs990,irs-eobmf')).toBe(true);
    expect(out.officeholders).toHaveLength(9);
    expect(out.officeholders.every((h) => h.since === null && h.office_key === office?.slug)).toBe(
      true,
    );
    expect(out.officeRefs).toEqual([
      expect.objectContaining({
        slug: office?.slug,
        identity: 'coop:5862|coop-board|county_approx:coop:5862',
        origin: 's02-coops',
        template_key: null,
        jurisdiction_kind: 'coop',
        schedule: null,
        track_set: null,
        stagger: [],
        seats: 9,
        body_size: 9,
      }),
    ]);
    expect(out.counts['matched']).toBe(1);
  });

  it('two directors with one name key on one board are one person and one officeholder', async () => {
    const first = savedBoard.directors[0];
    if (first === undefined) throw new Error('director');
    const board: CoopBoard = {
      ...savedBoard,
      directors: [first, { ...first, name: first.name.toUpperCase() }],
    };
    const out = await buildCoops(input([await empire({ kind: 'return', ret: returnOf(board) })]));
    expect(out.people).toHaveLength(1);
    expect(out.officeholders).toHaveLength(1);
  });

  it('members who do not elect the board give no office', async () => {
    const board: CoopBoard = { ...savedBoard, membersElect: false };
    const out = await buildCoops(input([await empire({ kind: 'return', ret: returnOf(board) })]));
    expect(out.offices).toEqual([]);
    expect(out.people).toEqual([]);
    expect(out.jurisdictions).toHaveLength(1);
    expect(out.districts).toHaveLength(1);
    expect(out.counts['board_not_member_elected']).toBe(1);
  });

  it('an unmatched co-op still appears with pay not known yet', async () => {
    const out = await buildCoops(
      input([await empire({ kind: 'unmatched', reason: 'ein_unmatched' })]),
    );
    const office = out.offices[0];
    expect(office?.seats).toBe(1);
    expect(office?.body_size).toBeNull();
    expect(office?.pay_annual_cents).toBeNull();
    expect(office?.pay_kind).toBeNull();
    expect(office?.hours_per_week).toBeNull();
    expect(Object.keys(office?.field_meta ?? {})).toEqual(['electorate']);
    expect(out.people).toEqual([]);
    expect(out.counts['ein_unmatched']).toBe(1);
  });

  it('a return that is not 501(c)(12) leaves the co-op unmatched', async () => {
    const board: CoopBoard = { ...savedBoard, is501c12: false };
    const out = await buildCoops(input([await empire({ kind: 'return', ret: returnOf(board) })]));
    expect(
      out.offices.map((o) => [o.seats, o.body_size, o.pay_annual_cents, o.hours_per_week]),
    ).toEqual([[1, null, null, null]]);
    expect(out.people).toEqual([]);
    expect(out.counts['not_501c12']).toBe(1);
    expect(out.counts['matched']).toBe(0);
  });

  it('a file that is not a Form 990 leaves the co-op unmatched', async () => {
    const out = await buildCoops(
      input([await empire({ kind: 'return', ret: returnOf('not_990') })]),
    );
    expect(out.offices[0]?.body_size).toBeNull();
    expect(out.counts['not_990']).toBe(1);
  });

  it('a median of zero pay is no pay', async () => {
    const board: CoopBoard = {
      ...savedBoard,
      directors: savedBoard.directors.map((d) => ({ ...d, comp: 0, other: 0 })),
    };
    const out = await buildCoops(input([await empire({ kind: 'return', ret: returnOf(board) })]));
    expect(out.offices.map((o) => [o.pay_annual_cents, o.pay_amount_cents, o.pay_kind])).toEqual([
      [0, 0, 'none'],
    ]);
  });

  it('an even board takes the mean of the two middle directors', async () => {
    const board: CoopBoard = { ...savedBoard, directors: savedBoard.directors.slice(0, 4) };
    // 17030 30884 17213 10810 sorted: 10810 [17030 17213] 30884; hours 11 11 10 10: [10 11].
    const out = await buildCoops(input([await empire({ kind: 'return', ret: returnOf(board) })]));
    expect(out.offices[0]?.pay_annual_cents).toBe(Math.round(((17030 + 17213) * 100) / 2));
    expect(out.offices[0]?.hours_per_week).toBe(10.5);
    expect(out.offices[0]?.field_meta['pay_annual_cents']?.quote).toBe(
      '<ReportableCompFromOrgAmt>17030</ReportableCompFromOrgAmt> <OtherCompensationAmt>0</OtherCompensationAmt> <ReportableCompFromOrgAmt>17213</ReportableCompFromOrgAmt> <OtherCompensationAmt>0</OtherCompensationAmt>',
    );
  });

  it('the co-op takes the zone of its most populous served county', async () => {
    const coop: CoopFacts = {
      utilityNumber: '99999',
      name: 'Fixture Electric Cooperative',
      counties: ['48141', '48201'],
      customers: null,
      match: { kind: 'unmatched', reason: 'ein_unmatched' },
    };
    const run = (pops: [number | null, number | null]) =>
      buildCoops(
        input([coop], {
          state: 'TX',
          counties: counties([
            { geoid: '48141', population: pops[0] },
            { geoid: '48201', population: pops[1] },
          ]),
        }),
      );
    // El Paso (48141) is in Mountain time, Harris (48201) in Central.
    expect((await run([20, 10])).jurisdictions[0]?.timezone).toBe('America/Denver');
    expect((await run([10, 20])).jurisdictions[0]?.timezone).toBe('America/Chicago');
    // A null population counts as 0.
    expect((await run([null, 1])).jurisdictions[0]?.timezone).toBe('America/Chicago');
  });

  it("the district's geom_hash equals its geometry row's", async () => {
    const coop = await empire({ kind: 'unmatched', reason: 'ein_unmatched' });
    const out = await buildCoops(input([coop]));
    expect(out.geometry).toHaveLength(1);
    const row = out.geometry[0];
    expect(row?.source_key).toBe('county_approx:coop:5862');
    expect(row?.lookup_wkb).toBeNull();
    expect(row?.display_wkb).toBeNull();
    expect(row?.outline_svg).not.toBeNull();
    expect(row?.geom_hash).toBe(
      fallbackGeomHash(['tiger:county:08033', 'tiger:county:08083', 'tiger:county:08113']),
    );
    expect(out.districts[0]?.geom_hash).toBe(row?.geom_hash);
  });

  it('a co-op with no resolved county has no fallback rows', async () => {
    const coop = {
      ...(await empire({ kind: 'unmatched', reason: 'ein_unmatched' })),
      counties: [],
    };
    const out = await buildCoops(input([coop]));
    expect(out.districtFallbacks).toEqual([]);
    expect(out.districts[0]?.geom_hash).toBe(out.geometry[0]?.geom_hash);
    expect(out.geometry[0]?.outline_svg).toBeNull();
    expect(out.counts['coop_no_county']).toBe(1);
  });

  it('a served county without a stage 1 row is left out of the fallbacks and counted', async () => {
    const coop = await empire({ kind: 'unmatched', reason: 'ein_unmatched' });
    const known = counties([{ geoid: '08033', population: 1 }]);
    const out = await buildCoops(input([coop], { counties: known }));
    expect(out.districtFallbacks.map((f) => f.via_district_key)).toEqual(['tiger:county:08033']);
    expect(out.counts['county_without_base']).toBe(2);
  });

  it('no output row holds an address, phone or email', async () => {
    const out = await buildCoops(
      input([await empire({ kind: 'return', ret: returnOf(savedBoard) })], {
        publicPower: [
          {
            jurisdictionKey: 'census:999999',
            utilityNumber: '99998',
            name: 'Fixture Public Power District',
            website: 'https://power.example.test',
          },
        ],
      }),
    );
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string') strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
    };
    walk([
      out.jurisdictions,
      out.districts,
      out.districtFallbacks,
      out.geometry,
      out.offices,
      out.officePowers,
      out.people,
      out.officeholders,
      out.officeRefs,
      out.facts,
    ]);
    expect(strings.length).toBeGreaterThan(100);
    expect(strings.filter((s) => looksPersonal(s))).toEqual([]);
  });
});

describe('the EIN match', () => {
  const candidate = (ein: string, city: string) => ({
    ein,
    name: 'FIXTURE ELECTRIC COOPERATIVE',
    city,
    state: 'ZZ',
    subsection: '12',
  });
  const utility = { city: 'Fixture City', website: 'https://www.fixture-coop.example.test/about' };

  it('a candidate whose city and website both disagree is not accepted', () => {
    expect(
      matchEin({
        utility,
        candidates: [candidate('990000001', 'OTHER CITY')],
        override: undefined,
        websiteOf: () => 'www.other.example.test',
      }),
    ).toEqual({ kind: 'unmatched', reason: 'ein_unmatched' });
  });

  it('a candidate is accepted by its city or by its return website', () => {
    expect(
      matchEin({
        utility,
        candidates: [candidate('990000001', ' FIXTURE CITY ')],
        override: undefined,
        websiteOf: () => null,
      }),
    ).toEqual({ kind: 'ein', ein: '990000001' });
    expect(
      matchEin({
        utility: { ...utility, city: null },
        candidates: [candidate('990000001', 'OTHER CITY')],
        override: undefined,
        websiteOf: () => 'WWW.FIXTURE-COOP.EXAMPLE.TEST',
      }),
    ).toEqual({ kind: 'ein', ein: '990000001' });
  });

  it('two accepted candidates are ambiguous', () => {
    expect(
      matchEin({
        utility,
        candidates: [
          candidate('990000001', 'FIXTURE CITY'),
          candidate('990000002', 'FIXTURE CITY'),
        ],
        override: undefined,
        websiteOf: () => null,
      }),
    ).toEqual({ kind: 'unmatched', reason: 'ein_ambiguous' });
  });

  it('with no EIA city or website nothing is accepted', () => {
    expect(
      matchEin({
        utility: { city: null, website: null },
        candidates: [candidate('990000001', 'FIXTURE CITY')],
        override: undefined,
        websiteOf: () => 'www.fixture-coop.example.test',
      }),
    ).toEqual({ kind: 'unmatched', reason: 'ein_unmatched' });
  });

  it('an override of none leaves the co-op unmatched', () => {
    expect(
      matchEin({
        utility,
        candidates: [candidate('990000001', 'FIXTURE CITY')],
        override: { eia_utility_number: 99999, ein: 'none', reason: 'Fixture reason' },
        websiteOf: () => null,
      }),
    ).toEqual({ kind: 'unmatched', reason: 'ein_unmatched' });
    expect(
      matchEin({
        utility,
        candidates: [],
        override: { eia_utility_number: 99999, ein: '990000009', reason: 'Fixture reason' },
        websiteOf: () => null,
      }),
    ).toEqual({ kind: 'ein', ein: '990000009' });
  });
});

describe('public power', () => {
  const utility = (website: string | null) => ({
    utilityNumber: '99998',
    name: 'Fixture Public Power District',
    state: 'ZZ',
    ownership: 'political_subdivision' as const,
    city: null,
    website,
  });
  const listing = [
    {
      pid6: '999999',
      unit_name: 'FIXTURE PUBLIC POWER DISTRICT',
      tab: 'Special District' as const,
      function_name: '92 - Electric power utility',
      fips_state: '99',
    },
  ];

  it('a public power district match adds a website fact', async () => {
    const power = matchPublicPower([utility('https://power.example.test')], listing, 'ZZ', '99');
    expect(power).toMatchObject({ matched: 1, missed: 0, ambiguous: 0 });
    const out = await buildCoops(input([], { state: 'ZZ', publicPower: power.matches }));
    expect(out.facts).toEqual([
      {
        table: 'jurisdictions',
        key: 'census:999999',
        field: 'website',
        value: 'https://power.example.test',
        evidence: {
          kind: 'dataset',
          value: 'https://power.example.test',
          source_url: 'https://www.eia.gov/electricity/data/eia861/zip/f8612025.zip',
          quote: 'Utility Number 99998: Fixture Public Power District',
          rule_citation: null,
          checked_at: '2026-11-26T23:00:00.000Z',
        },
        origin: 's02-coops',
      },
    ]);
    expect(out.jurisdictions).toEqual([]);
  });

  it('a non-https website adds none', async () => {
    const power = matchPublicPower([utility('http://power.example.test')], listing, 'ZZ', '99');
    expect(power.matched).toBe(1);
    const out = await buildCoops(input([], { state: 'ZZ', publicPower: power.matches }));
    expect(out.facts).toEqual([]);
  });

  it('a district of another function or state, or two of one name, is no match', () => {
    const other = [{ ...listing[0], function_name: '91 - Water supply utility' }] as typeof listing;
    expect(matchPublicPower([utility(null)], other, 'ZZ', '99')).toMatchObject({
      matched: 0,
      missed: 1,
    });
    expect(matchPublicPower([utility(null)], listing, 'ZZ', '98')).toMatchObject({ missed: 1 });
    const twice = [...listing, { ...listing[0], pid6: '999998' }] as typeof listing;
    expect(matchPublicPower([utility(null)], twice, 'ZZ', '99')).toMatchObject({ ambiguous: 1 });
  });
});
