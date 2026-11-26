import { insertDistrict, insertDistrictFallback } from '@citizenrun/db/testing';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import {
  DEFAULT_FIXTURE_POINT,
  insertLocationFixture,
  locationBody,
} from '../../testing/location.ts';
import type { LocationFixture } from '../../testing/location.ts';
import type { CensusMatch } from '../geo/census.ts';
import { resolveDistricts } from './resolve-districts.ts';

// TEST-geo `GEOID or point` (D-210, D-211), on the location fixture of the state ZZ.
let testApp: TestApp;
let fixture: LocationFixture;
let point: { lat: number; lng: number };

beforeEach(async () => {
  testApp = await createTestApp();
  fixture = await insertLocationFixture(testApp.deps.db, testApp.deps.clock.now());
  const { lat, lng } = locationBody(DEFAULT_FIXTURE_POINT.lat, DEFAULT_FIXTURE_POINT.lng);
  point = { lat, lng };
});

function match(layers: CensusMatch['layers']): CensusMatch {
  return { lat: point.lat, lng: point.lng, layers };
}

async function resolve(census: CensusMatch | null) {
  const { districts, disagreements } = await resolveDistricts(testApp.deps.db, { point, census });
  return {
    exact: districts.filter((district) => !district.approximate).map((district) => district.id),
    approximate: districts
      .filter((district) => district.approximate)
      .map((district) => district.id),
    districts,
    disagreements,
  };
}

describe('resolveDistricts', () => {
  it('without a match the lookup stands', async () => {
    const result = await resolve(null);
    expect([...result.exact].sort()).toEqual(
      [fixture.state.id, fixture.countyA.id, fixture.city.id, fixture.senate.id].sort(),
    );
    expect(result.approximate).toEqual([fixture.special.id]);
    expect(result.disagreements).toEqual([]);
    // Exact first; every row carries its facts.
    expect(result.districts.at(-1)).toEqual({
      id: fixture.special.id,
      sourceKey: fixture.special.sourceKey,
      level: 'special',
      geometryQuality: 'county_approx',
      state: 'ZZ',
      approximate: true,
    });
    const state = result.districts.find((district) => district.id === fixture.state.id);
    expect(state).toEqual({
      id: fixture.state.id,
      sourceKey: 'tiger:state:99',
      level: 'state',
      geometryQuality: 'exact',
      state: 'ZZ',
      approximate: false,
    });
  });

  it('a matching GEOID changes nothing', async () => {
    const result = await resolve(
      match([
        { token: 'state', geoid: '99' },
        { token: 'county', geoid: '99001' },
        { token: 'place', geoid: '9900100' },
        { token: 'sldu', geoid: '99001' },
      ]),
    );
    expect([...result.exact].sort()).toEqual(
      [fixture.state.id, fixture.countyA.id, fixture.city.id, fixture.senate.id].sort(),
    );
    expect(result.approximate).toEqual([fixture.special.id]);
    expect(result.disagreements).toEqual([]);
  });

  it('a GEOID district replaces its layer only', async () => {
    const result = await resolve(match([{ token: 'county', geoid: '99003' }]));
    expect([...result.exact].sort()).toEqual(
      [fixture.state.id, fixture.countyB.id, fixture.city.id, fixture.senate.id].sort(),
    );
    expect(result.exact).toContain(fixture.city.id);
    expect(result.exact).not.toContain(fixture.countyA.id);
    expect(result.disagreements).toEqual(['county']);
  });

  it("a GEOID key with no row leaves the lookup's district", async () => {
    const result = await resolve(match([{ token: 'county', geoid: '99999' }]));
    expect(result.exact).toContain(fixture.countyA.id);
    expect(result.approximate).toEqual([fixture.special.id]);
    expect(result.disagreements).toEqual([]);
  });

  it('a retired GEOID district is not used', async () => {
    await testApp.deps.db.execute(
      sql`update districts set retired_at = now() where id = ${fixture.countyB.id}::uuid`,
    );
    const result = await resolve(match([{ token: 'county', geoid: '99003' }]));
    expect(result.exact).toContain(fixture.countyA.id);
    expect(result.exact).not.toContain(fixture.countyB.id);
    expect(result.disagreements).toEqual([]);
  });

  it('a GEOID district adds a layer the lookup lacks', async () => {
    // A congressional district elsewhere in the state: the point lookup finds none of the layer.
    const congressional = await insertDistrict(testApp.deps.db, {
      sourceKey: 'tiger:cd:9901',
      level: 'federal',
      wkt: 'POLYGON((-39.89 30.15,-39.88 30.15,-39.88 30.16,-39.89 30.16,-39.89 30.15))',
    });
    const result = await resolve(match([{ token: 'cd', geoid: '9901' }]));
    expect(result.exact).toContain(congressional.id);
    expect(result.disagreements).toEqual(['cd']);
  });

  it('approximate districts follow the final counties', async () => {
    const inCountyB = await insertDistrict(testApp.deps.db, {
      level: 'special',
      geometryQuality: 'county_approx',
      name: 'Fixture Special District B',
    });
    await insertDistrictFallback(testApp.deps.db, {
      districtId: inCountyB.id,
      viaDistrictId: fixture.countyB.id,
    });
    const result = await resolve(match([{ token: 'county', geoid: '99003' }]));
    expect(result.approximate).toEqual([inCountyB.id]);
    const unchanged = await resolve(null);
    expect(unchanged.approximate).toEqual([fixture.special.id]);
  });

  it('a point outside every district resolves to nothing', async () => {
    const outside = locationBody(35.0, -50.0);
    const { districts, disagreements } = await resolveDistricts(testApp.deps.db, {
      point: { lat: outside.lat, lng: outside.lng },
      census: null,
    });
    expect(districts).toEqual([]);
    expect(disagreements).toEqual([]);
  });
});
