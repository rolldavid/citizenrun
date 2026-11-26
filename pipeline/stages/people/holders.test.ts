import { looksPersonal, personSlug } from '@citizenrun/shared';
import type { BPerson } from '@citizenrun/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadParties } from '../../lib/data-files.ts';
import type { PartiesFile } from '../../lib/data-files.ts';
import type { ExecutivePerson } from '../../sources/openstates-executive.ts';
import type { TemplateOutput } from '../../templates/output.ts';
import { zzStatewideRef, zzTemplateOutput } from '../../__fixtures__/s09/zz-s09.ts';
import type { PersonSourceRow } from '../shared/person-source.ts';
import { buildHolders } from './holders.ts';
import type { PeopleInput } from './holders.ts';

let template: TemplateOutput;
let parties: PartiesFile;

beforeAll(async () => {
  template = await zzTemplateOutput();
  parties = await loadParties();
});

function person(
  key: string,
  name: string,
  first: string | null,
  last: string | null,
  extra: Partial<BPerson> = {},
): BPerson {
  return {
    source_key: key,
    slug: personSlug(name, key),
    name,
    first_name: first,
    middle_name: null,
    last_name: last,
    suffix: null,
    party: null,
    photo: null,
    website: null,
    roster_only: false,
    origin: { created_by: 'bundle', key, datasets: ['congress-legislators'] },
    ...extra,
  };
}

const SENATOR = person('bioguide:Z000001', 'Fixture Q. Senator', 'Fixture', 'Senator');
const SENATOR_SOURCE: PersonSourceRow = {
  person_key: 'bioguide:Z000001',
  bioguide: 'Z000001',
  wikipedia_urls: ['https://en.wikipedia.org/wiki/Fixture_Senator'],
  wikidata_qid: null,
  nickname_alias: 'Fix Senator',
};
const DIRECTOR = person(
  'irs990:990000001:fixture director',
  'Fixture Director',
  'Fixture',
  'Director',
  {
    roster_only: true,
    origin: {
      created_by: 'bundle',
      key: 'irs990:990000001:fixture director',
      datasets: ['irs990'],
    },
  },
);

const GOVERNOR: ExecutivePerson = {
  id: 'ocd-person/00000000-0000-4000-8000-000000000001',
  state: 'ZZ',
  name: 'Fixture Governor Person',
  givenName: 'Fixture',
  familyName: 'Person',
  party: 'Democratic',
  roles: [
    { type: 'upper', startDate: '2015-01-01', endDate: '2020-12-31' },
    { type: 'governor', startDate: '2025-01-01', endDate: '2029-01-01' },
  ],
  links: ['https://en.wikipedia.org/wiki/Fixture_Governor_Person'],
  sources: ['https://example.test/zz/governor'],
};
const FORMER: ExecutivePerson = {
  ...GOVERNOR,
  id: 'ocd-person/00000000-0000-4000-8000-000000000002',
  name: 'Fixture Former Governor',
  roles: [{ type: 'governor', startDate: '2021-01-01', endDate: '2026-11-25' }],
};

const TREASURER = {
  personQid: 'Q99999002',
  label: 'Fixture Pat Treasurer',
  enwikiTitle: 'Fixture Pat Treasurer',
};

function input(overrides: Partial<PeopleInput> = {}): PeopleInput {
  return {
    state: 'ZZ',
    today: '2026-11-26',
    now: new Date('2026-11-26T15:00:00.000Z'),
    knownPeople: [SENATOR],
    knownSources: [SENATOR_SOURCE],
    coopPeople: [DIRECTOR],
    template,
    officeRefs: [
      zzStatewideRef('governor', 'governor'),
      zzStatewideRef('treasurer', 'state-treasurer'),
      zzStatewideRef('trial-judge-east', 'trial-judge', 2),
    ],
    executives: [GOVERNOR, FORMER],
    wikidata: new Map([['treasurer', [TREASURER]]]),
    parties,
    ...overrides,
  };
}

