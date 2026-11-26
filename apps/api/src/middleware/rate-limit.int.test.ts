import { rateLimits } from '@citizenrun/db';
import {
  insertDistrict,
  insertJurisdiction,
  insertOffice,
  insertOfficeholder,
  insertPerson,
  insertUser,
} from '@citizenrun/db/testing';
import { newId } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_POLICIES } from '../config/rate-limits.ts';
import { signIn } from '../testing/auth.ts';
import { createTestApp } from '../testing/app.ts';
import type { TestApp } from '../testing/app.ts';
import { checkRateLimitPolicyIn } from './rate-limit.ts';
import type { RateLimitPolicyTable } from './rate-limit.ts';
import { readWindow, userKey } from './rate-limit-store.ts';

// TEST-rate-limits (D-240): the db store through POST /v1/client-errors, whose user rule allows 20
// a minute in rate_limits and whose ip rule allows 20 a minute in memory, 10 per replica.
const PATH = '/v1/client-errors';
const MINUTE_MS = 60_000;
const USER_LIMIT = 20;
// ref.openapi allows 30 a minute per address, held in memory at half per replica.
const OPENAPI_PER_REPLICA = 15;

function validReport(): Record<string, unknown> {
  return {
    name: 'TypeError',
    code: 'render.failed',
    route: null,
    component: null,
    appVersion: '1.4.0',
    platform: 'ios',
    frames: [],
    requestId: newId(),
  };
}

// 15 seconds into the minute after the test app's clock.
function fifteenSecondsIn(testApp: TestApp): Date {
  const next = Math.ceil(testApp.deps.clock.now().getTime() / MINUTE_MS) * MINUTE_MS;
  return new Date(next + 15_000);
}

async function rowCount(testApp: TestApp): Promise<number> {
  const [row] = await testApp.deps.db
    .select({ count: sql<number>`count(*)::int` })
    .from(rateLimits);
  return row?.count ?? -1;
}

