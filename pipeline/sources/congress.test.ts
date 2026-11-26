import { describe, expect, it } from 'vitest';
import { buildKnownBodies } from '../stages/s02-known.ts';
import {
  FIXTURE_NOW,
  congressDistricts,
  knownInput,
  savedText,
} from '../stages/s02-known.fixtures.ts';
import { HOUSE_TERM, SENATE_TERM } from '../stages/federal.ts';
import { CONGRESS_REQUIRED, parseLegislatorsCsv } from './congress.ts';
import type { Legislator } from './congress.ts';

async function excerpt(): Promise<{ text: string; rows: readonly Legislator[] }> {
  const text = await savedText('legislators-current-excerpt.csv');
  const parsed = await parseLegislatorsCsv(text);
  if (!parsed.ok) {
    throw new Error('the saved excerpt does not parse');
  }
  return { text, rows: parsed.rows };
}

const NOW = FIXTURE_NOW.toISOString();
const LOW_HOUSE = {
  source_url: HOUSE_TERM.source_url,
  quote: HOUSE_TERM.quote,
  confidence: 'low',
  checked_at: NOW,
  rule_citation: 'U.S. Constitution, Article I, Section 2',
};
const LOW_SENATE = {
  source_url: SENATE_TERM.source_url,
  quote: SENATE_TERM.quote,
  confidence: 'low',
  checked_at: NOW,
  rule_citation: 'U.S. Constitution, Amendment XVII',
};

const NULL_OFFICE_FACTS = {
  placeholder: false,
  body_size: null,
  seats_up_next: null,
  vacant_seats_up_next: null,
  term_limit_terms: null,
  partisan: null,
  party_selection: null,
  electorate: null,
  pay_annual_cents: null,
  pay_kind: null,
  pay_amount_cents: null,
  pay_period: null,
  pay_change_note: null,
  benefits: null,
  hours_per_week: null,
  full_time: null,
  meeting_times: null,
  fits_day_job: null,
  filing_fee_cents: null,
  signatures_required: null,
  where_to_file: null,
  eligibility: null,
};

function holder(office: string, person: string) {
  return {
    source_key: `${office}|${person}|`,
    office_key: office,
    person_key: person,
    seat_label: null,
    since: null,
    until: null,
    seat_up_next: null,
    term_limited: null,
    not_running: null,
    cash_on_hand_cents: null,
    cash_as_of: null,
    cash_source_url: null,
  };
}

describe('parseLegislatorsCsv', () => {
  it('reads the named columns of every excerpt row', async () => {
    const { rows } = await excerpt();
    expect(rows.map((r) => [r.bioguide, r.type, r.state, r.district, r.senateClass])).toEqual([
      ['B001261', 'sen', 'WY', null, 1],
      ['N000147', 'rep', 'DC', 0, null],
      ['L000571', 'sen', 'WY', null, 2],
      ['H001096', 'rep', 'WY', 0, null],
      ['H001103', 'rep', 'PR', 0, null],
    ]);
    expect(rows[0]).toEqual({
      bioguide: 'B001261',
      type: 'sen',
      state: 'WY',
      district: null,
      senateClass: 1,
      party: 'Republican',
      firstName: 'John',
      middleName: 'A.',
      lastName: 'Barrasso',
      suffix: null,
      fullName: 'John Barrasso',
      nickname: null,
      wikipediaTitle: 'John Barrasso',
    });
  });

  it('a missing required column fails', async () => {
    const { text } = await excerpt();
    const [header = '', ...rest] = text.split('\n');
    const without = [header.replace('senate_class', 'class_of_senate'), ...rest].join('\n');
    expect(await parseLegislatorsCsv(without)).toEqual({ ok: false, missing: ['senate_class'] });
  });

  it('drops and counts a row with a malformed bioguide id or type', async () => {
    const header = CONGRESS_REQUIRED.join(',');
    const text = [
      header,
      'Z000001,rep,ZZ,1,,Democrat,Fixture,,One,,Fixture One',
      'zz00001,rep,ZZ,2,,Democrat,Fixture,,Two,,Fixture Two',
      'Z000003,del,ZZ,3,,Democrat,Fixture,,Three,,Fixture Three',
    ].join('\n');
    const parsed = await parseLegislatorsCsv(text);
    expect(parsed).toMatchObject({ ok: true, dropped: 2 });
    expect(parsed.ok && parsed.rows.map((r) => r.bioguide)).toEqual(['Z000001']);
  });
});

