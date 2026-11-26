import { dayPeriod, monthPeriod } from '@citizenrun/db';
import {
  insertJurisdiction,
  insertOffice,
  insertRateCounter,
  insertUsageCounter,
  insertUser,
  insertZipCentroid,
} from '@citizenrun/db/testing';
import type { UserRow } from '@citizenrun/db';
import { ERROR_CODES, ErrorEnvelopeSchema, GeoSuggestionsPageSchema } from '@citizenrun/shared';
import type { ErrorCode, GeoSuggestionsPage } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { signIn } from '../../testing/auth.ts';
import { fakeAddressSuggestions } from '../../testing/fakes/geocoder.ts';
import type { FakeSuggestionsAnswer } from '../../testing/fakes/geocoder.ts';
import { findTextInTables } from '../../testing/find-in-tables.ts';
import type { TestAuth, TestRequestOptions, TestResponse } from '../../testing/request.ts';

// E-GEO-01: TEST-api-GEO, the int:api cases of TEST-geo and TEST-rate-limits for
// POST /v1/geo/autocomplete, on factory rows of the fixture state ZZ.
const PATH = '/v1/geo/autocomplete';
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// geo.suggest: 30 a minute and 150 a day per user.
const PER_MINUTE = 30;
const PER_DAY = 150;
// A fixture key, never a real one.
const FIXTURE_GEO_KEY = 'fixture-geo-key';
const GEOAPIFY_ENV = { GEO_PROVIDER: 'geoapify', GEO_API_KEY: FIXTURE_GEO_KEY } as const;
const GEOAPIFY_HOST = 'api.geoapify.com';
const TYPED = '1 Fixture Way';
const CITY_POINT = { lat: 30.005, lng: -39.995 } as const;
const EMPTY: GeoSuggestionsPage = { items: [], nextCursor: null, attribution: null };

type Envelope = { error: { code: string; message: string; fields: Record<string, string> } };

type Setup = { testApp: TestApp; user: UserRow; auth: TestAuth };

/**
 * A test app (Geoapify with the suggestion fake when `table` is given, else the default `none`),
 * early in a UTC minute, with one live office in ZZ, the city `Fixture City` and two ZIP centroids,
 * and a signed-in user at `onboardingStep` whose email holds no marker.
 */
async function setup(
  options: {
    table?: Readonly<Record<string, FakeSuggestionsAnswer>>;
    onboardingStep?: 'location' | 'done';
    status?: 'suspended';
  } = {},
): Promise<Setup> {
  const testApp = await createTestApp(options.table === undefined ? {} : { env: GEOAPIFY_ENV });
  if (options.table !== undefined) {
    fakeAddressSuggestions(testApp.fakes.outbound, options.table);
  }
  const now = testApp.deps.clock.now();
  testApp.deps.clock.set(new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + 5_000));
  const { db } = testApp.deps;
  await insertOffice(db);
  const city = await insertJurisdiction(db, { name: 'Fixture City', kind: 'city' });
  await db.execute(
    sql`update jurisdictions
        set label_point = st_setsrid(st_makepoint(${CITY_POINT.lng}, ${CITY_POINT.lat}), 4326)
        where id = ${city.id}`,
  );
  await insertZipCentroid(db, { zip: '00034', lat: 30.034, lng: -39.966 });
  await insertZipCentroid(db, { zip: '00012', lat: 30.012, lng: -39.988 });
  const step = options.onboardingStep ?? 'done';
  const user = await insertUser(db, {
    email: 'fixture.geo@example.test',
    onboardingStep: step,
    ...(step === 'done' ? {} : { onboardedAt: null }),
    ...(options.status === 'suspended'
      ? {
          status: 'suspended' as const,
          suspendedAt: testApp.deps.clock.now(),
          suspendedReason: 'other' as const,
        }
      : {}),
  });
  const auth = await signIn(db, user, 'bearer');
  return { testApp, user, auth };
}

function suggest(
  testApp: TestApp,
  body: unknown,
  options: TestRequestOptions = {},
): Promise<TestResponse> {
  return testApp.request.post(PATH, { body, ...options });
}

