import { Readable } from 'node:stream';
import { looksPersonal } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { readDelimited } from '../lib/csv.ts';
import { parseOpenStatesCsv } from '../sources/openstates.ts';
import type { Legislator } from '../sources/congress.ts';
import { ZZ_RULES } from '../templates/__fixtures__/zz-rules.ts';
import { buildKnownBodies } from './s02-known.ts';
import type { KnownOutput } from './s02-known.ts';
import {
  GROUNDED,
  UNGROUNDED,
  coloradoDistricts,
  district,
  fixtureLegislator,
  knownInput,
  savedText,
  zzDistricts,
  zzTemplateOutput,
} from './s02-known.fixtures.ts';
import { contestsInWindow, nextElecting } from './shared/contests.ts';

async function coloradoInput() {
  const parsed = await parseOpenStatesCsv(await savedText('co-current.csv'));
  if (!parsed.ok) {
    throw new Error('the saved Colorado file does not parse');
  }
  const { all, sldu, sldl } = await coloradoDistricts();
  return {
    input: await knownInput({
      state: 'CO',
      stateFips: '08',
      stateName: 'Colorado',
      districts: all,
      openStates: parsed.rows,
    }),
    rows: parsed.rows,
    sldu,
    sldl,
  };
}

function senator(bioguide: string, senateClass: 1 | 2 | 3): Legislator {
  return {
    bioguide,
    type: 'sen',
    state: 'ZZ',
    district: null,
    senateClass,
    party: 'Democrat',
    firstName: 'Fixture',
    middleName: null,
    lastName: `Senator ${bioguide}`,
    suffix: null,
    fullName: `Fixture Senator ${bioguide}`,
    nickname: null,
    wikipediaTitle: null,
  };
}