describe('buildHolders', () => {
  it('statewide holders come from the executive files and Wikidata', () => {
    const out = buildHolders(input());
    expect(out.officeholders).toEqual([
      {
        source_key: 'zz-governor|openstates:ocd-person/00000000-0000-4000-8000-000000000001|',
        office_key: 'zz-governor',
        person_key: 'openstates:ocd-person/00000000-0000-4000-8000-000000000001',
        seat_label: null,
        since: null,
        until: null,
        seat_up_next: null,
        term_limited: null,
        not_running: null,
        cash_on_hand_cents: null,
        cash_as_of: null,
        cash_source_url: null,
      },
      expect.objectContaining({
        source_key: 'zz-treasurer|wikidata:Q99999002|',
        office_key: 'zz-treasurer',
        person_key: 'wikidata:Q99999002',
        since: null,
      }) as unknown,
    ]);
    const governor = out.people.find((p) => p.source_key.startsWith('openstates:'));
    expect(governor).toMatchObject({
      name: 'Fixture Governor Person',
      first_name: 'Fixture',
      last_name: 'Person',
      party: 'democratic',
      photo: null,
      roster_only: false,
      origin: { created_by: 'bundle', datasets: ['openstates-people'] },
    });
    const treasurer = out.people.find((p) => p.source_key === 'wikidata:Q99999002');
    expect(treasurer).toMatchObject({
      name: 'Fixture Pat Treasurer',
      first_name: 'Fixture',
      middle_name: 'Pat',
      last_name: 'Treasurer',
      party: null,
      origin: { datasets: ['wikidata'] },
      slug: personSlug('Fixture Pat Treasurer', 'wikidata:Q99999002'),
    });
    // trial-judge-east has a Wikidata position but no entry in the map, so it gets no holder.
    expect(out.officeholders.some((row) => row.office_key === 'zz-trial-judge-east')).toBe(false);
    expect(out.counts).toMatchObject({
      statewide: 2,
      executives: 1,
      wikidata: 1,
      wikidata_ambiguous: 0,
    });
  });

  it('two Wikidata holders for one seat give none', () => {
    const second = { personQid: 'Q99999004', label: 'Fixture Other Treasurer', enwikiTitle: null };
    const out = buildHolders(input({ wikidata: new Map([['treasurer', [TREASURER, second]]]) }));
    expect(out.officeholders.map((row) => row.office_key)).toEqual(['zz-governor']);
    expect(out.people.some((p) => p.source_key.startsWith('wikidata:'))).toBe(false);
    expect(out.counts.wikidata_ambiguous).toBe(1);
  });

  it('a statewide entry with no stage 4 office gets no holder', () => {
    const out = buildHolders(input({ officeRefs: [] }));
    expect(out.officeholders).toEqual([]);
    expect(out.people.map((p) => p.source_key)).toEqual([SENATOR.source_key, DIRECTOR.source_key]);
  });

  it('aliases are the distinct full name, first and last, and nickname forms', () => {
    const out = buildHolders(input());
    const of = (key: string) => out.aliases.filter((a) => a.person_key === key).map((a) => a.alias);
    expect(of('bioguide:Z000001')).toEqual([
      'Fix Senator',
      'Fixture Q. Senator',
      'Fixture Senator',
    ]);
    expect(of('openstates:ocd-person/00000000-0000-4000-8000-000000000001')).toEqual([
      'Fixture Governor Person',
      'Fixture Person',
    ]);
    // A name equal to its first and last parts is listed once.
    expect(of(DIRECTOR.source_key)).toEqual(['Fixture Director']);
    for (const alias of out.aliases) {
      expect(alias.source_key).toBe(`${alias.person_key}|${alias.alias}`);
    }
  });

  it('co-op directors get no photo candidate', () => {
    const out = buildHolders(input());
    expect(out.candidates.map((c) => c.personKey)).not.toContain(DIRECTOR.source_key);
    expect(out.candidates).toContainEqual({
      personKey: 'bioguide:Z000001',
      bioguide: 'Z000001',
      wikipediaTitles: ['Fixture Senator'],
    });
    expect(out.candidates).toContainEqual({
      personKey: 'openstates:ocd-person/00000000-0000-4000-8000-000000000001',
      bioguide: null,
      wikipediaTitles: ['Fixture Governor Person'],
    });
    expect(out.candidates).toContainEqual({
      personKey: 'wikidata:Q99999002',
      bioguide: null,
      wikipediaTitles: ['Fixture Pat Treasurer'],
    });
    // The co-op director is still written, as stage 2 wrote it.
    expect(out.people).toContainEqual(DIRECTOR);
  });

  it('a person who is also a stage 2 person is not duplicated', () => {
    const known = person(
      'openstates:ocd-person/00000000-0000-4000-8000-000000000001',
      'Fixture Governor Person',
      'Fixture',
      'Person',
    );
    const out = buildHolders(input({ knownPeople: [SENATOR, known] }));
    expect(out.people.filter((p) => p.source_key === known.source_key)).toEqual([known]);
    expect(out.officeholders.map((row) => row.person_key)).toContain(known.source_key);
  });

  it('no output row holds an address, phone or email', () => {
    const out = buildHolders(input());
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === 'string') strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk([out.people, out.aliases, out.officeholders]);
    expect(strings.length).toBeGreaterThan(0);
    expect(strings.filter((s) => looksPersonal(s))).toEqual([]);
  });
});