async function expectPage(response: TestResponse): Promise<GeoSuggestionsPage> {
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return GeoSuggestionsPageSchema.parse(await response.json());
}

async function expectEnvelope(response: TestResponse, code: ErrorCode): Promise<Envelope> {
  expect(response.status).toBe(ERROR_CODES[code].status);
  expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = JSON.parse(await response.text()) as Envelope; // checked against the schema below
  expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(ERROR_CODES[code].message);
  return body;
}

async function counter(testApp: TestApp, name: 'geo.month' | 'geo.day'): Promise<number | null> {
  const now = testApp.deps.clock.now();
  const period = name === 'geo.month' ? monthPeriod(now) : dayPeriod(now);
  const rows = await testApp.deps.db.execute<{ count: string }>(
    sql`select count from usage_counters where name = ${name} and period = ${period}`,
    'objects',
  );
  const count = rows[0]?.count;
  return count === undefined ? null : Number(count);
}

async function setCounter(
  testApp: TestApp,
  name: 'geo.month' | 'geo.day',
  count: number,
): Promise<void> {
  const now = testApp.deps.clock.now();
  const period = name === 'geo.month' ? monthPeriod(now) : dayPeriod(now);
  await testApp.deps.db.execute(sql`delete from usage_counters where name = ${name}`);
  await insertUsageCounter(testApp.deps.db, { name, period, count });
}

function oneResult(label: string): FakeSuggestionsAnswer {
  return [{ formatted: label, lat: 30.1, lon: -39.9, result_type: 'building' }];
}

function failedLines(testApp: TestApp): Record<string, unknown>[] {
  return testApp.logs
    .map((line) => line.parsed)
    .filter((parsed) => parsed['event'] === 'geo.provider_failed');
}

function address(q = TYPED): { q: string; kind: 'address' } {
  return { q, kind: 'address' };
}