/** Every string anywhere in the output rows. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

function rowsOf(out: KnownOutput): unknown[] {
  return [
    ...out.offices,
    ...out.officePowers,
    ...out.people,
    ...out.officeholders,
    ...out.officeRefs,
    ...out.personSources,
  ];
}

function officeOn(out: KnownOutput, districtKey: string, typeId?: string) {
  return out.offices.filter(
    (o) => o.district_key === districtKey && (typeId === undefined || o.office_type_id === typeId),
  );
}

describe('buildKnownBodies', () => {
  it('without a template each district gets one office with the dataset count', async () => {
    const { input, rows, sldu, sldl } = await coloradoInput();
    const out = buildKnownBodies(input);
    expect(out.offices).toHaveLength(sldu.length + sldl.length);
    expect(out.offices).toHaveLength(100);
    const mapped = new Map<string, number>();
    for (const row of rows) {
      const layer = row.currentChamber === 'lower' ? 'sldl' : 'sldu';
      const key = `tiger:${layer}:08${row.currentDistrict.padStart(3, '0')}`;
      mapped.set(key, (mapped.get(key) ?? 0) + 1);
    }
    for (const d of [...sldu, ...sldl]) {
      const [office] = officeOn(out, d.source_key);
      expect(office).toMatchObject({
        title: d.name,
        seats: Math.max(1, mapped.get(d.source_key) ?? 0),
        partisan: null,
        term_years: null,
        term_limit_terms: null,
        pay_annual_cents: null,
        seats_up_next: null,
        field_meta: {},
      });
      const ref = out.officeRefs.find((r) => r.slug === office?.slug);
      expect(ref).toMatchObject({ schedule: null, track_set: null, stagger: [] });
      const powers = out.officePowers.filter((p) => p.office_key === office?.slug);
      expect(powers.map((p) => [p.power_id, p.relevance, p.confidence, p.quote])).toEqual([
        ['state-health-law', 2, 'low', null],
        ['state-legislation', 2, 'low', null],
      ]);
    }
    expect(out.counts.legislators).toBe(100);
    expect(out.counts.legislator_unmapped).toBe(0);
    expect(out.officeholders).toHaveLength(100);
    expect(out.people).toHaveLength(100);
    expect(out.officeRefs).toHaveLength(100);
    expect(out.personSources).toHaveLength(100);
  });

  it('TIGER districts coded ZZZ get no office', async () => {
    const out = buildKnownBodies(
      await knownInput({
        districts: [
          ...zzDistricts(),
          district('ZZ', 'tiger:sldu:99ZZZ', 'State Senate Districts not defined'),
        ],
        openStates: [fixtureLegislator('zzz', 'lower', 'ZZZ')],
      }),
    );
    expect(out.offices.some((o) => o.district_key.endsWith('ZZZ'))).toBe(false);
    expect(out.offices.filter((o) => o.office_type_id === 'state-senate')).toHaveLength(4);
    expect(out.offices.filter((o) => o.office_type_id === 'state-house')).toHaveLength(2);
    expect(out.counts.legislator_unmapped).toBe(1);
  });

  it('with the ZZ template a positions chamber gets one office per position and no holder', async () => {
    const out = buildKnownBodies(
      await knownInput({
        districts: zzDistricts(),
        template: await zzTemplateOutput(),
        rules: ZZ_RULES,
        openStates: [fixtureLegislator('h1', 'lower', '1'), fixtureLegislator('h2', 'lower', '1')],
      }),
    );
    const offices = officeOn(out, 'tiger:sldl:99001');
    expect(offices.map((o) => [o.title, o.seats])).toEqual([
      ['State Representative, District 1, Position 1', 1],
      ['State Representative, District 1, Position 2', 1],
    ]);
    expect(offices[0]).toMatchObject({ partisan: true, term_years: 2, seats_up_next: 1 });
    expect(offices[0]?.field_meta['term_years']).toMatchObject({
      confidence: 'medium',
      rule_citation: 'ZZ Fixture Code 19',
    });
    const refs = out.officeRefs.filter((r) => r.district_key === 'tiger:sldl:99001');
    expect(refs.map((r) => r.identity)).toEqual([
      'state:ZZ|state-house:position-1|tiger:sldl:99001',
      'state:ZZ|state-house:position-2|tiger:sldl:99001',
    ]);
    expect(refs[0]).toMatchObject({
      template_seats: 2,
      schedule: 'zz_state_general',
      track_set: 'zz_partisan',
      stagger: [{ group: 'A', seats: 1, every: 2, first: 2026 }],
      stagger_group: 'A',
    });
    expect(out.counts.holder_position_unknown).toBe(2);
    expect(out.officeholders.filter((h) => h.person_key.startsWith('openstates:'))).toEqual([]);
    expect(out.people.map((p) => p.source_key)).toEqual([
      'openstates:ocd-person/h1',
      'openstates:ocd-person/h2',
    ]);
  });

  it('seats up next comes from the rules window', async () => {
    const out = buildKnownBodies(
      await knownInput({
        districts: zzDistricts(),
        template: await zzTemplateOutput(),
        rules: ZZ_RULES,
        openStates: [fixtureLegislator('s1', 'upper', '1'), fixtureLegislator('s2', 'upper', '2')],
      }),
    );
    const [first] = officeOn(out, 'tiger:sldu:99001');
    const [second] = officeOn(out, 'tiger:sldu:99002');
    expect(first).toMatchObject({ title: 'State Senator, District 1', seats_up_next: null });
    expect(second).toMatchObject({ title: 'State Senator, District 2', seats_up_next: 1 });
    expect(out.officeRefs.find((r) => r.slug === first?.slug)?.stagger).toEqual([
      { group: 'A', seats: 1, every: 4, first: 2026 },
    ]);
    const holderOf = (slug: string | undefined) =>
      out.officeholders.find((h) => h.office_key === slug);
    expect(holderOf(first?.slug)?.seat_up_next).toBeNull();
    expect(holderOf(second?.slug)?.seat_up_next).toBe(true);
    expect(out.counts.district_group_unmatched).toBe(0);
  });

  it('without rules seats up next is null', async () => {
    const out = buildKnownBodies(
      await knownInput({
        districts: zzDistricts(),
        template: await zzTemplateOutput(),
        rules: null,
        openStates: [fixtureLegislator('s2', 'upper', '2')],
        legislators: [senator('Z000003', 3)],
      }),
    );
    expect(out.offices.length).toBeGreaterThan(0);
    expect(out.offices.every((o) => o.seats_up_next === null)).toBe(true);
    expect(out.officeholders.length).toBe(2);
    expect(out.officeholders.every((h) => h.seat_up_next === null)).toBe(true);
  });

  it('each Senate class keeps only its own years', async () => {
    const out = buildKnownBodies(
      await knownInput({
        districts: zzDistricts(),
        template: await zzTemplateOutput(),
        rules: ZZ_RULES,
        legislators: [senator('Z000001', 1), senator('Z000003', 3)],
      }),
    );
    const senate = out.offices.filter((o) => o.office_type_id === 'us-senate');
    expect(senate.map((o) => [o.slug, o.seats_up_next, o.partisan])).toEqual([
      ['zz-fixture-state-u-s-senator-class-1', null, true],
      ['zz-fixture-state-u-s-senator-class-3', 1, true],
    ]);
    const ref = out.officeRefs.find((r) => r.slug === 'zz-fixture-state-u-s-senator-class-3');
    expect(ref).toMatchObject({
      district_key: 'tiger:state:99',
      stagger: [{ group: 'A', seats: 1, every: 6, first: 2028 }],
      stagger_group: 'A',
      population: 5000,
    });
    if (ref === undefined) return;
    const next = nextElecting(contestsInWindow(ref, 'ZZ', ZZ_RULES, '2026-11-16'), '2026-11-16');
    expect(next).toMatchObject({ date: '2028-11-07', kind: 'general', seatsUp: 1 });
    const class1 = out.officeRefs.find((r) => r.slug === 'zz-fixture-state-u-s-senator-class-1');
    expect(class1?.stagger).toEqual([{ group: 'A', seats: 1, every: 6, first: 2024 }]);
    expect(out.officeholders.map((h) => [h.office_key, h.person_key, h.seat_up_next])).toEqual([
      ['zz-fixture-state-u-s-senator-class-1', 'bioguide:Z000001', null],
      ['zz-fixture-state-u-s-senator-class-3', 'bioguide:Z000003', true],
    ]);
  });

  it('federal terms carry their citation', async () => {
    const grounded = buildKnownBodies(
      await knownInput({
        districts: zzDistricts(),
        federalMarks: { house: GROUNDED, senate: UNGROUNDED },
        legislators: [senator('Z000001', 1)],
      }),
    );
    const [house] = grounded.offices.filter((o) => o.office_type_id === 'us-house');
    expect(house?.field_meta['term_years']).toEqual({
      source_url: 'https://www.archives.gov/founding-docs/constitution-transcript',
      quote:
        'The House of Representatives shall be composed of Members chosen every second Year by the People of the several States',
      confidence: 'medium',
      checked_at: GROUNDED.checked_at,
      rule_citation: 'U.S. Constitution, Article I, Section 2',
    });
    const [senate] = grounded.offices.filter((o) => o.office_type_id === 'us-senate');
    expect(senate?.field_meta['term_years']).toMatchObject({
      confidence: 'low',
      checked_at: '2026-11-16T15:00:00.000Z',
      rule_citation: 'U.S. Constitution, Amendment XVII',
    });
    const ungrounded = buildKnownBodies(await knownInput({ districts: zzDistricts() }));
    const [low] = ungrounded.offices.filter((o) => o.office_type_id === 'us-house');
    expect(low?.field_meta['term_years']).toMatchObject({
      confidence: 'low',
      rule_citation: 'U.S. Constitution, Article I, Section 2',
    });
    expect(grounded.offices.filter((o) => o.office_type_id === 'us-house')).toHaveLength(2);
  });

  it('an unmapped legislator stays a person with no office link', async () => {
    const out = buildKnownBodies(
      await knownInput({
        districts: zzDistricts(),
        openStates: [fixtureLegislator('mh', 'lower', '7th Hampden')],
      }),
    );
    expect(out.people.map((p) => p.source_key)).toEqual(['openstates:ocd-person/mh']);
    expect(out.officeholders).toEqual([]);
    expect(out.counts.legislator_unmapped).toBe(1);
    expect(out.personSources).toHaveLength(1);
  });

  it('a template pay entry sets the pay columns with its proof', async () => {
    const template = await zzTemplateOutput();
    const [senate, house] = template.template.legislature;
    if (senate === undefined || house === undefined) return;
    const withPay = {
      ...template,
      template: {
        ...template.template,
        legislature: [
          {
            ...senate,
            pay: {
              kind: 'salary' as const,
              amount_cents: 300_000,
              period: 'month' as const,
              source_url: 'https://example.test/zz/code',
              quote: 'Fixture text: a senator is paid monthly.',
              citation: 'ZZ Fixture Code 30',
            },
          },
          house,
        ],
      },
    };
    const out = buildKnownBodies(
      await knownInput({ districts: zzDistricts(), template: withPay, rules: ZZ_RULES }),
    );
    const [office] = officeOn(out, 'tiger:sldu:99001');
    expect(office).toMatchObject({
      pay_kind: 'salary',
      pay_amount_cents: 300_000,
      pay_period: 'month',
      pay_annual_cents: 3_600_000,
    });
    expect(office?.field_meta['pay_annual_cents']).toMatchObject({
      confidence: 'low',
      rule_citation: 'ZZ Fixture Code 30',
    });
    expect(out.officeRefs.find((r) => r.slug === office?.slug)?.pay_annual_cents).toBe(3_600_000);
  });

  it('more holders than seats are all kept and counted', async () => {
    const template = await zzTemplateOutput();
    const out = buildKnownBodies(
      await knownInput({
        districts: zzDistricts(),
        template,
        rules: ZZ_RULES,
        openStates: [fixtureLegislator('a', 'upper', '3'), fixtureLegislator('b', 'upper', '3')],
      }),
    );
    const [office] = officeOn(out, 'tiger:sldu:99003');
    expect(office?.seats).toBe(1);
    expect(out.officeholders.filter((h) => h.office_key === office?.slug)).toHaveLength(2);
    expect(out.counts.holders_exceed_seats).toBe(1);
  });

  it('a together chamber gets one office with the cited seat count and every holder', async () => {
    const template = await zzTemplateOutput();
    const [senate, house] = template.template.legislature;
    if (senate === undefined || house?.seats_per_district == null) return;
    const together = {
      ...template,
      template: {
        ...template.template,
        legislature: [
          senate,
          {
            ...house,
            title: 'State Representative, District {label}',
            seats_per_district: { ...house.seats_per_district, arrangement: 'together' as const },
          },
        ],
      },
    };
    const out = buildKnownBodies(
      await knownInput({
        districts: zzDistricts(),
        template: together,
        rules: ZZ_RULES,
        openStates: [fixtureLegislator('h1', 'lower', '2'), fixtureLegislator('h2', 'lower', '2')],
      }),
    );
    const offices = officeOn(out, 'tiger:sldl:99002');
    expect(offices.map((o) => [o.title, o.seats, o.seats_up_next])).toEqual([
      ['State Representative, District 2', 2, 2],
    ]);
    expect(out.officeholders.filter((h) => h.office_key === offices[0]?.slug)).toHaveLength(2);
    expect(out.counts.holder_position_unknown).toBe(0);
    expect(out.officeRefs.find((r) => r.slug === offices[0]?.slug)).toMatchObject({
      identity: 'state:ZZ|state-house|tiger:sldl:99002',
      template_seats: 2,
      stagger: [{ group: 'A', seats: 2, every: 2, first: 2026 }],
    });
  });

  it('a lettered label matches only an explicit district list', async () => {
    const template = await zzTemplateOutput();
    const [senate, house] = template.template.legislature;
    if (senate === undefined || house === undefined) return;
    const listed = {
      ...template,
      template: {
        ...template.template,
        legislature: [
          {
            ...senate,
            district_groups: [
              { group: 'A' as const, districts: 'odd' as const, every: 4, first: 2026 },
              { group: 'B' as const, districts: ['2B'], every: 4, first: 2028 },
            ],
          },
          house,
        ],
      },
    };
    const out = buildKnownBodies(
      await knownInput({
        districts: [
          district('ZZ', 'tiger:sldu:9902A', 'State Senate District 2A'),
          district('ZZ', 'tiger:sldu:9902B', 'State Senate District 2B'),
          district('ZZ', 'tiger:sldu:99003', 'State Senate District 3'),
        ],
        template: listed,
        rules: ZZ_RULES,
      }),
    );
    const groupOf = (key: string) =>
      out.officeRefs.find((r) => r.district_key === key)?.stagger_group ?? null;
    expect(groupOf('tiger:sldu:9902A')).toBeNull();
    expect(groupOf('tiger:sldu:9902B')).toBe('B');
    expect(groupOf('tiger:sldu:99003')).toBe('A');
    expect(out.counts.district_group_unmatched).toBe(1);
    expect(out.officeRefs.find((r) => r.district_key === 'tiger:sldu:9902A')?.stagger).toEqual([]);
  });

  it('template powers replace the national defaults', async () => {
    const template = await zzTemplateOutput();
    const [senate, house] = template.template.legislature;
    if (senate === undefined || house === undefined) return;
    const withPowers = {
      ...template,
      grounded: {
        ...template.grounded,
        'legislature.0.powers.0': template.grounded['legislature.0.term_years'] ?? UNGROUNDED,
      },
      template: {
        ...template.template,
        legislature: [
          {
            ...senate,
            powers: [
              {
                power: 'state-legislation',
                relevance: 3,
                source_url: 'https://example.test/zz/code',
                quote: 'Fixture text: the senate passes the laws of the state.',
                citation: 'ZZ Fixture Code 31',
              },
            ],
          },
          house,
        ],
      },
    };
    const out = buildKnownBodies(
      await knownInput({ districts: zzDistricts(), template: withPowers, rules: ZZ_RULES }),
    );
    const [office] = officeOn(out, 'tiger:sldu:99001');
    expect(out.officePowers.filter((p) => p.office_key === office?.slug)).toEqual([
      {
        source_key: `${office?.slug ?? ''}|state-legislation`,
        office_key: office?.slug,
        power_id: 'state-legislation',
        relevance: 3,
        quote: 'Fixture text: the senate passes the laws of the state.',
        source_url: 'https://example.test/zz/code',
        confidence: 'medium',
        checked_at: GROUNDED.checked_at,
      },
    ]);
  });

  it('a registered identity keeps its slug', async () => {
    const out = buildKnownBodies(
      await knownInput({
        districts: zzDistricts(),
        assignSlugs: (requests) =>
          new Map(
            requests.map((r) => [
              r.identity,
              r.identity === 'state:ZZ|state-senate|tiger:sldu:99001' ? 'zz-earlier-slug' : r.base,
            ]),
          ),
      }),
    );
    expect(officeOn(out, 'tiger:sldu:99001')[0]?.slug).toBe('zz-earlier-slug');
    expect(out.officeRefs.some((r) => r.slug === 'zz-earlier-slug')).toBe(true);
  });

  it('no output row holds an address, phone or email', async () => {
    const { input } = await coloradoInput();
    const out = buildKnownBodies(input);
    const found = rowsOf(out).flatMap(strings).filter(looksPersonal);
    expect(found).toEqual([]);
  });

  it('the image URL appears nowhere in the output', async () => {
    const { input } = await coloradoInput();
    const text = await savedText('co-current.csv');
    const images: string[] = [];
    let imageAt = -1;
    for await (const { line, record } of readDelimited(Readable.from([Buffer.from(text)]), {
      delimiter: ',',
      header: true,
      encoding: 'utf8',
    })) {
      if (line === 1) {
        imageAt = record.indexOf('image');
        continue;
      }
      const image = record[imageAt] ?? '';
      if (image !== '') images.push(image);
    }
    expect(images.length).toBeGreaterThan(50);
    const all = JSON.stringify(rowsOf(buildKnownBodies(input)));
    for (const image of images) {
      expect(all.includes(image)).toBe(false);
    }
    expect(all.includes('active_storage')).toBe(false);
  });

  it('the same input gives the same output', async () => {
    const { input } = await coloradoInput();
    expect(buildKnownBodies(input)).toEqual(buildKnownBodies(input));
    const zz = await knownInput({
      districts: zzDistricts(),
      template: await zzTemplateOutput(),
      rules: ZZ_RULES,
      openStates: [fixtureLegislator('s1', 'upper', '1')],
      legislators: [senator('Z000001', 1)],
    });
    expect(buildKnownBodies(zz)).toEqual(buildKnownBodies(zz));
  });
});
