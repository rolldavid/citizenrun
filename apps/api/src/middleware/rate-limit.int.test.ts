import { rateLimits } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { newId } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
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