describe('POST /v1/geo/autocomplete', () => {
  it('ok', async () => {
    const { testApp, auth } = await setup();
    const page = await expectPage(
      await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth }),
    );
    expect(page).toEqual({
      items: [
        {
          label: 'Fixture City, ZZ',
          lat: CITY_POINT.lat,
          lng: CITY_POINT.lng,
          precision: 'approx',
          kind: 'city',
        },
      ],
      nextCursor: null,
      attribution: null,
    });
  });

  it('place search uses our own data', async () => {
    // Geoapify is configured, and still no place search calls out.
    const { testApp, auth } = await setup({ table: { Fix: oneResult('Fix Street') } });
    const page = await expectPage(await suggest(testApp, { q: 'Fix', kind: 'place' }, { auth }));
    expect(page.items[0]).toEqual({
      label: 'Fixture City, ZZ',
      lat: CITY_POINT.lat,
      lng: CITY_POINT.lng,
      precision: 'approx',
      kind: 'city',
    });
    expect(page.attribution).toBeNull();
    expect(testApp.fakes.outbound.calls).toEqual([]);
    expect(await counter(testApp, 'geo.month')).toBeNull();
  });

  it('ZIP search returns centroids', async () => {
    const { testApp, auth } = await setup();
    const page = await expectPage(await suggest(testApp, { q: '000', kind: 'place' }, { auth }));
    expect(page).toEqual({
      items: [
        { label: '00012, ZZ', lat: 30.012, lng: -39.988, precision: 'approx', kind: 'zip' },
        { label: '00034, ZZ', lat: 30.034, lng: -39.966, precision: 'approx', kind: 'zip' },
      ],
      nextCursor: null,
      attribution: null,
    });
    expect(testApp.fakes.outbound.calls).toEqual([]);
  });

  it('with no provider, addresses get nothing', async () => {
    const { testApp, auth } = await setup();
    expect(await expectPage(await suggest(testApp, address(), { auth }))).toEqual(EMPTY);
    expect(testApp.fakes.outbound.calls).toEqual([]);
    const rows = await testApp.deps.db.execute<{ n: number }>(
      sql`select count(*)::int as n from usage_counters`,
      'objects',
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('address suggestions', async () => {
    const { testApp, auth } = await setup({
      table: {
        [TYPED]: [
          {
            formatted: '1 Fixture Way, Fixture City, ZZ',
            lat: 30.1,
            lon: -39.9,
            result_type: 'building',
          },
          { formatted: '1 Fixture Way, ZZ', lat: 30.2, lon: -39.8 },
          { formatted: '1 Fixture Way, Abroad', lat: 45.1, lon: -75.1, country_code: 'ca' },
          { formatted: '1 Fixture Way, Fixture New City, ZZ', lat: 30.3, lon: -39.7 },
          { formatted: '1 Fixture Way North, ZZ', lat: 30.4, lon: -39.6 },
          { formatted: '1 Fixture Way South, ZZ', lat: 30.5, lon: -39.5 },
          { formatted: '1 Fixture Way East, ZZ', lat: 30.6, lon: -39.4 },
        ],
      },
    });
    const page = await expectPage(await suggest(testApp, address(), { auth }));
    expect(page).toEqual({
      items: [
        {
          label: '1 Fixture Way, Fixture City, ZZ',
          lat: 30.1,
          lng: -39.9,
          precision: 'exact',
          kind: 'address',
        },
        { label: '1 Fixture Way, ZZ', lat: 30.2, lng: -39.8, precision: 'approx', kind: 'address' },
        {
          label: '1 Fixture Way, Fixture New City, ZZ',
          lat: 30.3,
          lng: -39.7,
          precision: 'approx',
          kind: 'address',
        },
        {
          label: '1 Fixture Way North, ZZ',
          lat: 30.4,
          lng: -39.6,
          precision: 'approx',
          kind: 'address',
        },
        {
          label: '1 Fixture Way South, ZZ',
          lat: 30.5,
          lng: -39.5,
          precision: 'approx',
          kind: 'address',
        },
      ],
      nextCursor: null,
      attribution: 'geoapify',
    });
    expect(testApp.fakes.outbound.calls).toHaveLength(1);
    expect(await counter(testApp, 'geo.month')).toBe(1);
    expect(await counter(testApp, 'geo.day')).toBe(1);
  });

  it('the fake provider receives no header or parameter derived from the user or the client', async () => {
    const { testApp, user } = await setup({ table: { [TYPED]: oneResult(TYPED) } });
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    const bearer = await signIn(testApp.deps.db, user, 'bearer');
    for (const auth of [bearer, cookie]) {
      const response = await suggest(testApp, address(), {
        auth,
        ip: '203.0.113.77',
        headers: { 'x-forwarded-for': '198.51.100.7' },
      });
      expect((await expectPage(response)).items).toHaveLength(1);
    }
    expect(testApp.fakes.outbound.calls).toHaveLength(2);
    for (const call of testApp.fakes.outbound.calls) {
      expect(call.host).toBe(GEOAPIFY_HOST);
      const names = Object.keys(call.headers);
      for (const forbidden of [
        'authorization',
        'cookie',
        'x-real-ip',
        'x-forwarded-for',
        'x-os-client',
        'origin',
      ]) {
        expect(names).not.toContain(forbidden);
      }
      const query = new URLSearchParams(call.path.slice(call.path.indexOf('?') + 1));
      expect([...query.keys()].sort()).toEqual(['apiKey', 'filter', 'format', 'limit', 'text']);
      expect(query.get('text')).toBe(TYPED);
      expect(call.path).not.toContain(user.id);
      expect(call.path).not.toContain(encodeURIComponent(user.email ?? 'fixture.geo'));
      expect(call.path).not.toContain('fixture.geo');
      expect(call.body).toBeNull();
    }
  });

  it('over the monthly cap the answer is empty and nothing is sent', async () => {
    const { testApp, auth } = await setup({ table: { [TYPED]: oneResult(TYPED) } });
    expect(testApp.deps.env.GEO_MONTHLY_CAP).toBe(85_000);
    await setCounter(testApp, 'geo.month', testApp.deps.env.GEO_MONTHLY_CAP);
    // A user still in sign-up, so the 80 percent rule does not answer first.
    const onboarding = await insertUser(testApp.deps.db, {
      email: 'fixture.geo.onboarding@example.test',
      onboardingStep: 'location',
      onboardedAt: null,
    });
    for (const caller of [auth, await signIn(testApp.deps.db, onboarding, 'bearer')]) {
      expect(await expectPage(await suggest(testApp, address(), { auth: caller }))).toEqual(EMPTY);
    }
    expect(testApp.fakes.outbound.calls).toEqual([]);
  });

  it('over the daily cap the same', async () => {
    const { testApp, auth } = await setup({
      table: { [TYPED]: oneResult(TYPED) },
      onboardingStep: 'location',
    });
    expect(testApp.deps.env.GEO_DAILY_CAP).toBe(2_800);
    await setCounter(testApp, 'geo.day', testApp.deps.env.GEO_DAILY_CAP);
    expect(await expectPage(await suggest(testApp, address(), { auth }))).toEqual(EMPTY);
    expect(testApp.fakes.outbound.calls).toEqual([]);
    // The request was counted, as every request that reaches the caps is.
    expect(await counter(testApp, 'geo.day')).toBe(2_801);
    expect(await counter(testApp, 'geo.month')).toBe(1);
  });

  it('past 80% a signed-up user gets none and an onboarding user gets some', async () => {
    const { testApp, auth } = await setup({ table: { [TYPED]: oneResult(TYPED) } });
    await setCounter(testApp, 'geo.month', 68_000);
    expect(await expectPage(await suggest(testApp, address(), { auth }))).toEqual(EMPTY);
    expect(testApp.fakes.outbound.calls).toEqual([]);
    // The 80 percent read changes nothing.
    expect(await counter(testApp, 'geo.month')).toBe(68_000);
    expect(await counter(testApp, 'geo.day')).toBeNull();

    const onboarding = await insertUser(testApp.deps.db, {
      email: 'fixture.geo.onboarding@example.test',
      onboardingStep: 'location',
      onboardedAt: null,
    });
    const onboardingAuth = await signIn(testApp.deps.db, onboarding, 'bearer');
    const some = await expectPage(await suggest(testApp, address(), { auth: onboardingAuth }));
    expect(some.items).toHaveLength(1);
    expect(some.attribution).toBe('geoapify');
    expect(testApp.fakes.outbound.calls).toHaveLength(1);

    await setCounter(testApp, 'geo.month', 67_999);
    const below = await expectPage(await suggest(testApp, address(), { auth }));
    expect(below.items).toHaveLength(1);
    expect(below.attribution).toBe('geoapify');
    expect(testApp.fakes.outbound.calls).toHaveLength(2);
  });

  it('a provider failure returns none', async () => {
    const { testApp, auth } = await setup({
      table: { 'Fixture timeout': 'timeout', 'Fixture outage': '5xx' },
    });
    for (const q of ['Fixture timeout', 'Fixture outage']) {
      const before = failedLines(testApp).length;
      expect(await expectPage(await suggest(testApp, address(q), { auth }))).toEqual(EMPTY);
      const lines = failedLines(testApp);
      expect(lines).toHaveLength(before + 1);
      const line = lines.at(-1) ?? {};
      expect(Object.keys(line).sort()).toEqual(['event', 'level', 'service', 'time']);
      expect(line['level']).toBe('warn');
    }
    expect(testApp.fakes.outbound.calls).toHaveLength(2);
    // A failed call was sent, so it counts.
    expect(await counter(testApp, 'geo.month')).toBe(2);
    expect(await counter(testApp, 'geo.day')).toBe(2);
  });

  it('an answer with no United States result credits nobody', async () => {
    const { testApp, auth } = await setup({
      table: {
        [TYPED]: [
          { formatted: '1 Fixture Way, Abroad', lat: 45.1, lon: -75.1, country_code: 'ca' },
          { formatted: '2 Fixture Way, Abroad', lat: 45.2, lon: -75.2, country_code: 'ca' },
        ],
      },
    });
    expect(await expectPage(await suggest(testApp, address(), { auth }))).toEqual(EMPTY);
    expect(testApp.fakes.outbound.calls).toHaveLength(1);
    expect(await counter(testApp, 'geo.month')).toBe(1);
    expect(await counter(testApp, 'geo.day')).toBe(1);
  });

  it('an empty answer from a cap credits nobody', async () => {
    const { testApp, auth } = await setup({ table: { [TYPED]: oneResult(TYPED) } });
    const onboarding = await insertUser(testApp.deps.db, {
      email: 'fixture.geo.onboarding@example.test',
      onboardingStep: 'location',
      onboardedAt: null,
    });
    const onboardingAuth = await signIn(testApp.deps.db, onboarding, 'bearer');
    const cases: { name: 'geo.month' | 'geo.day'; count: number; caller: TestAuth }[] = [
      { name: 'geo.month', count: testApp.deps.env.GEO_MONTHLY_CAP, caller: onboardingAuth },
      { name: 'geo.day', count: testApp.deps.env.GEO_DAILY_CAP, caller: onboardingAuth },
      { name: 'geo.month', count: 68_000, caller: auth },
    ];
    for (const { name, count, caller } of cases) {
      await testApp.deps.db.execute(sql`delete from usage_counters`);
      await setCounter(testApp, name, count);
      const page = await expectPage(await suggest(testApp, address(), { auth: caller }));
      expect(page.items).toEqual([]);
      expect(page.attribution).toBeNull();
    }
    expect(testApp.fakes.outbound.calls).toEqual([]);
  });

  it('the thirty-first call in a minute answers 429', async () => {
    const { testApp, auth } = await setup();
    for (let n = 1; n <= PER_MINUTE; n += 1) {
      const allowed = await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth });
      expect(allowed.status, `request ${String(n)}`).toBe(200);
    }
    const refused = await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth });
    await expectEnvelope(refused, 'rate_limited');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(refused.headers.get('retry-after'))).toBeLessThanOrEqual(60);
  });

  it('the hundred-and-fifty-first in a day answers 429', async () => {
    const { testApp, user, auth } = await setup();
    const now = testApp.deps.clock.now();
    const dayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:geo_suggest_day:1d`,
      windowStart: dayStart,
      count: PER_DAY - 1,
    });
    expect((await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth })).status).toBe(200);
    const refused = await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth });
    await expectEnvelope(refused, 'rate_limited');
    const left = Math.ceil((dayStart.getTime() + DAY_MS - now.getTime()) / SECOND_MS);
    expect(refused.headers.get('retry-after')).toBe(String(left));
  });

  it('a two-character query answers 400', async () => {
    const { testApp, auth } = await setup();
    for (const q of ['ab', '  ab  ']) {
      const body = await expectEnvelope(
        await suggest(testApp, { q, kind: 'place' }, { auth }),
        'invalid_request',
      );
      expect(body.error.fields).toEqual({ q: 'too_short' });
    }
  });

  it('logged out answers 401', async () => {
    const { testApp } = await setup();
    await expectEnvelope(
      await suggest(testApp, { q: 'Fixture', kind: 'place' }),
      'unauthenticated',
    );
  });

  it('rejects invalid input', async () => {
    const { testApp, auth } = await setup();
    const cases: { body: unknown; fields: Record<string, string> }[] = [
      { body: { kind: 'place' }, fields: { q: 'required' } },
      { body: { q: 'Fixture', kind: 'street' }, fields: { kind: 'invalid_value' } },
      { body: { q: 'x'.repeat(101), kind: 'place' }, fields: { q: 'too_long' } },
      { body: { q: 42, kind: 'place' }, fields: { q: 'invalid_type' } },
    ];
    for (const { body, fields } of cases) {
      const envelope = await expectEnvelope(
        await suggest(testApp, body, { auth }),
        'invalid_request',
      );
      expect(envelope.error.fields).toEqual(fields);
    }
  });

  it('envelope on every error', async () => {
    const { testApp, user, auth } = await setup();
    await expectEnvelope(
      await suggest(testApp, { q: 'Fixture', kind: 'place' }),
      'unauthenticated',
    );
    await expectEnvelope(
      await suggest(testApp, { q: 'ab', kind: 'place' }, { auth }),
      'invalid_request',
    );
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth: cookie, origin: null }),
      'origin_rejected',
    );
    const windowStart = new Date(
      Math.floor(testApp.deps.clock.now().getTime() / MINUTE_MS) * MINUTE_MS,
    );
    // The requests above already counted in this window.
    await testApp.deps.db.execute(
      sql`insert into rate_limits (key, window_start, count)
          values (${`u:${user.id}:geo_suggest:1m`}, ${windowStart}, ${PER_MINUTE})
          on conflict (key, window_start) do update set count = excluded.count`,
    );
    const limited = await expectEnvelope(
      await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth }),
      'rate_limited',
    );
    expect(limited.error.fields).toEqual({});
  });

  it('requires a session', async () => {
    const { testApp, user } = await setup();
    await expectEnvelope(
      await suggest(testApp, { q: 'Fixture', kind: 'place' }),
      'unauthenticated',
    );
    const now = testApp.deps.clock.now();
    const expired = await signIn(testApp.deps.db, user, 'bearer', {
      authenticatedAt: new Date(now.getTime() - 100 * DAY_MS),
      expiresAt: new Date(now.getTime() - MINUTE_MS),
    });
    await expectEnvelope(
      await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth: expired }),
      'unauthenticated',
    );
  });

  it('a session still in sign-up is served', async () => {
    const { testApp, auth } = await setup({ onboardingStep: 'location' });
    const page = await expectPage(
      await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth }),
    );
    expect(page.items.map((item) => item.label)).toEqual(['Fixture City, ZZ']);
  });

  it('checks origin on cookie writes', async () => {
    const { testApp, user } = await setup();
    const cookie = await signIn(testApp.deps.db, user, 'cookie');
    await expectEnvelope(
      await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth: cookie, origin: null }),
      'origin_rejected',
    );
    await expectEnvelope(
      await suggest(
        testApp,
        { q: 'Fixture', kind: 'place' },
        { auth: cookie, origin: 'https://elsewhere.example' },
      ),
      'origin_rejected',
    );
    await expectPage(await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth: cookie }));
  });

  it('suspended accounts cannot write', async () => {
    const { testApp, auth } = await setup({
      table: { [TYPED]: oneResult(TYPED) },
      status: 'suspended',
    });
    await expectEnvelope(await suggest(testApp, address(), { auth }), 'account_suspended');
    expect(testApp.fakes.outbound.calls).toEqual([]);
    expect(await counter(testApp, 'geo.month')).toBeNull();
  });

  it('rate-limited', async () => {
    const { testApp, user, auth } = await setup();
    const now = testApp.deps.clock.now();
    const windowStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
    await insertRateCounter(testApp.deps.db, {
      key: `u:${user.id}:geo_suggest:1m`,
      windowStart,
      count: PER_MINUTE,
    });
    const response = await suggest(testApp, { q: 'Fixture', kind: 'place' }, { auth });
    await expectEnvelope(response, 'rate_limited');
    const left = Math.ceil((windowStart.getTime() + MINUTE_MS - now.getTime()) / SECOND_MS);
    expect(response.headers.get('retry-after')).toBe(String(left));
  });

  it('a marker query appears in no log line and no table', async () => {
    const q = `Fixture ${marker()}`;
    const { testApp, auth } = await setup({
      table: { [q]: oneResult(`1 Fixture Way ${marker()}`) },
    });
    const place = await expectPage(await suggest(testApp, { q, kind: 'place' }, { auth }));
    expect(place.attribution).toBeNull();
    const suggested = await expectPage(await suggest(testApp, address(q), { auth }));
    expect(suggested.items.map((item) => item.label)).toEqual([`1 Fixture Way ${marker()}`]);
    // The text reached the provider, its one intended recipient.
    expect(testApp.fakes.outbound.calls).toHaveLength(1);
    expect(testApp.logs.length).toBeGreaterThan(0);
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain(marker());
      expect(line.raw.toLowerCase()).not.toContain(marker().toLowerCase());
    }
    expect(await findTextInTables(testApp.deps.db, marker())).toEqual([]);
    expect(await findTextInTables(testApp.deps.db, marker().toLowerCase())).toEqual([]);
    // The scan finds a value where one is stored, so an empty answer means something.
    expect(await findTextInTables(testApp.deps.db, 'fixture.geo@example.test')).toContain(
      'users.email',
    );
  });
});
