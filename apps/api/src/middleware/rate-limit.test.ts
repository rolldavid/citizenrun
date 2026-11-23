import { createRoute } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '@citizenrun/shared/testing';
import type { RateLimitPolicyName } from '../config/rate-limits.ts';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { RouteContext } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { handleError, notFound } from './handle-error.ts';
import { logRequest } from './log-request.ts';
import {
  addressHash,
  checkRateLimitPolicyIn,
  createMemoryStore,
  limit,
  normaliseAddress,
  rateLimitV1,
} from './rate-limit.ts';
import type { RateLimitPolicyTable } from './rate-limit.ts';
import { RATE_LIMIT_POLICIES } from '../config/rate-limits.ts';
import { requestId } from './request-id.ts';
import { createRouteMetaIndex } from './route-meta.ts';
import { requestVariables } from './variables.ts';

const NO_CONTEXT: RouteContext = { routeMiddleware: [], getOpenApiDocument: () => ({}) };
const ADDRESS = '203.0.113.7';
const OTHER_ADDRESS = '198.51.100.4';

const FIXTURE_TABLE: RateLimitPolicyTable = {
  fixture_policy: [{ subject: 'ip', action: 'fixture', limit: 4, window: '1m', store: 'memory' }],
};

type UnitDeps = ReturnType<typeof createUnitDeps>;

// A route whose policy names any string, as the admin server's table does (D-801).
function fixtureOperation(path: string, operationId: string, policy: string) {
  return createRoute({
    method: 'get',
    path,
    operationId,
    responses: { 200: { description: 'Ok.' } },
    'x-route': { auth: 'none', rateLimit: policy },
    'x-errors': ['rate_limited'],
  });
}

function policyRoute(policy: RateLimitPolicyName) {
  return defineRoute({
    method: 'get',
    path: '/v1/limited',
    operationId: 'getLimited',
    responses: { 200: { description: 'Ok.' } },
    meta: { auth: 'none', rateLimit: policy },
    errors: ['rate_limited'],
  });
}

// requestVariables, addressHash and the /v1 limiter over `table`, with the error handlers.
function buildApp(
  deps: UnitDeps,
  table: RateLimitPolicyTable,
  register: (app: ReturnType<typeof createRouter>) => void,
) {
  const index = createRouteMetaIndex();
  const app = createRouter();
  const errors: Error[] = [];
  app.use('*', requestVariables(deps));
  app.use('*', addressHash(deps));
  app.use('/v1/*', rateLimitV1(deps, index, table));
  app.get('/probe/addr-hash', (c) => c.json({ addrHash: c.get('addrHash') }));
  register(app);
  index.load(app);
  const handler = handleError(deps);
  app.onError((error, c) => {
    errors.push(error);
    return handler(error, c);
  });
  app.notFound(notFound(deps));
  return { app, errors };
}

function fixtureApp(deps: UnitDeps) {
  return buildApp(deps, FIXTURE_TABLE, (app) => {
    app.openapi(fixtureOperation('/v1/fixture', 'getFixture', 'fixture_policy'), (c) =>
      c.json({ ok: true }),
    );
    app.openapi(fixtureOperation('/v1/unlisted', 'getUnlisted', 'not_in_table'), (c) =>
      c.json({ ok: true }),
    );
  });
}

function from(address: string | null): RequestInit {
  return address === null ? {} : { headers: { 'x-real-ip': address } };
}

async function hashOf(
  app: { request(path: string, init?: RequestInit): Response | Promise<Response> },
  address: string,
) {
  const response = await app.request('/probe/addr-hash', from(address));
  const body: unknown = await response.json();
  return (body as { addrHash: string | null }).addrHash; // the probe's own body
}