describe('Congress in the known bodies', () => {
  it('an excerpt with an at-large state and DC produces the expected keys', async () => {
    const { rows } = await excerpt();
    const wy = buildKnownBodies(
      await knownInput({
        state: 'WY',
        stateFips: '56',
        stateName: 'Wyoming',
        districts: await congressDistricts('WY', '56', 'Wyoming'),
        legislators: rows.filter((r) => r.state === 'WY'),
      }),
    );
    const house = 'wy-wyoming-u-s-representative-congressional-district-at-large';
    const class1 = 'wy-wyoming-u-s-senator-class-1';
    const class2 = 'wy-wyoming-u-s-senator-class-2';
    expect(wy.offices).toEqual([
      {
        ...NULL_OFFICE_FACTS,
        source_key: house,
        slug: house,
        jurisdiction_key: 'state:WY',
        district_key: 'tiger:cd:5600',
        office_type_id: 'us-house',
        title: 'U.S. Representative, Congressional District (at Large)',
        seats: 1,
        term_years: 2,
        field_meta: { term_years: LOW_HOUSE },
      },
      {
        ...NULL_OFFICE_FACTS,
        source_key: class1,
        slug: class1,
        jurisdiction_key: 'state:WY',
        district_key: 'tiger:state:56',
        office_type_id: 'us-senate',
        title: 'U.S. Senator, Class 1',
        seats: 1,
        term_years: 6,
        field_meta: { term_years: LOW_SENATE },
      },
      {
        ...NULL_OFFICE_FACTS,
        source_key: class2,
        slug: class2,
        jurisdiction_key: 'state:WY',
        district_key: 'tiger:state:56',
        office_type_id: 'us-senate',
        title: 'U.S. Senator, Class 2',
        seats: 1,
        term_years: 6,
        field_meta: { term_years: LOW_SENATE },
      },
    ]);
    expect(wy.people.map((p) => [p.source_key, p.name, p.party])).toEqual([
      ['bioguide:B001261', 'John Barrasso', 'republican'],
      ['bioguide:H001096', 'Harriet M. Hageman', 'republican'],
      ['bioguide:L000571', 'Cynthia M. Lummis', 'republican'],
    ]);
    expect(wy.people[1]).toMatchObject({
      first_name: 'Harriet',
      middle_name: 'Maxine',
      last_name: 'Hageman',
      suffix: null,
      photo: null,
      website: null,
      roster_only: false,
      origin: { created_by: 'bundle', key: 'bioguide:H001096', datasets: ['congress-legislators'] },
    });
    expect(wy.people[1]?.slug).toMatch(/^harriet-m-hageman-[0-9a-f]{8}$/);
    expect(wy.officeholders).toEqual([
      holder(house, 'bioguide:H001096'),
      holder(class1, 'bioguide:B001261'),
      holder(class2, 'bioguide:L000571'),
    ]);
    expect(wy.officeholders.map((h) => h.office_key)).toEqual([house, class1, class2]);
    expect(wy.officeRefs.map((r) => r.identity)).toEqual([
      'state:WY|us-house|tiger:cd:5600',
      'state:WY|us-senate:class-1|tiger:state:56',
      'state:WY|us-senate:class-2|tiger:state:56',
    ]);
    expect(wy.counts).toMatchObject({ members: 3, member_unmapped: 0 });
    expect(wy.personSources.find((s) => s.person_key === 'bioguide:B001261')).toEqual({
      person_key: 'bioguide:B001261',
      bioguide: 'B001261',
      wikipedia_urls: ['https://en.wikipedia.org/wiki/John_Barrasso'],
      wikidata_qid: null,
      nickname_alias: null,
    });

    const dc = buildKnownBodies(
      await knownInput({
        state: 'DC',
        stateFips: '11',
        stateName: 'District of Columbia',
        districts: await congressDistricts('DC', '11', 'District of Columbia'),
        legislators: rows.filter((r) => r.state === 'DC'),
      }),
    );
    const delegate = 'dc-district-of-columbia-u-s-representative-delegate-district-at-large';
    expect(dc.offices).toEqual([
      {
        ...NULL_OFFICE_FACTS,
        source_key: delegate,
        slug: delegate,
        jurisdiction_key: 'state:DC',
        district_key: 'tiger:cd:1198',
        office_type_id: 'us-house',
        title: 'U.S. Representative, Delegate District (at Large)',
        seats: 1,
        term_years: 2,
        field_meta: { term_years: LOW_HOUSE },
      },
    ]);
    expect(dc.people.map((p) => p.source_key)).toEqual(['bioguide:N000147']);
    expect(dc.officeholders).toEqual([holder(delegate, 'bioguide:N000147')]);

    // The Puerto Rico row matches no state the stage runs, so no output holds it.
    expect(rows.filter((r) => r.state === 'PR')).toHaveLength(1);
    for (const state of [wy, dc]) {
      expect(state.people.some((p) => p.source_key === 'bioguide:H001103')).toBe(false);
    }
  });

  it('the nickname alias is written', async () => {
    const header = [...CONGRESS_REQUIRED, 'nickname'].join(',');
    const parsed = await parseLegislatorsCsv(
      `${header}\nZ000001,rep,ZZ,1,,Democrat,Robert,,Fixture,,Robert Fixture,Bob\n`,
    );
    if (!parsed.ok) {
      throw new Error('the fixture row does not parse');
    }
    const out = buildKnownBodies(await knownInput({ legislators: parsed.rows }));
    expect(out.personSources).toEqual([
      {
        person_key: 'bioguide:Z000001',
        bioguide: 'Z000001',
        wikipedia_urls: [],
        wikidata_qid: null,
        nickname_alias: 'Bob Fixture',
      },
    ]);
    expect(out.counts).toMatchObject({ members: 1, member_unmapped: 1 });
  });
});
