import { appEvents, userDistricts, users } from '@citizenrun/db';
import {
  insertDistrict,
  insertRateCounter,
  insertUser,
  insertZipCentroid,
  setUserDistricts,
} from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, LocationResultSchema } from '@citizenrun/shared';
import type { ErrorCode, LocationResult } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../../testing/auth.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { fakeCensusGeocoder } from '../../testing/fakes/geocoder.ts';
import type { FakeCensusAnswer } from '../../testing/fakes/geocoder.ts';
import { findTextInTables } from '../../testing/find-in-tables.ts';
import {
  DEFAULT_FIXTURE_POINT,
  FIXTURE_ADDRESS,
  FIXTURE_ADDRESS_OTHER_COUNTY,
  fixtureCensusMatch,
  fixtureCensusTable,
  insertLocationFixture,
  locationBody,
} from '../../testing/location.ts';
import type { LocationFixture } from '../../testing/location.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-ME-13: TEST-api-ME, TEST-point-lookup's API cases, TEST-geo and TEST-rate-limits for
// PUT /v1/me/location, on factory rows of the fixture state ZZ.
const PATH = '/v1/me/location';
const CENSUS_HOST = 'geocoding.geo.census.gov';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// me.location: 10 a minute and 20 a day per user.
const LOCATION_PER_MINUTE = 10;
const LOCATION_PER_DAY = 20;
// The standard fields of every log line.
const STANDARD_LOG_FIELDS = ['time', 'level', 'service', 'event'];

const OTHER_VINTAGE_ADDRESS = '300 Fixture Way, Fixture City, ZZ';
const ZIP_POINT = { lat: 30.004321, lng: -39.995678 };

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

let testApp: TestApp;
let fixture: LocationFixture;
// Every test's Census answers beyond the fixture's two addresses.
let censusTable: Record<string, FakeCensusAnswer>;

beforeEach(async () => {
  testApp = await createTestApp();
  // Five seconds into a minute, so no case crosses a minute window by accident.
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(
    new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5 * SECOND_MS),
  );
  fixture = await insertLocationFixture(testApp.deps.db, testApp.deps.clock.now());
  censusTable = {
    ...fixtureCensusTable(),
    [OTHER_VINTAGE_ADDRESS]: fixtureCensusMatch('99001', {
      '121st Congressional Districts': [{ GEOID: '9901' }],
    }),
  };
  fakeCensusGeocoder(testApp.fakes.outbound, censusTable);
});

function put(body: unknown, options: TestRequestOptions = {}): Promise<TestResponse> {
  return testApp.request.put(PATH, { body, ...options });
}

function pointBody(precision: 'exact' | 'approx' = 'exact') {
  return locationBody(DEFAULT_FIXTURE_POINT.lat, DEFAULT_FIXTURE_POINT.lng, precision);
}

async function expectResult(response: TestResponse): Promise<LocationResult> {
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return LocationResultSchema.parse(await response.json());
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<Envelope> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  const body = JSON.parse(await response.text()) as Envelope; // checked against the schema below
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(ERROR_CODES[code].message);
  return body;
}

let nextUser = 1;

/** A user with an email that holds no marker, signed in by bearer from iOS. */
async function signedInUser(overrides: Parameters<typeof insertUser>[1] = {}) {
  const user = await insertUser(testApp.deps.db, {
    email: `fixture.location.${String(nextUser++)}@example.test`,
    ...overrides,
  });
  const auth = await signIn(testApp.deps.db, user, 'bearer');
  return { user, auth };
}

/** A user signed in at `at`, with the clock set there (TEST-rate-limits). */
async function userSignedInAt(at: string): Promise<TestAuth> {
  testApp.deps.clock.set(at);
  const { user } = await signedInUser();
  const now = testApp.deps.clock.now();
  return signIn(testApp.deps.db, user, 'bearer', {
    authenticatedAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * MINUTE_MS),
  });
}

async function storedIds(userId: string): Promise<string[]> {
  const rows = await testApp.deps.db
    .select({ districtId: userDistricts.districtId })
    .from(userDistricts)
    .where(eq(userDistricts.userId, userId));
  return rows.map((row) => row.districtId).sort();
}