describe('rate limits in rate_limits', () => {
  it('fixed window and Retry-After', async () => {
    const testApp = await createTestApp();
    testApp.deps.clock.set(fifteenSecondsIn(testApp));
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    for (let n = 1; n <= USER_LIMIT; n += 1) {
      const response = await testApp.request.post(PATH, {
        auth,
        ip: `203.0.113.${String(n)}`,
        body: validReport(),
      });
      expect(response.status, `report ${String(n)}`).toBe(204);
    }
    const refused = await testApp.request.post(PATH, {
      auth,
      ip: '203.0.113.21',
      body: validReport(),
    });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect(refused.headers.get('retry-after')).toBe('45');

    const windowNow = testApp.deps.clock.now();
    testApp.deps.clock.set(new Date(Math.ceil(windowNow.getTime() / MINUTE_MS) * MINUTE_MS));
    const next = await testApp.request.post(PATH, {
      auth,
      ip: '203.0.113.22',
      body: validReport(),
    });
    expect(next.status).toBe(204);
  });

  it('every request counts', async () => {
    const testApp = await createTestApp();
    testApp.deps.clock.set(fifteenSecondsIn(testApp));
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const statuses: number[] = [];
    for (let n = 1; n <= USER_LIMIT + 1; n += 1) {
      const response = await testApp.request.post(PATH, {
        auth,
        ip: `203.0.113.${String(n)}`,
        body: validReport(),
      });
      statuses.push(response.status);
    }
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    const key = userKey(user.id, 'client_err', '1m');
    expect(await readWindow(testApp.deps.db, key, '1m', testApp.deps.clock.now())).toBe(21);
    // A refused request still counts: a 22nd makes 22.
    await testApp.request.post(PATH, { auth, ip: '203.0.113.30', body: validReport() });
    expect(await readWindow(testApp.deps.db, key, '1m', testApp.deps.clock.now())).toBe(22);
  });

  it('the client error user rule lives in rate_limits', async () => {
    const testApp = await createTestApp();
    for (let n = 0; n < 10; n += 1) {
      const response = await testApp.request.post(PATH, {
        ip: '203.0.113.40',
        body: validReport(),
      });
      expect(response.status).toBe(204);
    }
    // The ip rule counts in memory: logged out, nothing is written.
    expect(await rowCount(testApp)).toBe(0);

    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    expect(
      (await testApp.request.post(PATH, { auth, ip: '203.0.113.41', body: validReport() })).status,
    ).toBe(204);
    const rows = await testApp.deps.db.select().from(rateLimits);
    expect(rows.map((row) => [row.key, row.count])).toEqual([
      [userKey(user.id, 'client_err', '1m'), 1],
    ]);
  });

  it('anonymous reads are limited per replica in memory', async () => {
    const testApp = await createTestApp();
    testApp.deps.clock.set(fifteenSecondsIn(testApp));
    for (let n = 1; n <= OPENAPI_PER_REPLICA; n += 1) {
      const response = await testApp.request.get('/v1/openapi.json', { ip: '203.0.113.50' });
      expect(response.status, `read ${String(n)}`).toBe(200);
    }
    const refused = await testApp.request.get('/v1/openapi.json', { ip: '203.0.113.50' });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('45');
    expect(await rowCount(testApp)).toBe(0);
  });

  it('anonymous civic reads share one per-address budget in memory', async () => {
    const testApp = await createTestApp();
    const { db } = testApp.deps;
    const ipRule = RATE_LIMIT_POLICIES.civic_read.find((rule) => rule.subject === 'ip');
    if (ipRule === undefined) {
      throw new Error('civic_read has no per-address rule.');
    }
    // The memory store allows half the limit on each replica.
    const perReplica = Math.floor(ipRule.limit / 2);
    testApp.fakes.clock.set(new Date('2027-03-05T12:00:30.000Z'));
    const jurisdiction = await insertJurisdiction(db);
    const district = await insertDistrict(db, { jurisdictionId: jurisdiction.id });
    const office = await insertOffice(db, {
      jurisdictionId: jurisdiction.id,
      districtId: district.id,
      slug: 'fixture-civic-budget',
    });
    const person = await insertPerson(db, { slug: 'fixture-civic-budget-holder' });
    await insertOfficeholder(db, { personId: person.id, officeId: office.id });
    const user = await insertUser(db);
    const auth = await signIn(db, user, 'bearer', {
      expiresAt: new Date('2027-04-01T00:00:00.000Z'),
    });
    const paths = [
      `/v1/offices/${office.slug}`,
      `/v1/offices/${office.id}/candidates`,
      `/v1/people/${person.slug}`,
    ];
    const address = '203.0.113.7';
    for (let n = 0; n < perReplica; n += 1) {
      const path = paths[n % paths.length] ?? '';
      const response = await testApp.request.get(path, { ip: address });
      expect(response.status, `read ${String(n + 1)} of ${path}`).toBe(200);
    }
    // The three routes count under one key: the next read of any of them is refused.
    const refused = await testApp.request.get(`/v1/offices/${office.slug}`, { ip: address });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect(refused.headers.get('retry-after')).toBe('30');
    // The count is per address, and the logged-out rule lives in memory only.
    const other = await testApp.request.get(`/v1/offices/${office.slug}`, { ip: '203.0.113.8' });
    expect(other.status).toBe(200);
    expect(await rowCount(testApp)).toBe(0);
    // A signed-in request from the same address is counted per user, in rate_limits.
    const signedIn = await testApp.request.get(`/v1/offices/${office.slug}`, { auth, ip: address });
    expect(signedIn.status).toBe(200);
    const rows = await db.select().from(rateLimits);
    expect(rows.map((row) => [row.key, row.count])).toEqual([[userKey(user.id, 'civic', '1m'), 1]]);
    expect(rows.filter((row) => row.key.startsWith('ip:'))).toEqual([]);
    // The next window starts afresh.
    testApp.fakes.clock.set(new Date('2027-03-05T12:01:00.000Z'));
    const later = await testApp.request.get(`/v1/offices/${office.slug}`, { ip: address });
    expect(later.status).toBe(200);
  });

  it('a table given to the limiter is counted in rate_limits', async () => {
    const testApp = await createTestApp();
    const now = fifteenSecondsIn(testApp);
    const table: RateLimitPolicyTable = {
      fixture_db: [{ subject: 'ip', action: 'fixture_db', limit: 2, window: '1m', store: 'db' }],
    };
    const check = () =>
      checkRateLimitPolicyIn(testApp.deps, table, {
        policy: 'fixture_db',
        userId: null,
        addrHash: 'fixture-hash',
        now,
      });
    expect(await check()).toEqual({ ok: true });
    expect(await check()).toEqual({ ok: true });
    expect(await check()).toEqual({ ok: false, retryAfterSeconds: 45 });
    expect(await readWindow(testApp.deps.db, 'ip:fixture-hash:fixture_db:1m', '1m', now)).toBe(3);
    await expect(
      checkRateLimitPolicyIn(testApp.deps, table, {
        policy: 'fixture_missing',
        userId: null,
        addrHash: 'fixture-hash',
        now,
      }),
    ).rejects.toThrow('unknown rate-limit policy fixture_missing');
  });

  it('keys never hold an address', async () => {
    const testApp = await createTestApp();
    const user = await insertUser(testApp.deps.db);
    const auth = await signIn(testApp.deps.db, user, 'bearer');
    const table: RateLimitPolicyTable = {
      fixture_ip: [{ subject: 'ip', action: 'fixture_ip', limit: 5, window: '1h', store: 'db' }],
    };
    await testApp.request.post(PATH, { auth, ip: '203.0.113.60', body: validReport() });
    await checkRateLimitPolicyIn(testApp.deps, table, {
      policy: 'fixture_ip',
      userId: null,
      addrHash: 'a'.repeat(64),
      now: testApp.deps.clock.now(),
    });
    for (const row of await testApp.deps.db.select().from(rateLimits)) {
      expect(row.key).not.toContain('203.0.113');
      expect(row.key).toMatch(/^(u:[0-9a-f-]{36}|ip:[0-9a-f]{64}):[a-z_]+:(1m|1h|1d)$/);
    }
  });
});
