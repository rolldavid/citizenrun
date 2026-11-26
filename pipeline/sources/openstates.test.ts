import { describe, expect, it } from 'vitest';
import { coloradoDistricts, savedText } from '../stages/s02-known.fixtures.ts';
import { mapperFor } from './openstates-districts/index.ts';
import { OPENSTATES_HEADER, parseOpenStatesCsv, wikipediaUrls } from './openstates.ts';
import type { OpenStatesPerson } from './openstates.ts';

const OVERWRITTEN = ['123 Fixture St, Testville, ZZ 00000', '555-0100', 'fixture@example.test'];

const PERSON_KEYS = [
  'currentChamber',
  'currentDistrict',
  'currentParty',
  'familyName',
  'givenName',
  'id',
  'links',
  'name',
  'sources',
];

async function colorado() {
  const text = await savedText('co-current.csv');
  const parsed = await parseOpenStatesCsv(text);
  if (!parsed.ok) {
    throw new Error('the saved Colorado file does not parse');
  }
  return { text, rows: parsed.rows, dropped: parsed.dropped };
}

function valuesOf(row: OpenStatesPerson): string[] {
  return Object.values(row).flatMap((value: string | readonly string[] | null) =>
    value === null ? [] : typeof value === 'string' ? [value] : [...value],
  );
}

describe('parseOpenStatesCsv', () => {
  it('the saved Colorado file maps every numbered district', async () => {
    const { rows, dropped } = await colorado();
    const { sldu, sldl } = await coloradoDistricts();
    const upper = new Set(sldu.map((d) => d.source_key.slice('tiger:sldu:'.length)));
    const lower = new Set(sldl.map((d) => d.source_key.slice('tiger:sldl:'.length)));
    expect(rows).toHaveLength(100);
    expect(dropped).toBe(0);
    expect(new Set(rows.map((r) => r.currentChamber))).toEqual(new Set(['upper', 'lower']));
    const mapper = mapperFor('CO', '08');
    for (const row of rows) {
      const chamber = row.currentChamber === 'lower' ? 'lower' : 'upper';
      const geoid = mapper(chamber, row.currentDistrict);
      expect(geoid).not.toBeNull();
      expect((chamber === 'upper' ? upper : lower).has(geoid ?? '')).toBe(true);
    }
  });

  it('an extra unexpected column passes', async () => {
    const { text, rows } = await colorado();
    const extended = text
      .split('\n')
      .map((line, i) => (line === '' ? line : `${line},${i === 0 ? 'extra_column' : 'x'}`))
      .join('\n');
    const parsed = await parseOpenStatesCsv(extended);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.rows).toEqual(rows);
  });

  it('current_district renamed fails', async () => {
    const { text } = await colorado();
    const [header = '', ...rest] = text.split('\n');
    const renamed = [header.replace('current_district', 'district'), ...rest].join('\n');
    expect(await parseOpenStatesCsv(renamed)).toEqual({ ok: false, missing: ['current_district'] });
  });

  it('a header-only file with a short header names every missing column', async () => {
    expect(await parseOpenStatesCsv('id,name\n')).toEqual({
      ok: false,
      missing: OPENSTATES_HEADER.filter((name) => name !== 'id' && name !== 'name'),
    });
  });

  it('only the ten columns leave the parser', async () => {
    const { rows } = await colorado();
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(PERSON_KEYS);
      for (const value of valuesOf(row)) {
        expect(OVERWRITTEN).not.toContain(value);
      }
    }
  });

  it('drops and counts a row of an unknown chamber', async () => {
    const header = OPENSTATES_HEADER.join(',');
    const blank = ','.repeat(OPENSTATES_HEADER.length - 7);
    const text = [
      header,
      `ocd-person/1,Fixture One,Democratic,3,upper,Fixture,One${blank}`,
      `ocd-person/2,Fixture Two,Republican,4,executive,Fixture,Two${blank}`,
    ].join('\n');
    const parsed = await parseOpenStatesCsv(text);
    expect(parsed).toMatchObject({ ok: true, dropped: 1 });
    expect(parsed.ok && parsed.rows.map((r) => r.id)).toEqual(['ocd-person/1']);
  });
});

describe('wikipediaUrls', () => {
  it('Wikipedia links are taken from links then sources', () => {
    const person: OpenStatesPerson = {
      id: 'ocd-person/fixture',
      name: 'Fixture Person',
      currentParty: null,
      currentDistrict: '1',
      currentChamber: 'upper',
      givenName: null,
      familyName: null,
      links: [
        'http://en.wikipedia.org/wiki/Fixture_Insecure',
        'https://example.test/zz/fixture-person',
        'https://en.wikipedia.org/wiki/Fixture_Person',
      ],
      sources: [
        'https://en.wikipedia.org/wiki/Fixture_Person',
        'https://en.wikipedia.org/w/index.php?title=Fixture',
        'https://en.wikipedia.org/wiki/Fixture_Person_(politician)',
      ],
    };
    expect(wikipediaUrls(person)).toEqual([
      'https://en.wikipedia.org/wiki/Fixture_Person',
      'https://en.wikipedia.org/wiki/Fixture_Person_(politician)',
    ]);
  });

  it('keeps at most ten pages', () => {
    const links = Array.from(
      { length: 12 },
      (_, i) => `https://en.wikipedia.org/wiki/Fixture_${String(i)}`,
    );
    const person: OpenStatesPerson = {
      id: 'ocd-person/fixture',
      name: 'Fixture Person',
      currentParty: null,
      currentDistrict: '1',
      currentChamber: 'upper',
      givenName: null,
      familyName: null,
      links,
      sources: [],
    };
    expect(wikipediaUrls(person)).toEqual(links.slice(0, 10));
  });
});