async function userRow(userId: string) {
  const [row] = await testApp.deps.db.select().from(users).where(eq(users.id, userId));
  if (row === undefined) {
    throw new Error('The user row is gone.');
  }
  return row;
}

function censusCalls() {
  return testApp.fakes.outbound.calls.filter((call) => call.host === CENSUS_HOST);
}

function disagreementLines() {
  return testApp.logs.filter((line) => line.parsed['event'] === 'geo.census_disagreement');
}

function pointDistrictIds(): string[] {
  return [
    fixture.state.id,
    fixture.countyA.id,
    fixture.city.id,
    fixture.senate.id,
    fixture.special.id,
  ].sort();
}

async function jobCount(): Promise<number> {
  const rows = await testApp.deps.db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job`,
    'objects',
  );
  return rows[0]?.n ?? 0;
}

describe('PUT /v1/me/location', () => {
  it('ok', async () => {
    const { auth } = await signedInUser();
    const result = await expectResult(await put(pointBody(), { auth }));
    expect(result.outcome).toBe('matched');
  });

  it('a point stores its districts', async () => {
    const { user, auth } = await signedInUser();
    const result = await expectResult(await put(pointBody(), { auth }));
    expect(result.outcome).toBe('matched');
    expect(result.territory).toBeNull();
    expect(await storedIds(user.id)).toEqual(pointDistrictIds());
    expect((await userRow(user.id)).locationPrecision).toBe('exact');
    expect(result.exactDistrictCount).toBe(4);
    expect(result.officeCount).toBe(3);
    // Exact first, by level local, county, special, state, federal, then name: the senate
    // district's name sorts before the state's.
    expect(result.districts.map((entry) => entry.district.id)).toEqual([
      fixture.city.id,
      fixture.countyA.id,
      fixture.senate.id,
      fixture.state.id,
      fixture.special.id,
    ]);
    const exact = result.districts.slice(0, 4);
    for (const entry of exact) {
      expect(entry.approximate).toBe(false);
      expect(entry.district.geometryQuality).toBe('exact');
      expect(entry.outline?.svg).toEqual(expect.any(String));
      expect(entry.outline?.bbox).toHaveLength(4);
      expect(entry.labelPoint).toHaveLength(2);
    }
    const [lng = 0, lat = 0] = exact[0]?.labelPoint ?? [];
    expect(lng).toBeGreaterThanOrEqual(-40.0);
    expect(lng).toBeLessThanOrEqual(-39.99);
    expect(lat).toBeGreaterThanOrEqual(30.0);
    expect(lat).toBeLessThanOrEqual(30.01);
    expect(result.districts[4]).toEqual({
      district: {
        id: fixture.special.id,
        tileId: fixture.special.tileId,
        name: fixture.special.name,
        level: 'special',
        geometryQuality: 'county_approx',
      },
      approximate: true,
      outline: null,
      labelPoint: null,
    });
    expect(result.me.location).toEqual({
      isSet: true,
      precision: 'exact',
      districtCount: 5,
      bbox: [-40.1, 29.9, -39.8, 30.2],
      placeName: 'Fixture City',
      officeCount: 3,
      needsConfirmation: false,
    });
    expect(censusCalls()).toEqual([]);
  });

  it('the same point twice gives the same rows', async () => {
    const { user, auth } = await signedInUser();
    const first = await expectResult(await put(pointBody(), { auth }));
    const second = await expectResult(await put(pointBody(), { auth }));
    expect(second.districts).toEqual(first.districts);
    expect(second.officeCount).toBe(first.officeCount);
    expect(await storedIds(user.id)).toEqual(pointDistrictIds());
  });

  it('repeat is safe', async () => {
    const { user, auth } = await signedInUser();
    await expectResult(await put(pointBody(), { auth }));
    const before = await storedIds(user.id);
    const again = await expectResult(await put(pointBody(), { auth }));
    expect(await storedIds(user.id)).toEqual(before);
    expect(again.exactDistrictCount).toBe(4);
  });

  it('ZIP gives an approximate location', async () => {
    await insertZipCentroid(testApp.deps.db, { lat: ZIP_POINT.lat, lng: ZIP_POINT.lng });
    const { user, auth } = await signedInUser();
    const body = locationBody(ZIP_POINT.lat, ZIP_POINT.lng, 'approx');
    const result = await expectResult(await put(body, { auth }));
    expect(result.me.location.precision).toBe('approx');
    expect(await storedIds(user.id)).toEqual(pointDistrictIds());
    expect((await userRow(user.id)).locationPrecision).toBe('approx');
  });

  it('a bare ZIP needs a street address', async () => {
    const { user, auth } = await signedInUser();
    for (const address of ['27601', '27601-1234']) {
      await expectEnvelope(await put({ address }, { auth }), 'need_street_address');
    }
    expect(testApp.fakes.outbound.calls).toEqual([]);
    expect(await storedIds(user.id)).toEqual([]);
  });

  it('an address stores the GEOID districts', async () => {
    const { user, auth } = await signedInUser();
    const result = await expectResult(await put({ address: FIXTURE_ADDRESS }, { auth }));
    expect(result.outcome).toBe('matched');
    expect(await storedIds(user.id)).toEqual(pointDistrictIds());
    expect((await userRow(user.id)).locationPrecision).toBe('exact');
    expect(result.exactDistrictCount).toBe(4);
    expect(disagreementLines()).toEqual([]);
    const calls = censusCalls();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    const path = call?.path ?? '';
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(query.get('address')).toBe(FIXTURE_ADDRESS);
    // The address travels only in its own query parameter, and no user identifier goes with it.
    query.delete('address');
    expect(query.toString()).not.toContain('Fixture');
    expect(call?.body ?? null).toBeNull();
    for (const value of Object.values(call?.headers ?? {})) {
      expect(value).not.toContain('Fixture');
      expect(value).not.toContain(user.id);
    }
    expect(path).not.toContain(user.id);
  });

  it('a disagreement keeps the GEOID district and counts its layer', async () => {
    const { user, auth } = await signedInUser();
    const result = await expectResult(
      await put({ address: FIXTURE_ADDRESS_OTHER_COUNTY }, { auth }),
    );
    const stored = await storedIds(user.id);
    expect(stored).toContain(fixture.countyB.id);
    expect(stored).not.toContain(fixture.countyA.id);
    // S stands in only through county A.
    expect(stored).not.toContain(fixture.special.id);
    expect(stored).toEqual(
      [fixture.state.id, fixture.countyB.id, fixture.city.id, fixture.senate.id].sort(),
    );
    expect(result.districts.every((entry) => !entry.approximate)).toBe(true);
    const lines = disagreementLines();
    expect(lines).toHaveLength(1);
    const fields = Object.fromEntries(
      Object.entries(lines[0]?.parsed ?? {}).filter(([key]) => !STANDARD_LOG_FIELDS.includes(key)),
    );
    expect(fields).toEqual({ layer: 'county' });
    expect(lines[0]?.parsed['level']).toBe('info');
  });

  it('a layer of another vintage falls back to the point', async () => {
    const { user, auth } = await signedInUser();
    await expectResult(await put({ address: OTHER_VINTAGE_ADDRESS }, { auth }));
    expect(await storedIds(user.id)).toEqual(pointDistrictIds());
    expect(disagreementLines()).toEqual([]);
  });

  it('no match answers 422 address_not_found', async () => {
    const { user, auth } = await signedInUser();
    await expectEnvelope(
      await put({ address: '1 Nowhere Fixture Lane, Fixture City, ZZ' }, { auth }),
      'address_not_found',
    );
    expect(censusCalls()).toHaveLength(1);
    expect(await storedIds(user.id)).toEqual([]);
  });

  it('a geocoder timeout answers 503 and five failures open the circuit', async () => {
    const { auth } = await signedInUser();
    const timeouts = [1, 2, 3, 4, 5, 6].map((n) => `${String(n)} Fixture Timeout Road, ZZ`);
    for (const address of timeouts) {
      censusTable[address] = 'timeout';
    }
    const { clock } = testApp.deps;
    for (const [index, address] of timeouts.slice(0, 5).entries()) {
      if (index > 0) {
        // Spaced so the Census limiter refuses none of the attempts.
        clock.advance(1_000);
      }
      await expectEnvelope(await put({ address }, { auth }), 'geocoder_unavailable');
      expect(censusCalls()).toHaveLength(2 * (index + 1));
    }
    expect(censusCalls()).toHaveLength(10);
    // The breaker is open: the sixth request makes no outbound call.
    clock.advance(1_000);
    await expectEnvelope(await put({ address: timeouts[5] }, { auth }), 'geocoder_unavailable');
    expect(censusCalls()).toHaveLength(10);
    // 60,000 ms after the fifth failure the next call goes through.
    clock.advance(59_000);
    await expectResult(await put({ address: FIXTURE_ADDRESS }, { auth }));
    expect(censusCalls()).toHaveLength(11);
  });

  it('outside the United States', async () => {
    const { user, auth } = await signedInUser();
    // Open Atlantic, outside every fixture square; then Toronto.
    for (const [lat, lng] of [
      [35.0, -50.0],
      [43.6532, -79.3832],
    ] as const) {
      await expectEnvelope(await put(locationBody(lat, lng), { auth }), 'outside_us');
    }
    expect(await storedIds(user.id)).toEqual([]);
    expect((await userRow(user.id)).locationPrecision).toBeNull();
  });

  it('territory not loaded', async () => {
    const { user, auth } = await signedInUser({ locationPrecision: 'exact' });
    await setUserDistricts(testApp.deps.db, user.id, [fixture.countyA.id, fixture.state.id]);
    // San Juan: no PR office, so PR is not covered.
    const result = await expectResult(await put(locationBody(18.4655, -66.1057), { auth }));
    expect(result).toMatchObject({
      outcome: 'not_covered_yet',
      territory: 'PR',
      districts: [],
      exactDistrictCount: 0,
      officeCount: 0,
    });
    expect(await storedIds(user.id)).toEqual([]);
    expect((await userRow(user.id)).locationPrecision).toBeNull();
    expect(result.me.location.isSet).toBe(false);
  });

  it('a withheld state stores nothing', async () => {
    await testApp.deps.db.execute(
      sql`update state_rules set signup = 'withhold' where state = 'ZZ'`,
    );
    const { user, auth } = await signedInUser({ locationPrecision: 'approx' });
    await setUserDistricts(testApp.deps.db, user.id, [fixture.countyB.id]);
    await expectEnvelope(await put(pointBody(), { auth }), 'unavailable_in_state');
    expect(await storedIds(user.id)).toEqual([fixture.countyB.id]);
    expect((await userRow(user.id)).locationPrecision).toBe('approx');
  });

  it('a state that needs the store signal refuses a self-declared age', async () => {
    await testApp.deps.db.execute(
      sql`update state_rules set age_method = 'store_signal_required' where state = 'ZZ'`,
    );
    const declared = await signedInUser({ ageMethod: 'self_declared', ageSourceTier: 'self' });
    await expectEnvelope(await put(pointBody(), { auth: declared.auth }), 'age_signal_required');
    expect(await storedIds(declared.user.id)).toEqual([]);
    expect((await userRow(declared.user.id)).locationPrecision).toBeNull();

    const signalled = await signedInUser({ ageMethod: 'store_signal', ageSourceTier: 'confirmed' });
    await expectResult(await put(pointBody(), { auth: signalled.auth }));
    expect(await storedIds(signalled.user.id)).toEqual(pointDistrictIds());
  });

  it('the step moves from location to done', async () => {
    const atLocation = await signedInUser({ onboardingStep: 'location', onboardedAt: null });
    const result = await expectResult(await put(pointBody(), { auth: atLocation.auth }));
    expect(result.me.onboardingStep).toBe('done');
    const row = await userRow(atLocation.user.id);
    expect(row.onboardingStep).toBe('done');
    expect(row.onboardedAt).toEqual(testApp.deps.clock.now());
    const events = await testApp.deps.db
      .select({ name: appEvents.name, props: appEvents.props })
      .from(appEvents)
      .where(eq(appEvents.userId, atLocation.user.id))
      .orderBy(appEvents.id);
    expect(events).toEqual([
      { name: 'onboarding_step', props: { step: 'location', outcome: 'completed' } },
      { name: 'onboarding_done', props: {} },
    ]);

    const atIssues = await signedInUser({ onboardingStep: 'issues', onboardedAt: null });
    const kept = await expectResult(await put(pointBody(), { auth: atIssues.auth }));
    expect(kept.me.onboardingStep).toBe('issues');
    expect(await storedIds(atIssues.user.id)).toEqual(pointDistrictIds());
  });

  it('the stale mark is cleared', async () => {
    const { user, auth } = await signedInUser({ districtsStaleAt: testApp.deps.clock.now() });
    const result = await expectResult(await put(pointBody(), { auth }));
    expect((await userRow(user.id)).districtsStaleAt).toBeNull();
    expect(result.me.location.needsConfirmation).toBe(false);
  });

  it('only district ids are stored', async () => {
    const { user, auth } = await signedInUser();
    const address = `${marker()} Fixture Road, Fixture City, ZZ`;
    censusTable[address] = fixtureCensusMatch('99001');
    const jobsBefore = await jobCount();
    await expectResult(await put({ address }, { auth }));
    await expectResult(await put(pointBody(), { auth }));
    const ids = await storedIds(user.id);
    expect(ids).toEqual(pointDistrictIds());
    expect(await findTextInTables(testApp.deps.db, address)).toEqual([]);
    expect(await findTextInTables(testApp.deps.db, marker())).toEqual([]);
    expect(await findTextInTables(testApp.deps.db, DEFAULT_FIXTURE_POINT.lat.toFixed(6))).toEqual(
      [],
    );
    expect(await findTextInTables(testApp.deps.db, DEFAULT_FIXTURE_POINT.lng.toFixed(6))).toEqual(
      [],
    );
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      for (const id of ids) {
        expect(line.raw).not.toContain(id);
      }
      expect(line.raw).not.toContain(address);
    }
    expect(await jobCount()).toBe(jobsBefore);
  });

  it('no column of any table contains the marker after the call', async () => {
    const { auth } = await signedInUser();
    const address = `${marker()} Fixture Road, Nowhere, ZZ`;
    await expectEnvelope(await put({ address }, { auth }), 'address_not_found');
    expect(await findTextInTables(testApp.deps.db, address)).toEqual([]);
    expect(await findTextInTables(testApp.deps.db, marker())).toEqual([]);
  });

  it('the eleventh call in a minute answers 429', async () => {
    const auth = await userSignedInAt('2027-03-05T12:00:00.000Z');
    for (let call = 0; call < LOCATION_PER_MINUTE; call += 1) {
      await expectResult(await put(pointBody(), { auth }));
    }
    const refused = await put(pointBody(), { auth });
    await expectEnvelope(refused, 'rate_limited');
    expect(refused.headers.get('retry-after')).toBe('60');
  });

  it('the twenty-first call in a day answers 429', async () => {
    const auth = await userSignedInAt('2027-03-05T12:00:00.000Z');
    for (let minute = 0; minute < LOCATION_PER_DAY / LOCATION_PER_MINUTE; minute += 1) {
      for (let call = 0; call < LOCATION_PER_MINUTE; call += 1) {
        await expectResult(await put(pointBody(), { auth }));
      }
      testApp.deps.clock.advance(MINUTE_MS);
    }
    const refused = await put(pointBody(), { auth });
    await expectEnvelope(refused, 'rate_limited');
    // From 12:02:00 to 00:00 UTC.
    expect(refused.headers.get('retry-after')).toBe(String(12 * 3600 - 2 * 60));
  });

  it('rate-limited', async () => {
    const { user, auth } = await signedInUser();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:location:1m`,
      windowStart,
      count: LOCATION_PER_MINUTE,
    });
    const response = await put(pointBody(), { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
    expect(await storedIds(user.id)).toEqual([]);
  });

  it('body forms', async () => {
    const { user, auth } = await signedInUser();
    const cases: [unknown, Record<string, string>][] = [
      [{}, { lat: 'required', lng: 'required', precision: 'required' }],
      [{ address: 'ab' }, { address: 'too_short' }],
      [{ lat: 91, lng: 0, precision: 'exact' }, { lat: 'out_of_range' }],
      [{ address: 'x y z', lat: 1 }, { lat: 'not_allowed' }],
      [{ lat: 1, lng: 1, precision: 'fast' }, { precision: 'invalid_value' }],
    ];
    for (const [body, fields] of cases) {
      const envelope = await expectEnvelope(await put(body, { auth }), 'invalid_request');
      expect(envelope.error.fields).toEqual(fields);
    }
    expect(testApp.fakes.outbound.calls).toEqual([]);
    expect(await storedIds(user.id)).toEqual([]);
  });

  it('rejects invalid input', async () => {
    const { auth } = await signedInUser();
    const envelope = await expectEnvelope(
      await put({ address: 'a'.repeat(201) }, { auth }),
      'invalid_request',
    );
    expect(envelope.error.fields).toEqual({ address: 'too_long' });
    const typed = await expectEnvelope(
      await put({ lat: '30', lng: -40, precision: 'exact' }, { auth }),
      'invalid_request',
    );
    expect(typed.error.fields).toEqual({ lat: 'invalid_type' });
  });

  it('envelope on every error', async () => {
    await expectEnvelope(await put(pointBody()), 'unauthenticated');
    const { auth } = await signedInUser();
    await expectEnvelope(await put({}, { auth }), 'invalid_request');
    await expectEnvelope(await put({ address: '27601' }, { auth }), 'need_street_address');
    await expectEnvelope(await put(locationBody(35.0, -50.0), { auth }), 'outside_us');
    await expectEnvelope(
      await put({ address: '2 Nowhere Fixture Lane, ZZ' }, { auth }),
      'address_not_found',
    );
  });

  it('logged out answers 401', async () => {
    await expectEnvelope(await put(pointBody()), 'unauthenticated');
  });

  it('requires a session', async () => {
    await expectEnvelope(await put(pointBody()), 'unauthenticated');
    const { user } = await signedInUser();
    const now = testApp.deps.clock.now();
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: new Date(now.getTime() - 100 * 24 * 60 * MINUTE_MS),
      expiresAt: new Date(now.getTime() - MINUTE_MS),
    });
    await expectEnvelope(await put(pointBody(), { auth: expired }), 'unauthenticated');
    expect(await storedIds(user.id)).toEqual([]);
  });

  it('checks origin on cookie writes', async () => {
    const { user } = await signedInUser();
    const cookie: TestAuth = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(await put(pointBody(), { auth: cookie, origin: null }), 'origin_rejected');
    expect(await storedIds(user.id)).toEqual([]);
    await expectResult(await put(pointBody(), { auth: cookie }));
  });

  it('suspended accounts cannot write', async () => {
    const { user, auth } = await signedInUser({
      status: 'suspended',
      suspendedAt: testApp.deps.clock.now(),
      suspendedReason: 'other',
    });
    await expectEnvelope(await put(pointBody(), { auth }), 'account_suspended');
    expect(await storedIds(user.id)).toEqual([]);
  });

  it('a retired district is never stored', async () => {
    const { user, auth } = await signedInUser();
    const retired = await insertDistrict(testApp.deps.db, {
      sourceKey: 'tiger:cousub:9900199999',
      level: 'local',
      retiredAt: testApp.deps.clock.now(),
      wkt: 'POLYGON((-40.00 30.00,-39.99 30.00,-39.99 30.01,-40.00 30.01,-40.00 30.00))',
    });
    await expectResult(await put(pointBody(), { auth }));
    expect(await storedIds(user.id)).not.toContain(retired.id);
  });
});
