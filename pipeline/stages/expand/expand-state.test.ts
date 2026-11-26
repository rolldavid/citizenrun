import { describe, expect, it } from 'vitest';
import { ZZ_BLOCKS } from '../../__fixtures__/s04/zz-blocks.ts';
import { ZZ_KNOWN_REFS } from '../../__fixtures__/s04/zz-known-refs.ts';
import { groundedOutput, zzTemplate } from '../../__fixtures__/s04/zz-template-output.ts';
import {
  ZZ_FIPS,
  ZZ_PL_URL,
  ZZ_STAGE1_CHECKED,
  ZZ_STATE,
  ZZ_STATE_NAME,
  box,
  exactGeometry,
  zzListingMap,
  zzStage1,
  zzWard2,
} from '../../__fixtures__/s04/zz-units.ts';
import type { StateTemplate } from '../../templates/schema.ts';
import { ZZ_RULES } from '../../templates/__fixtures__/zz-rules.ts';
import { registrySlugAssigner } from '../s04-expand.ts';
import { fallbackRow, unionRow } from '../shared/geometry-rows.ts';
import { loadRelevanceDefaults } from '../shared/reference.ts';
import { repoRoot } from '../shared/repo.ts';
import { expandState } from './expand-state.ts';
import type { ExpandInput, ExpandOutput } from './expand-state.ts';
import { countyBlockSums } from './population.ts';
import type { BlockSumInput } from './population.ts';
import { unitsFor } from './units.ts';
import type { ExpandUnit } from './units.ts';

const TODAY = '2026-11-16';
const NOW = new Date('2026-11-16T12:00:00.000Z');

const BLOCK_SUMS: BlockSumInput = {
  byCounty: countyBlockSums(ZZ_BLOCKS, new Set(['99001', '99003', '99007'])),
  proof: { source_url: ZZ_PL_URL, checked_at: ZZ_STAGE1_CHECKED },
};

function zzUnits(stage1 = zzStage1()): readonly ExpandUnit[] {
  return unitsFor(
    ZZ_STATE,
    stage1.jurisdictions,
    stage1.districts,
    stage1.fallbacks,
    zzListingMap(stage1.listing),
  );
}

async function input(
  overrides: Partial<ExpandInput> & { readonly templateEdit?: (t: StateTemplate) => void } = {},
): Promise<ExpandInput> {
  const stage1 = zzStage1();
  const template = structuredClone(await zzTemplate());
  overrides.templateEdit?.(template);
  const rest: Partial<ExpandInput> = { ...overrides };
  delete (rest as { templateEdit?: unknown }).templateEdit;
  return {
    template: groundedOutput(template),
    units: zzUnits(stage1),
    rules: ZZ_RULES,
    today: TODAY,
    now: NOW,
    state: ZZ_STATE,
    stateFips: ZZ_FIPS,
    stateName: ZZ_STATE_NAME,
    districts: stage1.districts,
    geometry: new Map(stage1.geometry.map((row) => [row.source_key, row])),
    knownRefs: ZZ_KNOWN_REFS,
    relevanceDefaults: await loadRelevanceDefaults(repoRoot()),
    newestRetrievedOn: null,
    assignSlugs: registrySlugAssigner(new Map()),
    geometryFns: { fallbackRow, unionRow },
    blockSums: BLOCK_SUMS,
    ...rest,
  };
}

function check(out: ExpandOutput, name: string) {
  return out.checks.find((c) => c.name === name);
}

function office(out: ExpandOutput, slug: string) {
  const found = out.offices.find((o) => o.slug === slug);
  if (found === undefined) {
    throw new Error(`no office ${slug}`);
  }
  return found;
}

type Contest = readonly [date: string, kind: string, party: string | null, turnout: string];

const PARTISAN_EVEN: readonly Contest[] = [
  ['2026-05-05', 'primary', 'democratic', 'primary'],
  ['2026-05-05', 'primary', 'republican', 'primary'],
  ['2026-11-03', 'general', null, 'midterm_general'],
  ['2028-05-02', 'primary', 'democratic', 'primary'],
  ['2028-05-02', 'primary', 'republican', 'primary'],
  ['2028-11-07', 'general', null, 'presidential_general'],
];
const NONPARTISAN_EVEN: readonly Contest[] = [
  ['2026-11-03', 'general', null, 'midterm_general'],
  ['2028-11-07', 'general', null, 'presidential_general'],
];
const LOCAL_ODD: readonly Contest[] = [
  ['2025-11-04', 'general', null, 'odd_year_general'],
  ['2027-11-02', 'general', null, 'odd_year_general'],
  ['2029-11-06', 'general', null, 'odd_year_general'],
];
const partyPrimaries = (party: string): readonly Contest[] => [
  ['2026-05-05', 'primary', party, 'primary'],
  ['2028-05-02', 'primary', party, 'primary'],
];

