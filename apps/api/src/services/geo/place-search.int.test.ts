import type { Db } from '@citizenrun/db';
import { insertJurisdiction, insertOffice, insertZipCentroid } from '@citizenrun/db/testing';
import type { JurisdictionFixture } from '@citizenrun/db/testing';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { coveredStatesOf } from './covered-states.ts';
import { searchPlaces } from './place-search.ts';

// L-place-search on factory jurisdictions and ZIP centroids of the fixture state ZZ, which has one
// live office; ZY has none, so it is not covered.
const POINT = { lat: 30.005, lng: -39.995 } as const;

type PlaceOptions = {
  kind?: 'city' | 'county' | 'township' | 'school_district';
  state?: string;
  population?: number | null;
  retiredAt?: Date | null;
  point?: { lat: number; lng: number } | null;
};

let testApp: TestApp;
let db: Db;

beforeEach(async () => {
  testApp = await createTestApp();
  db = testApp.deps.db;
  // The office's own jurisdiction has no label point, so no search returns it.
  await insertOffice(db);
});

async function place(name: string, options: PlaceOptions = {}): Promise<JurisdictionFixture> {
  const jurisdiction = await insertJurisdiction(db, {
    name,
    kind: options.kind ?? 'city',
    state: options.state ?? 'ZZ',
    population: options.population ?? null,
    retiredAt: options.retiredAt ?? null,
  });
  const point = options.point === undefined ? POINT : options.point;
  if (point !== null) {
    await db.execute(
      sql`update jurisdictions set label_point = st_setsrid(st_makepoint(${point.lng}, ${point.lat}), 4326)
          where id = ${jurisdiction.id}`,
    );
  }
  return jurisdiction;
}

async function search(q: string) {
  const covered = await coveredStatesOf(testApp.deps).get(testApp.deps.clock.now());
  return searchPlaces(db, { q, covered });
}

async function labels(q: string): Promise<string[]> {
  return (await search(q)).map((item) => item.label);
}

describe('searchPlaces', () => {
  it('a prefix match ranks before a trigram match', async () => {
    await place('Fixture New City');
    await place('Fixture City');
    expect(await search('Fixture Ci')).toEqual([
      {
        label: 'Fixture City, ZZ',
        lat: POINT.lat,
        lng: POINT.lng,
        precision: 'approx',
        kind: 'city',
      },
      {
        label: 'Fixture New City, ZZ',
        lat: POINT.lat,
        lng: POINT.lng,
        precision: 'approx',
        kind: 'city',
      },
    ]);
  });

  it('kinds are city, county and township only', async () => {
    await place('Fixture City');
    await place('Fixture City Schools', { kind: 'school_district' });
    await place('Fixture City County', { kind: 'county' });
    await place('Fixture City Township', { kind: 'township' });
    const found = await search('Fixture City');
    expect(found.map((item) => item.label).sort()).toEqual([
      'Fixture City County, ZZ',
      'Fixture City Township, ZZ',
      'Fixture City, ZZ',
    ]);
    expect(found.map((item) => item.kind).sort()).toEqual(['city', 'county', 'township']);
  });

  it('retired or unplaced units are left out', async () => {
    await place('Fixture Kept');
    await place('Fixture Gone', { retiredAt: testApp.deps.clock.now() });
    await place('Fixture Unplaced', { point: null });
    expect(await labels('Fixture Gone')).not.toContain('Fixture Gone, ZZ');
    expect(await labels('Fixture Unplaced')).not.toContain('Fixture Unplaced, ZZ');
    expect(await labels('Fixture Kept')).toEqual(['Fixture Kept, ZZ']);
  });

  it('uncovered states are left out', async () => {
    await place('Fixture City');
    await place('Fixture City', { state: 'ZY' });
    expect(await labels('Fixture City')).toEqual(['Fixture City, ZZ']);
  });

  it('at most five', async () => {
    for (let n = 1; n <= 7; n += 1) {
      await place(`Fixture Many ${String(n)}`);
    }
    expect(await search('Fixture Many')).toHaveLength(5);
  });

  it('ties fall to population, then id', async () => {
    const small = await place('Fixture Tie', { population: 100, point: { lat: 30.1, lng: -39.9 } });
    const large = await place('Fixture Tie', { population: 500, point: { lat: 30.2, lng: -39.9 } });
    const first = await place('Fixture Tie', { point: { lat: 30.3, lng: -39.9 } });
    const second = await place('Fixture Tie', { point: { lat: 30.4, lng: -39.9 } });
    const latOf = new Map([
      [small.id, 30.1],
      [large.id, 30.2],
      [first.id, 30.3],
      [second.id, 30.4],
    ]);
    const unknown = [first.id, second.id].sort();
    const expected = [large.id, small.id, ...unknown].map((id) => latOf.get(id));
    expect((await search('Fixture Tie')).map((item) => item.lat)).toEqual(expected);
  });

  it('an underscore and a percent sign match themselves', async () => {
    await place('Fixture City');
    // Unescaped, both would be LIKE patterns that match the city's name.
    const unescaped = await db.execute<{ underscore: boolean; percent: boolean }>(
      sql`select 'Fixture City' ilike 'F_x%' as underscore, 'Fixture City' ilike '%ture%' as percent`,
      'objects',
    );
    expect(unescaped[0]).toEqual({ underscore: true, percent: true });
    expect(await search('F_x')).toEqual([]);
    expect(await search('%ture')).toEqual([]);
  });

  it('ZIP prefixes use the centroids', async () => {
    await insertZipCentroid(db, { zip: '00034', lat: 30.034, lng: -39.966 });
    await insertZipCentroid(db, { zip: '00012', lat: 30.012, lng: -39.988 });
    await insertZipCentroid(db, { zip: '01000' });
    expect(await search('000')).toEqual([
      { label: '00012, ZZ', lat: 30.012, lng: -39.988, precision: 'approx', kind: 'zip' },
      { label: '00034, ZZ', lat: 30.034, lng: -39.966, precision: 'approx', kind: 'zip' },
    ]);
    expect(await labels('0001')).toEqual(['00012, ZZ']);
    expect(await labels('00034')).toEqual(['00034, ZZ']);
  });

  it('a ZIP in an uncovered state is left out', async () => {
    await insertZipCentroid(db, { zip: '00012' });
    await insertZipCentroid(db, { zip: '00056', state: 'ZY' });
    expect(await labels('000')).toEqual(['00012, ZZ']);
    expect(await labels('00056')).toEqual([]);
  });

  it('coordinates are rounded to six decimals', async () => {
    await place('Fixture City', { point: { lat: 30.12345678, lng: -39.87654321 } });
    await insertZipCentroid(db, { zip: '00012', lat: 30.98765432, lng: -39.12345678 });
    const [city] = await search('Fixture City');
    expect([city?.lat, city?.lng]).toEqual([30.123457, -39.876543]);
    const [zip] = await search('00012');
    expect([zip?.lat, zip?.lng]).toEqual([30.987654, -39.123457]);
  });

  it('no covered state runs no statement', async () => {
    await place('Fixture City');
    testApp.resetStatementCount();
    expect(await searchPlaces(db, { q: 'Fixture City', covered: new Set() })).toEqual([]);
    expect(testApp.statementCount()).toBe(0);
  });
});