describe('rate limits', () => {
  it('the v1 limiter reads the table it is given', async () => {
    const deps = createUnitDeps();
    const { app, errors } = fixtureApp(deps);
    const statuses: number[] = [];
    for (let n = 0; n < 3; n += 1) {
      statuses.push((await app.request('/v1/fixture', from(ADDRESS))).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
    const refused = await app.request('/v1/fixture', from(ADDRESS));
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });

    const unlisted = await app.request('/v1/unlisted', from(ADDRESS));
    expect(unlisted.status).toBe(500);
    expect(errors.at(-1)?.message).toBe('unknown rate-limit policy not_in_table');
  });

  it('IPv4, mapped and IPv6 addresses normalise as CTL-07 says', () => {
    expect(normaliseAddress('203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseAddress('  203.0.113.7 ')).toBe('203.0.113.7');
    expect(normaliseAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseAddress('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(normaliseAddress('2001:db8:0:1:aaaa::1')).toBe('2001:db8:0:1::/64');
    expect(normaliseAddress('2001:0db8:0000:0001:bbbb::2')).toBe('2001:db8:0:1::/64');
    expect(normaliseAddress('[2001:db8:0:1::5%eth0]')).toBe('2001:db8:0:1::/64');
    expect(normaliseAddress('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(normaliseAddress('::1')).toBe('0:0:0:0::/64');
    expect(normaliseAddress('garbage')).toBeNull();
    expect(normaliseAddress('')).toBeNull();
  });

  it('the last element of a forwarded list is used', async () => {
    const deps = createUnitDeps();
    const { app } = fixtureApp(deps);
    const listed = await hashOf(app, `${OTHER_ADDRESS}, ${ADDRESS}`);
    expect(listed).toBe(await hashOf(app, ADDRESS));
    expect(listed).not.toBe(await hashOf(app, OTHER_ADDRESS));
  });

  it('the hash changes with the UTC day and never holds the address', async () => {
    const clock = new FakeClock('2027-03-05T23:59:00.000Z');
    const deps = createUnitDeps({ clock });
    const { app } = fixtureApp(deps);
    const first = await hashOf(app, ADDRESS);
    clock.advance(30_000);
    const sameDay = await hashOf(app, ADDRESS);
    clock.advance(60_000);
    const nextDay = await hashOf(app, ADDRESS);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(sameDay).toBe(first);
    expect(nextDay).not.toBe(first);
    expect(first).not.toContain('203');
    // Two addresses of one /64 share a hash; another /64 does not.
    expect(await hashOf(app, '2001:db8:0:1::5')).toBe(await hashOf(app, '2001:db8:0:1:ffff::9'));
    expect(await hashOf(app, '2001:db8:0:1::5')).not.toBe(await hashOf(app, '2001:db8:0:2::5'));
  });

  it('a memory rule allows half its limit per replica', async () => {
    const deps = createUnitDeps({ clock: new FakeClock('2027-03-05T12:00:30.000Z') });
    const { app } = buildApp(deps, RATE_LIMIT_POLICIES, (router) => {
      registerRoute(router, policyRoute('clientErrors'), (c) => c.json({ ok: true }), NO_CONTEXT);
    });
    for (let n = 1; n <= 10; n += 1) {
      expect((await app.request('/v1/limited', from(ADDRESS))).status).toBe(200);
    }
    const refused = await app.request('/v1/limited', from(ADDRESS));
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('30');
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('refused requests count', async () => {
    const store = createMemoryStore();
    const now = new Date('2027-03-05T12:00:10.000Z');
    const counts = [1, 2, 3, 4, 5].map(() => {
      const result = store.hit('ip:x:fixture:1m', '1m', now);
      return result === 'full' ? -1 : result.count;
    });
    expect(counts).toEqual([1, 2, 3, 4, 5]);

    // Requests the minute rule refuses still count toward the hour rule.
    const clock = new FakeClock('2027-03-05T12:00:10.000Z');
    const deps = createUnitDeps({ clock });
    const table: RateLimitPolicyTable = {
      two_rules: [
        { subject: 'ip', action: 'fixture_m', limit: 4, window: '1m', store: 'memory' },
        { subject: 'ip', action: 'fixture_h', limit: 8, window: '1h', store: 'memory' },
      ],
    };
    const check = () =>
      checkRateLimitPolicyIn(deps, table, {
        policy: 'two_rules',
        userId: null,
        addrHash: 'fixture-hash',
        now: clock.now(),
      });
    expect((await check()).ok).toBe(true);
    expect((await check()).ok).toBe(true);
    expect((await check()).ok).toBe(false);
    expect((await check()).ok).toBe(false);
    clock.advance(60_000);
    // A fresh minute, but the hour rule has counted four requests already, two of them refused.
    expect(await check()).toEqual({ ok: false, retryAfterSeconds: 60 * 60 - 70 });
  });

  it('a new window starts fresh', async () => {
    const clock = new FakeClock('2027-03-05T12:00:30.000Z');
    const deps = createUnitDeps({ clock });
    const { app } = fixtureApp(deps);
    await app.request('/v1/fixture', from(ADDRESS));
    await app.request('/v1/fixture', from(ADDRESS));
    expect((await app.request('/v1/fixture', from(ADDRESS))).status).toBe(429);
    clock.set('2027-03-05T12:01:00.000Z');
    expect((await app.request('/v1/fixture', from(ADDRESS))).status).toBe(200);
  });

  it('requests without an address share one bucket', async () => {
    const deps = createUnitDeps();
    const { app } = fixtureApp(deps);
    // No header and, in process, no socket: both count under the key ip:none:fixture:1m.
    expect((await app.request('/v1/fixture', from(null))).status).toBe(200);
    expect((await app.request('/v1/fixture', from('not an address'))).status).toBe(200);
    expect((await app.request('/v1/fixture', from(null))).status).toBe(429);
    expect((await app.request('/v1/fixture', from(ADDRESS))).status).toBe(200);
  });

  it('a full store refuses new keys after dropping past windows', () => {
    const store = createMemoryStore(3);
    const now = new Date('2027-03-05T12:00:10.000Z');
    expect(store.hit('a', '1m', now)).not.toBe('full');
    expect(store.hit('b', '1h', now)).not.toBe('full');
    expect(store.hit('c', '1m', now)).not.toBe('full');
    expect(store.hit('d', '1m', now)).toBe('full');
    // A key it holds still counts while the store is full.
    expect(store.hit('a', '1m', now)).toEqual({
      count: 2,
      windowEnd: new Date('2027-03-05T12:01:00.000Z'),
    });

    const nextMinute = new Date('2027-03-05T12:01:05.000Z');
    // 'a' and 'c' belong to a past window and are dropped; 'b' (the hour) stays.
    expect(store.hit('d', '1m', nextMinute)).toEqual({
      count: 1,
      windowEnd: new Date('2027-03-05T12:02:00.000Z'),
    });
    expect(store.hit('e', '1m', nextMinute)).not.toBe('full');
    expect(store.hit('f', '1m', nextMinute)).toBe('full');
    expect(store.hit('b', '1h', nextMinute)).toEqual({
      count: 2,
      windowEnd: new Date('2027-03-05T13:00:00.000Z'),
    });
  });

  it('a full store answers 429 with the seconds left in the window', async () => {
    const clock = new FakeClock('2027-03-05T12:00:45.000Z');
    const deps = createUnitDeps({ clock });
    const table: RateLimitPolicyTable = {
      roomy: [{ subject: 'ip', action: 'roomy', limit: 1_000_000, window: '1m', store: 'memory' }],
    };
    const check = (addrHash: string) =>
      checkRateLimitPolicyIn(deps, table, {
        policy: 'roomy',
        userId: null,
        addrHash,
        now: clock.now(),
      });
    // The per-replica map is 100,000 keys; fill it within one minute.
    for (let n = 0; n < 100_000; n += 1) {
      await check(`k${String(n)}`);
    }
    expect(await check('one-more')).toEqual({ ok: false, retryAfterSeconds: 15 });
  });

  it('two apps keep separate counters', async () => {
    const first = fixtureApp(createUnitDeps()).app;
    const second = fixtureApp(createUnitDeps()).app;
    await first.request('/v1/fixture', from(ADDRESS));
    await first.request('/v1/fixture', from(ADDRESS));
    expect((await first.request('/v1/fixture', from(ADDRESS))).status).toBe(429);
    expect((await second.request('/v1/fixture', from(ADDRESS))).status).toBe(200);
  });

  it('a user rule needs a viewer and a db rule is refused', async () => {
    const deps = createUnitDeps();
    const now = deps.clock.now();
    const userOnly: RateLimitPolicyTable = {
      users: [{ subject: 'user', action: 'fixture_u', limit: 2, window: '1m', store: 'memory' }],
      stored: [{ subject: 'ip', action: 'fixture_db', limit: 2, window: '1m', store: 'db' }],
    };
    for (let n = 0; n < 3; n += 1) {
      expect(
        await checkRateLimitPolicyIn(deps, userOnly, {
          policy: 'users',
          userId: null,
          addrHash: null,
          now,
        }),
      ).toEqual({ ok: true });
    }
    await expect(
      checkRateLimitPolicyIn(deps, userOnly, {
        policy: 'stored',
        userId: null,
        addrHash: null,
        now,
      }),
    ).rejects.toThrow('rate limit store db is not available');
  });

  it('a web route gets a plain-text 429', async () => {
    const deps = createUnitDeps({ clock: new FakeClock('2027-03-05T12:00:20.000Z') });
    const app = createRouter();
    app.use('*', requestVariables(deps));
    app.use('*', requestId());
    app.use('*', logRequest(deps));
    app.use('*', addressHash(deps));
    app.get('/robots.txt', limit(deps, 'web_seo'), (c) => c.text('User-agent: *\n'));
    for (let n = 1; n <= 60; n += 1) {
      expect((await app.request('/robots.txt', from(ADDRESS))).status).toBe(200);
    }
    const refused = await app.request('/robots.txt', from(ADDRESS));
    expect(refused.status).toBe(429);
    expect(refused.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(refused.headers.get('retry-after')).toBe('40');
    expect(await refused.text()).toBe('Too many requests');
    expect(deps.logs.at(-1)?.parsed).toMatchObject({
      event: 'request.done',
      route: '/robots.txt',
      status: 429,
      errorCode: 'rate_limited',
    });
  });
});