const PARTY_COUNTIES = [
  ['99001', 'Fixture County', 'zz-fixture-county'],
  ['99003', 'Fixture Second County', 'zz-fixture-second-county'],
  ['99005', 'Fixture Third County', 'zz-fixture-third-county'],
] as const;
const PARTIES = [
  ['democratic', 'Democratic'],
  ['republican', 'Republican'],
] as const;

describe('expandState', () => {
  it('the ZZ template over its units gives exactly the hand-written offices, districts and elections', async () => {
    const out = await expandState(await input());

    // slug, title, seats, district, placeholder, seats up next
    const offices = [
      [
        'zz-fixture-city-city-council-district-1',
        'Fixture City City Council, District 1',
        1,
        'parent_fallback:census:990002:district-1',
        false,
        1,
      ],
      [
        'zz-fixture-city-city-council-district-2',
        'Fixture City City Council, District 2',
        1,
        'parent_fallback:census:990002:district-2',
        false,
        1,
      ],
      [
        'zz-fixture-city-city-council-district-3',
        'Fixture City City Council, District 3',
        1,
        'parent_fallback:census:990002:district-3',
        false,
        1,
      ],
      [
        'zz-fixture-county-board-of-commissioners',
        'Fixture County Board of Commissioners',
        5,
        'tiger:county:99001',
        false,
        2,
      ],
      ['zz-fixture-county-sheriff', 'Fixture County Sheriff', 1, 'tiger:county:99001', false, 1],
      [
        'zz-fixture-fire-district-board-of-fire-commissioners',
        'Fixture Fire District Board of Fire Commissioners',
        3,
        'county_approx:census:990003',
        false,
        3,
      ],
      [
        'zz-fixture-library-district',
        'Fixture Library District',
        1,
        'county_approx:census:990004',
        true,
        null,
      ],
      [
        'zz-fixture-second-county-board-of-commissioners',
        'Fixture Second County Board of Commissioners',
        5,
        'tiger:county:99003',
        false,
        2,
      ],
      [
        'zz-fixture-second-county-sheriff',
        'Fixture Second County Sheriff',
        1,
        'tiger:county:99003',
        false,
        1,
      ],
      ['zz-fixture-state-governor', 'Governor', 1, 'tiger:state:99', false, 1],
      ['zz-fixture-state-state-treasurer', 'State Treasurer', 1, 'tiger:state:99', false, 1],
      [
        'zz-fixture-state-trial-judge-fixture-east-counties',
        'Trial Judge, Fixture East Counties',
        2,
        'county_union:ZZ:east',
        false,
        2,
      ],
      [
        'zz-fixture-county-democratic-party-precinct-committee-member',
        'Fixture County Democratic Party Precinct Committee Member',
        1,
        'county_approx:party:ZZ:99001:democratic',
        false,
        null,
      ],
      [
        'zz-fixture-county-republican-party-precinct-committee-member',
        'Fixture County Republican Party Precinct Committee Member',
        1,
        'county_approx:party:ZZ:99001:republican',
        false,
        null,
      ],
      [
        'zz-fixture-second-county-democratic-party-precinct-committee-member',
        'Fixture Second County Democratic Party Precinct Committee Member',
        1,
        'county_approx:party:ZZ:99003:democratic',
        false,
        null,
      ],
      [
        'zz-fixture-second-county-republican-party-precinct-committee-member',
        'Fixture Second County Republican Party Precinct Committee Member',
        1,
        'county_approx:party:ZZ:99003:republican',
        false,
        null,
      ],
      [
        'zz-fixture-third-county-democratic-party-precinct-committee-member',
        'Fixture Third County Democratic Party Precinct Committee Member',
        1,
        'county_approx:party:ZZ:99005:democratic',
        false,
        null,
      ],
      [
        'zz-fixture-third-county-republican-party-precinct-committee-member',
        'Fixture Third County Republican Party Precinct Committee Member',
        1,
        'county_approx:party:ZZ:99005:republican',
        false,
        null,
      ],
    ];
    expect(
      out.offices.map((o) => [
        o.slug,
        o.title,
        o.seats,
        o.district_key,
        o.placeholder,
        o.seats_up_next,
      ]),
    ).toEqual(
      [...offices].sort((a, b) =>
        Buffer.compare(Buffer.from(String(a[0])), Buffer.from(String(b[0]))),
      ),
    );

    // source_key, jurisdiction, name, level, quality
    const districts = [
      [
        'county_approx:party:ZZ:99001:democratic',
        'party:ZZ:99001:democratic',
        'Fixture County Democratic Party',
        'special',
        'county_approx',
      ],
      [
        'county_approx:party:ZZ:99001:republican',
        'party:ZZ:99001:republican',
        'Fixture County Republican Party',
        'special',
        'county_approx',
      ],
      [
        'county_approx:party:ZZ:99003:democratic',
        'party:ZZ:99003:democratic',
        'Fixture Second County Democratic Party',
        'special',
        'county_approx',
      ],
      [
        'county_approx:party:ZZ:99003:republican',
        'party:ZZ:99003:republican',
        'Fixture Second County Republican Party',
        'special',
        'county_approx',
      ],
      [
        'county_approx:party:ZZ:99005:democratic',
        'party:ZZ:99005:democratic',
        'Fixture Third County Democratic Party',
        'special',
        'county_approx',
      ],
      [
        'county_approx:party:ZZ:99005:republican',
        'party:ZZ:99005:republican',
        'Fixture Third County Republican Party',
        'special',
        'county_approx',
      ],
      ['county_union:ZZ:east', 'state:ZZ', 'Fixture East Counties', 'county', 'exact'],
      [
        'parent_fallback:census:990002:district-1',
        'census:990002',
        'Fixture City District 1',
        'local',
        'parent_fallback',
      ],
      [
        'parent_fallback:census:990002:district-2',
        'census:990002',
        'Fixture City District 2',
        'local',
        'parent_fallback',
      ],
      [
        'parent_fallback:census:990002:district-3',
        'census:990002',
        'Fixture City District 3',
        'local',
        'parent_fallback',
      ],
    ];
    expect(
      out.districts.map((d) => [
        d.source_key,
        d.jurisdiction_key,
        d.name,
        d.level,
        d.geometry_quality,
      ]),
    ).toEqual(districts);
    const union = out.districts.find((d) => d.source_key === 'county_union:ZZ:east');
    expect([union?.population, union?.population_18]).toEqual([350, 265]);

    expect(out.districtFallbacks.map((f) => f.source_key)).toEqual([
      'county_approx:party:ZZ:99001:democratic|tiger:county:99001',
      'county_approx:party:ZZ:99001:republican|tiger:county:99001',
      'county_approx:party:ZZ:99003:democratic|tiger:county:99003',
      'county_approx:party:ZZ:99003:republican|tiger:county:99003',
      'county_approx:party:ZZ:99005:democratic|tiger:county:99005',
      'county_approx:party:ZZ:99005:republican|tiger:county:99005',
      'parent_fallback:census:990002:district-1|tiger:place:9900100',
      'parent_fallback:census:990002:district-2|tiger:place:9900100',
      'parent_fallback:census:990002:district-3|tiger:place:9900100',
    ]);
    expect(out.geometry.map((g) => g.source_key)).toEqual(districts.map((d) => d[0]));
    for (const d of out.districts) {
      expect(out.geometry.find((g) => g.source_key === d.source_key)?.geom_hash).toBe(d.geom_hash);
    }

    const elections: [string, string, string | null, string][] = [];
    const add = (slug: string, contests: readonly Contest[]) => {
      for (const [date, kind, party, turnout] of contests) {
        elections.push([`${slug}|${date}|${kind}|${party ?? ''}`, kind, party, turnout]);
      }
    };
    for (const slug of [
      'zz-fixture-county-board-of-commissioners',
      'zz-fixture-county-sheriff',
      'zz-fixture-second-county-board-of-commissioners',
      'zz-fixture-second-county-sheriff',
      'zz-fixture-state-governor',
      'zz-fixture-state-state-treasurer',
    ]) {
      add(slug, PARTISAN_EVEN);
    }
    add('zz-fixture-state-trial-judge-fixture-east-counties', NONPARTISAN_EVEN);
    for (const n of [1, 2, 3]) {
      add(`zz-fixture-city-city-council-district-${String(n)}`, LOCAL_ODD);
    }
    add('zz-fixture-fire-district-board-of-fire-commissioners', LOCAL_ODD);
    for (const [, , prefix] of PARTY_COUNTIES) {
      for (const [party, label] of PARTIES) {
        add(
          `${prefix}-${label.toLowerCase()}-party-precinct-committee-member`,
          partyPrimaries(party),
        );
      }
    }
    add('zz-state-senator-district-1', PARTISAN_EVEN.slice(0, 3));
    add('zz-state-senator-district-2', PARTISAN_EVEN.slice(3));
    expect(elections).toHaveLength(68);
    expect(out.elections.map((e) => [e.source_key, e.kind, e.party, e.turnout_class])).toEqual(
      elections.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0]))),
    );

    expect(check(out, 'slug_unique')?.passed).toBe(true);
    expect(check(out, 'template_pattern')?.passed).toBe(true);
    expect(out.counts).toMatchObject({
      offices: 18,
      placeholder: 1,
      inactive_unit_skipped: 0,
      seats_vs_body: 0,
      stagger_by_district_unmapped: 0,
      rules_missing: 0,
      elections: 68,
      union_population_unknown: 0,
    });
    expect(check(out, 'expand')?.detail).toBe(
      'offices=18 placeholder=1 inactive_unit_skipped=0 unit_without_district=0 seats_vs_body=0 stagger_by_district_unmapped=0 rules_missing=0 elections=68 union_population_unknown=0',
    );
  });

  it("a county union's population is the sum of its counties' blocks", async () => {
    const out = await expandState(await input());
    const union = out.districts.find((d) => d.source_key === 'county_union:ZZ:east');
    const meta = {
      source_url: 'https://example.test/zz/pl94171.zip',
      quote: 'blocks covered: 3',
      confidence: 'medium',
      checked_at: '2026-11-01T00:00:00.000Z',
      population_source: 'pl94171-block-sum',
      population_year: 2020,
    };
    expect(union?.population).toBe(350);
    expect(union?.population_18).toBe(265);
    expect(union?.field_meta['population']).toEqual(meta);
    expect(union?.field_meta['population_18']).toEqual(meta);
    expect(union?.field_meta['name']).toMatchObject({ rule_citation: 'ZZ Fixture Code 15' });
    const judge = out.officeRefs.find((r) => r.template_key === 'trial-judge-east');
    expect(judge?.population).toBe(350);
  });

  it('a county union naming a county with no block keeps its population null', async () => {
    const stage1 = zzStage1();
    const geometry = new Map(stage1.geometry.map((row) => [row.source_key, row]));
    geometry.set('tiger:county:99007', exactGeometry('tiger:county:99007', box(-77, 35, -76, 36)));
    const narrowed = (t: StateTemplate) => {
      const set = t.county_sets[0];
      if (set !== undefined) {
        set.counties = ['99001', '99007'];
      }
    };
    const out = await expandState(await input({ geometry, templateEdit: narrowed }));
    const union = out.districts.find((d) => d.source_key === 'county_union:ZZ:east');
    expect([union?.population, union?.population_18]).toEqual([null, null]);
    expect(union?.field_meta['population']).toBeUndefined();
    expect(union?.field_meta['population_18']).toBeUndefined();
    expect(out.counts['union_population_unknown']).toBe(1);

    const withoutSums: { -readonly [K in keyof ExpandInput]: ExpandInput[K] } = {
      ...(await input()),
    };
    delete withoutSums.blockSums;
    const absent = await expandState(withoutSums);
    const unknown = absent.districts.find((d) => d.source_key === 'county_union:ZZ:east');
    expect([unknown?.population, unknown?.population_18]).toEqual([null, null]);
    expect(absent.counts['union_population_unknown']).toBe(1);
  });

  it('an unmatched special district gets a placeholder', async () => {
    const out = await expandState(await input());
    const library = office(out, 'zz-fixture-library-district');
    expect(library).toMatchObject({
      placeholder: true,
      office_type_id: 'special-district-other',
      title: 'Fixture Library District',
      jurisdiction_key: 'census:990004',
      seats: 1,
      body_size: null,
      term_years: null,
      partisan: null,
      pay_annual_cents: null,
      pay_kind: null,
      seats_up_next: null,
      field_meta: {},
    });
    expect(out.officePowers.filter((p) => p.office_key === library.slug)).toEqual([]);
    expect(out.elections.filter((e) => e.office_key === library.slug)).toEqual([]);
    const ref = out.officeRefs.find((r) => r.slug === library.slug);
    expect(ref).toMatchObject({ schedule: null, track_set: null, template_key: null });
  });

  it('a type marked elected false creates nothing', async () => {
    const out = await expandState(await input());
    const keys = new Set(out.offices.map((o) => o.jurisdiction_key));
    expect(keys.has('census:990005')).toBe(false);
    expect(keys.has('census:990006')).toBe(false);
  });

  it('a by-district council uses parent fallback districts without ward layers', async () => {
    const out = await expandState(await input());
    const council = out.offices.filter((o) => o.office_type_id === 'city-council');
    expect(council.map((o) => o.district_key)).toEqual([
      'parent_fallback:census:990002:district-1',
      'parent_fallback:census:990002:district-2',
      'parent_fallback:census:990002:district-3',
    ]);
    for (const o of council) {
      expect(out.districtFallbacks.filter((f) => f.district_key === o.district_key)).toEqual([
        {
          source_key: `${o.district_key}|tiger:place:9900100`,
          district_key: o.district_key,
          via_district_key: 'tiger:place:9900100',
        },
      ]);
    }

    const stage1 = zzStage1();
    const ward = zzWard2();
    const withWard = await expandState(
      await input({
        districts: [...stage1.districts, ward.district],
        geometry: new Map([...stage1.geometry, ward.geometry].map((row) => [row.source_key, row])),
      }),
    );
    expect(
      withWard.offices
        .filter((o) => o.office_type_id === 'city-council')
        .map((o) => o.district_key),
    ).toEqual([
      'parent_fallback:census:990002:district-1',
      'ward:9900100:district-2',
      'parent_fallback:census:990002:district-3',
    ]);
    expect(
      withWard.districts.some((d) => d.source_key === 'parent_fallback:census:990002:district-2'),
    ).toBe(false);
  });

  it('county pay comes from the rules', async () => {
    const out = await expandState(await input());
    const commission = office(out, 'zz-fixture-county-board-of-commissioners');
    expect(commission).toMatchObject({
      pay_kind: 'salary',
      pay_amount_cents: 4_500_000,
      pay_period: 'year',
      pay_annual_cents: 4_500_000,
    });
    expect(commission.field_meta['pay_annual_cents']).toMatchObject({
      rule_citation: 'ZZ Fixture Code 118',
      source_url: 'https://example.test/zz/code',
      checked_at: NOW.toISOString(),
    });
    expect(out.officeRefs.find((r) => r.slug === commission.slug)?.pay_annual_cents).toBe(
      4_500_000,
    );
    const sheriff = office(out, 'zz-fixture-county-sheriff');
    expect(sheriff).toMatchObject({ pay_kind: 'salary', pay_annual_cents: 8_000_000 });
    expect(sheriff.field_meta['pay_annual_cents']).toMatchObject({
      rule_citation: 'ZZ Fixture Code 7',
    });
    const council = office(out, 'zz-fixture-city-city-council-district-1');
    expect([council.pay_kind, council.pay_annual_cents]).toEqual([null, null]);
  });

  it("the staggered commission's seats up next is 2 in 2028", async () => {
    const out = await expandState(await input());
    expect(office(out, 'zz-fixture-county-board-of-commissioners').seats_up_next).toBe(2);
    const generals = out.elections
      .filter(
        (e) => e.office_key === 'zz-fixture-county-board-of-commissioners' && e.kind === 'general',
      )
      .map((e) => e.election_date);
    expect(generals).toEqual(['2026-11-03', '2028-11-07']);
  });

  it('seats up next above body size becomes null', async () => {
    const out = await expandState(
      await input({
        templateEdit: (t) => {
          const fire = t.special_districts[0]?.offices[0];
          if (fire !== undefined) {
            fire.body_size = {
              value: 2,
              source_url: 'https://example.test/zz/code',
              quote: 'Fixture text: fire commissioners serve terms of four years.',
              citation: 'ZZ Fixture Code 21',
            };
          }
        },
      }),
    );
    const fire = office(out, 'zz-fixture-fire-district-board-of-fire-commissioners');
    expect(fire.body_size).toBe(2);
    expect(fire.seats_up_next).toBeNull();
    expect(out.counts['seats_vs_body']).toBe(1);
  });

  it('an inactive unit gets no office', async () => {
    const units = zzUnits().map((u) =>
      u.key === 'census:990002' ? { ...u, censusActive: false } : u,
    );
    const out = await expandState(await input({ units }));
    expect(out.offices.filter((o) => o.jurisdiction_key === 'census:990002')).toEqual([]);
    expect(out.districts.filter((d) => d.jurisdiction_key === 'census:990002')).toEqual([]);
    expect(out.counts['inactive_unit_skipped']).toBe(1);
    expect(out.counts['placeholder']).toBe(1);
  });

  it('applies_to narrows by name and population', async () => {
    const out = await expandState(
      await input({
        templateEdit: (t) => {
          const [commission, sheriff] = t.government_types[0]?.offices ?? [];
          if (commission !== undefined && sheriff !== undefined) {
            commission.applies_to = {
              name_pattern: null,
              population_min: 4000,
              population_max: null,
            };
            sheriff.applies_to = {
              name_pattern: '^FIXTURE SECOND',
              population_min: null,
              population_max: null,
            };
          }
        },
      }),
    );
    const byUnit = (key: string) =>
      out.offices.filter((o) => o.jurisdiction_key === key).map((o) => o.slug);
    expect(byUnit('census:990001')).toEqual(['zz-fixture-county-board-of-commissioners']);
    expect(byUnit('census:990007')).toEqual(['zz-fixture-second-county-sheriff']);

    const narrowed = await expandState(
      await input({
        templateEdit: (t) => {
          for (const entry of t.government_types[0]?.offices ?? []) {
            entry.applies_to = {
              name_pattern: '^fixture second county$',
              population_min: null,
              population_max: null,
            };
          }
        },
      }),
    );
    const placeholders = narrowed.offices.filter((o) => o.jurisdiction_key === 'census:990001');
    expect(placeholders.map((o) => [o.title, o.office_type_id, o.placeholder])).toEqual([
      ['Fixture County', 'county-commission', true],
    ]);
    expect(narrowed.offices.filter((o) => o.jurisdiction_key === 'census:990007')).toHaveLength(2);
    expect(narrowed.counts['placeholder']).toBe(2);
  });

  it('party committees are made per county and party with their selection proof', async () => {
    const out = await expandState(await input());
    const expected = PARTY_COUNTIES.flatMap(([geoid, county]) =>
      PARTIES.map(([party, label]) => [`party:ZZ:${geoid}:${party}`, `${county} ${label} Party`]),
    );
    expect(out.jurisdictions.map((j) => [j.source_key, j.name])).toEqual(expected);
    expect(
      out.jurisdictions.every((j) => j.kind === 'party' && j.state === 'ZZ' && j.timezone === null),
    ).toBe(true);
    for (const [key] of expected) {
      const districtKey = `county_approx:${String(key)}`;
      const geoid = String(key).split(':')[2] ?? '';
      expect(out.districts.find((d) => d.source_key === districtKey)?.jurisdiction_key).toBe(key);
      expect(
        out.districtFallbacks.find((f) => f.district_key === districtKey)?.via_district_key,
      ).toBe(`tiger:county:${geoid}`);
      expect(out.geometry.some((g) => g.source_key === districtKey)).toBe(true);
    }
    const committees = out.offices.filter((o) => o.office_type_id === 'party-precinct-committee');
    expect(committees).toHaveLength(6);
    for (const o of committees) {
      expect(o.party_selection).toBe('primary_ballot');
      expect(o.field_meta['party_selection']).toMatchObject({
        rule_citation: 'ZZ Fixture Code 24',
        source_url: 'https://example.test/zz/code',
        confidence: 'medium',
      });
      const ref = out.officeRefs.find((r) => r.slug === o.slug);
      const elections = out.elections.filter((e) => e.office_key === o.slug);
      expect(elections.map((e) => e.kind)).toEqual(['primary', 'primary']);
      expect(elections.every((e) => e.party === ref?.party)).toBe(true);
    }
    const zone = await expandState(await input({ countyZone: () => 'America/New_York' }));
    expect(zone.jurisdictions.every((j) => j.timezone === 'America/New_York')).toBe(true);
  });

  it('a county with no county unit in the listing gets its party jurisdictions and offices', async () => {
    const out = await expandState(await input());
    for (const party of ['democratic', 'republican']) {
      const key = `party:ZZ:99005:${party}`;
      expect(out.jurisdictions.some((j) => j.source_key === key)).toBe(true);
      expect(out.districts.some((d) => d.source_key === `county_approx:${key}`)).toBe(true);
      const offices = out.offices.filter((o) => o.jurisdiction_key === key);
      expect(offices).toHaveLength(1);
      expect(out.elections.filter((e) => e.office_key === offices[0]?.slug)).toHaveLength(2);
    }

    const units = zzUnits().map((u) =>
      u.key === 'census:990001' ? { ...u, censusActive: false } : u,
    );
    const inactive = await expandState(await input({ units }));
    expect(inactive.offices.filter((o) => o.jurisdiction_key === 'census:990001')).toEqual([]);
    for (const party of ['democratic', 'republican']) {
      expect(
        inactive.offices.filter((o) => o.jurisdiction_key === `party:ZZ:99001:${party}`),
      ).toHaveLength(1);
    }
  });

  it('caucus selection makes offices without elections', async () => {
    const out = await expandState(
      await input({
        templateEdit: (t) => {
          t.party_committee.selection.value = 'caucus';
        },
      }),
    );
    const committees = out.offices.filter((o) => o.office_type_id === 'party-precinct-committee');
    expect(committees).toHaveLength(6);
    expect(committees.every((o) => o.party_selection === 'caucus')).toBe(true);
    const slugs = new Set(committees.map((o) => o.slug));
    expect(out.elections.filter((e) => slugs.has(e.office_key))).toEqual([]);

    const none = await expandState(
      await input({
        templateEdit: (t) => {
          t.party_committee.selection.value = 'none';
        },
      }),
    );
    expect(none.jurisdictions).toEqual([]);
    expect(none.offices.some((o) => o.office_type_id === 'party-precinct-committee')).toBe(false);
  });

  it("stage 2's offices get their elections", async () => {
    const out = await expandState(await input());
    const of = (slug: string) =>
      out.elections
        .filter((e) => e.office_key === slug)
        .map((e) => [e.election_date, e.kind, e.party]);
    expect(of('zz-state-senator-district-2')).toEqual([
      ['2028-05-02', 'primary', 'democratic'],
      ['2028-05-02', 'primary', 'republican'],
      ['2028-11-07', 'general', null],
    ]);
    expect(of('zz-state-senator-district-1').every(([date]) => String(date) < '2027-01-01')).toBe(
      true,
    );
    expect(out.offices.some((o) => o.slug.startsWith('zz-state-senator'))).toBe(false);
    const general = out.elections.find(
      (e) => e.source_key === 'zz-state-senator-district-2|2028-11-07|general|',
    );
    expect(general?.field_meta['election_date']).toMatchObject({
      rule_citation: 'ZZ Fixture Code 102',
      checked_at: NOW.toISOString(),
    });
  });

  it('without rules there are no elections', async () => {
    const out = await expandState(await input({ rules: null }));
    expect(out.elections).toEqual([]);
    expect(out.offices).toHaveLength(18);
    expect(out.counts['rules_missing']).toBe(1);
    expect(office(out, 'zz-fixture-county-board-of-commissioners').pay_annual_cents).toBeNull();
    expect(office(out, 'zz-fixture-county-board-of-commissioners').seats_up_next).toBeNull();
  });

  it('a slug held by another identity fails slug_unique', async () => {
    const sheriff = 'census:990001|sheriff|tiger:county:99001';
    const held = await expandState(
      await input({
        assignSlugs: registrySlugAssigner(
          new Map([
            [sheriff, 'zz-fixture-county-sheriff'],
            ['census:990099|sheriff|tiger:county:99099', 'zz-fixture-county-sheriff'],
          ]),
        ),
      }),
    );
    expect(check(held, 'slug_unique')).toMatchObject({
      passed: false,
      detail: 'unassigned=1 duplicate=0',
    });
    expect(
      held.offices.some(
        (o) => o.jurisdiction_key === 'census:990001' && o.office_type_id === 'sheriff',
      ),
    ).toBe(false);

    const twice = await expandState(
      await input({
        assignSlugs: (requests) => new Map(requests.map((r) => [r.identity, 'zz-one-slug'])),
      }),
    );
    expect(check(twice, 'slug_unique')?.passed).toBe(false);

    // A base slug the registry gives another identity is only suffixed.
    const taken = await expandState(
      await input({
        assignSlugs: registrySlugAssigner(
          new Map([['census:990099|x|tiger:county:99099', 'zz-fixture-county-sheriff']]),
        ),
      }),
    );
    expect(check(taken, 'slug_unique')?.passed).toBe(true);
    expect(taken.offices.some((o) => o.slug === 'zz-fixture-county-sheriff-2')).toBe(true);
  });

  it('a pattern that does not compile fails template_pattern', async () => {
    const out = await expandState(
      await input({
        templateEdit: (t) => {
          const sheriff = t.government_types[0]?.offices[1];
          if (sheriff !== undefined) {
            sheriff.applies_to = {
              name_pattern: '[unclosed',
              population_min: null,
              population_max: null,
            };
          }
        },
      }),
    );
    expect(check(out, 'template_pattern')).toEqual({
      name: 'template_pattern',
      passed: false,
      detail: 'errors=1 paths=government_types.0.offices.1.applies_to.name_pattern',
    });
    expect(out.offices).toEqual([]);
  });

  it('the same input gives the same output', async () => {
    const first = await expandState(await input());
    const second = await expandState(await input());
    expect(second).toEqual(first);
  });

  it('powers come from the entry, else the national defaults at low', async () => {
    const out = await expandState(await input());
    const commission = out.officePowers.filter(
      (p) => p.office_key === 'zz-fixture-county-board-of-commissioners',
    );
    expect(commission).toEqual([
      {
        source_key: 'zz-fixture-county-board-of-commissioners|zoning-land-use',
        office_key: 'zz-fixture-county-board-of-commissioners',
        power_id: 'zoning-land-use',
        relevance: 3,
        quote: 'Fixture text: the board of commissioners adopts the county zoning ordinance.',
        source_url: 'https://example.test/zz/code',
        confidence: 'medium',
        checked_at: '2026-11-15T00:00:00.000Z',
      },
    ]);
    const sheriff = out.officePowers.filter((p) => p.office_key === 'zz-fixture-county-sheriff');
    expect(sheriff).toEqual([
      {
        source_key: 'zz-fixture-county-sheriff|jail-and-patrol',
        office_key: 'zz-fixture-county-sheriff',
        power_id: 'jail-and-patrol',
        relevance: 3,
        quote: null,
        source_url: null,
        confidence: 'low',
        checked_at: null,
      },
    ]);
    expect(out.officePowers.some((p) => p.office_key.includes('fire-district'))).toBe(false);
  });

  it('cited facts carry their proof and grounded seat counts reach the office refs', async () => {
    const out = await expandState(await input());
    const commission = office(out, 'zz-fixture-county-board-of-commissioners');
    expect(Object.keys(commission.field_meta).sort()).toEqual([
      'body_size',
      'partisan',
      'pay_amount_cents',
      'pay_annual_cents',
      'pay_kind',
      'pay_period',
      'seats',
      'term_years',
    ]);
    expect(commission.field_meta['body_size']).toEqual({
      source_url: 'https://example.test/zz/code',
      quote: 'Fixture text: the board of commissioners has five members elected at large.',
      confidence: 'medium',
      checked_at: '2026-11-15T00:00:00.000Z',
      rule_citation: 'ZZ Fixture Code 2',
    });
    const ref = out.officeRefs.find((r) => r.slug === commission.slug);
    expect(ref).toMatchObject({
      identity: 'census:990001|county-commissioner|tiger:county:99001',
      origin: 's04-expand',
      jurisdiction_kind: 'county',
      county_geoid: '99001',
      template_seats: 5,
      population: 5000,
      stagger: [
        { group: 'A', seats: 3, every: 4, first: 2026 },
        { group: 'B', seats: 2, every: 4, first: 2028 },
      ],
    });
    const council = out.officeRefs.find(
      (r) => r.slug === 'zz-fixture-city-city-council-district-1',
    );
    expect(council).toMatchObject({ stagger: [], template_seats: 1, county_geoid: '99001' });
  });

  it('a staggered by-district body gives its district offices no seats up next', async () => {
    const out = await expandState(
      await input({
        templateEdit: (t) => {
          const council = t.government_types[1]?.offices[0];
          if (council !== undefined) {
            council.stagger = [
              { group: 'A', seats: 2, every: 4, first: 2025 },
              { group: 'B', seats: 1, every: 4, first: 2027 },
            ];
          }
        },
      }),
    );
    const council = out.offices.filter((o) => o.office_type_id === 'city-council');
    expect(council.map((o) => o.seats_up_next)).toEqual([null, null, null]);
    expect(out.counts['stagger_by_district_unmapped']).toBe(3);
    expect(out.elections.filter((e) => e.office_key === council[0]?.slug)).toHaveLength(3);
  });
});
