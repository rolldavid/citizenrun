import type { Db } from '@citizenrun/db';
import {
  insertDistrict,
  insertDistrictFallback,
  insertJurisdiction,
  insertOffice,
  registerScanValue,
} from '@citizenrun/db/testing';
import type { DistrictFixture, JurisdictionFixture } from '@citizenrun/db/testing';
import type { FakeCensusAnswer } from './fakes/geocoder.ts';

/** The default fixture point: inside the first fixture district (TEST-privacy-logscan). */
export const DEFAULT_FIXTURE_POINT = { lat: 30.004321, lng: -39.995678 } as const;

/**
 * The body of `PUT /v1/me/location` for a point. Both numbers, written to six decimals, are
 * registered with the always-on privacy scan first, so a test whose coordinates reach a log line,
 * a job row or an event fails. Tests send coordinates only through this helper.
 */
export function locationBody(
  lat: number,
  lng: number,
  precision: 'exact' | 'approx' = 'exact',
): { lat: number; lng: number; precision: 'exact' | 'approx' } {
  registerScanValue(lat.toFixed(6));
  registerScanValue(lng.toFixed(6));
  return { lat, lng, precision };
}

/** A box in degrees as WKT: west, south, east, north. */
function boxWkt(west: number, south: number, east: number, north: number): string {
  const corners = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ].map(([x = 0, y = 0]) => `${x.toFixed(2)} ${y.toFixed(2)}`);
  return `POLYGON((${corners.join(',')}))`;
}

const STATE_SQUARE = boxWkt(-40.1, 29.9, -39.8, 30.2);

/** A matched fixture address at the default point, in county A and city C. */
export const FIXTURE_ADDRESS = '100 Fixture Way, Fixture City, ZZ';
/** A matched fixture address at the same point whose county GEOID names county B. */
export const FIXTURE_ADDRESS_OTHER_COUNTY = '200 Fixture Way, Fixture City, ZZ';

/** The Census Geocoder's layers of a match in county `countyGeoid` at the default point. */
export function fixtureCensusMatch(
  countyGeoid: string,
  extra: Readonly<Record<string, ReadonlyArray<{ GEOID: string }>>> = {},
): FakeCensusAnswer {
  return {
    kind: 'match',
    lat: DEFAULT_FIXTURE_POINT.lat,
    lng: DEFAULT_FIXTURE_POINT.lng,
    geographies: {
      States: [{ GEOID: '99' }],
      Counties: [{ GEOID: countyGeoid }],
      'Incorporated Places': [{ GEOID: '9900100' }],
      '2026 State Legislative Districts - Upper': [{ GEOID: '99001' }],
      ...extra,
    },
  };
}

/** The fake Census table of the location fixture: the two `Fixture Way` addresses. */
export function fixtureCensusTable(): Record<string, FakeCensusAnswer> {
  return {
    [FIXTURE_ADDRESS]: fixtureCensusMatch('99001'),
    [FIXTURE_ADDRESS_OTHER_COUNTY]: fixtureCensusMatch('99003'),
  };
}

/** The districts, jurisdictions and offices of the location fixture. */
export type LocationFixture = {
  stateJurisdiction: JurisdictionFixture;
  cityJurisdiction: JurisdictionFixture;
  state: DistrictFixture;
  countyA: DistrictFixture;
  countyB: DistrictFixture;
  city: DistrictFixture;
  senate: DistrictFixture;
  special: DistrictFixture;
  /** The live, non-placeholder offices of the exact districts at the default point. */
  countedOfficeIds: string[];
};

/**
 * The location fixture on factory rows of the fixture state ZZ, every name starting `Fixture`: the
 * state `tiger:state:99` and the senate district `tiger:sldu:99001` on one square, county A
 * `tiger:county:99001` and city C `tiger:place:9900100` holding the default point, county B
 * `tiger:county:99003` beside them, and the special district S (`county_approx`) standing in
 * through county A. Offices: two live, one placeholder and one retired in county A, one in city C,
 * one in S and one in county B.
 */
export async function insertLocationFixture(db: Db, now: Date): Promise<LocationFixture> {
  const stateJurisdiction = await insertJurisdiction(db, { kind: 'state', name: 'Fixture State' });
  const countyAJurisdiction = await insertJurisdiction(db, { name: 'Fixture County A' });
  const countyBJurisdiction = await insertJurisdiction(db, { name: 'Fixture County B' });
  const cityJurisdiction = await insertJurisdiction(db, { kind: 'city', name: 'Fixture City' });
  const specialJurisdiction = await insertJurisdiction(db, {
    kind: 'special_district',
    name: 'Fixture Special District',
  });
  const state = await insertDistrict(db, {
    sourceKey: 'tiger:state:99',
    level: 'state',
    name: 'Fixture State',
    jurisdictionId: stateJurisdiction.id,
    wkt: STATE_SQUARE,
  });
  const countyA = await insertDistrict(db, {
    sourceKey: 'tiger:county:99001',
    level: 'county',
    name: 'Fixture County A',
    jurisdictionId: countyAJurisdiction.id,
    wkt: boxWkt(-40.05, 29.95, -39.95, 30.05),
  });
  const countyB = await insertDistrict(db, {
    sourceKey: 'tiger:county:99003',
    level: 'county',
    name: 'Fixture County B',
    jurisdictionId: countyBJurisdiction.id,
    wkt: boxWkt(-39.9, 29.95, -39.85, 30.05),
  });
  const city = await insertDistrict(db, {
    sourceKey: 'tiger:place:9900100',
    level: 'local',
    name: 'Fixture City',
    jurisdictionId: cityJurisdiction.id,
    wkt: boxWkt(-40.0, 30.0, -39.99, 30.01),
  });
  const senate = await insertDistrict(db, {
    sourceKey: 'tiger:sldu:99001',
    level: 'state',
    name: 'Fixture Senate District 1',
    jurisdictionId: stateJurisdiction.id,
    wkt: STATE_SQUARE,
  });
  const special = await insertDistrict(db, {
    level: 'special',
    geometryQuality: 'county_approx',
    name: 'Fixture Special District',
    jurisdictionId: specialJurisdiction.id,
  });
  await insertDistrictFallback(db, { districtId: special.id, viaDistrictId: countyA.id });

  const inCountyA = { jurisdictionId: countyAJurisdiction.id, districtId: countyA.id };
  const liveA1 = await insertOffice(db, inCountyA);
  const liveA2 = await insertOffice(db, inCountyA);
  await insertOffice(db, { ...inCountyA, placeholder: true });
  await insertOffice(db, { ...inCountyA, retiredAt: now });
  const cityOffice = await insertOffice(db, {
    jurisdictionId: cityJurisdiction.id,
    districtId: city.id,
  });
  await insertOffice(db, { jurisdictionId: specialJurisdiction.id, districtId: special.id });
  await insertOffice(db, { jurisdictionId: countyBJurisdiction.id, districtId: countyB.id });

  return {
    stateJurisdiction,
    cityJurisdiction,
    state,
    countyA,
    countyB,
    city,
    senate,
    special,
    countedOfficeIds: [liveA1.id, liveA2.id, cityOffice.id],
  };
}
