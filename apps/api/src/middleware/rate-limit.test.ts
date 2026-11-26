import { createRoute } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@citizenrun/shared';
import { loadKeyRing } from '@citizenrun/shared/crypto';
import { FakeClock, eachZone } from '@citizenrun/shared/testing';
import type { RateLimitPolicyName } from '../config/rate-limits.ts';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { RouteContext } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { handleError, notFound } from './handle-error.ts';
import { logRequest } from './log-request.ts';
import {
  addressHash,
  addressHashOf,
  checkRateLimitPolicyIn,
  clientAddress,
  createMemoryStore,
  decideRateLimit,
  limit,
  rateLimitV1,
} from './rate-limit.ts';
import type { RateLimitPolicyTable } from './rate-limit.ts';
import {
  addrKey,
  emailCodeKey,
  retryAfterSeconds,
  userKey,
  windowStart,
} from './rate-limit-store.ts';
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

  it('a /v1 request no route declares counts against v1.unmatched', async () => {
    const deps = createUnitDeps();
    const { app } = buildApp(deps, RATE_LIMIT_POLICIES, () => undefined);
    // 120 a minute, halved per replica: the 61st unknown request from one address is refused.
    const statuses: number[] = [];
    for (let n = 0; n < 61; n += 1) {
      statuses.push((await app.request(`/v1/nothing/${String(n)}`, from(ADDRESS))).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 404)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect((await app.request('/v1/nothing', from(OTHER_ADDRESS))).status).toBe(404);

    // A table without the policy fails loudly instead of letting the request pass.
    const fixture = fixtureApp(createUnitDeps());
    const unknown = await fixture.app.request('/v1/nothing', from(ADDRESS));
    expect(unknown.status).toBe(500);
    expect(fixture.errors.at(-1)?.message).toBe('unknown rate-limit policy v1.unmatched');
  });

  it('IPv4, mapped and IPv6 addresses hash as CTL-07 normalises them', () => {
    const ring = createUnitDeps().keyRing;
    const now = new Date('2027-03-05T12:00:00.000Z');
    const hash = (addr: string) => addressHashOf(ring, addr, now);
    expect(hash('  203.0.113.7 ')).toBe(hash('203.0.113.7'));
    expect(hash('::ffff:203.0.113.7')).toBe(hash('203.0.113.7'));
    expect(hash('::ffff:cb00:7107')).toBe(hash('203.0.113.7'));
    expect(hash('2001:0db8:0000:0001:bbbb::2')).toBe(hash('2001:db8:0:1:aaaa::1'));
    expect(hash('[2001:db8:0:1::5%eth0]')).toBe(hash('2001:db8:0:1:aaaa::1'));
    expect(hash('2001:DB8::1')).toBe(hash('2001:db8::ffff'));
    expect(hash('2001:db8:0:2::1')).not.toBe(hash('2001:db8:0:1::1'));
    expect(hash('203.0.113.8')).not.toBe(hash('203.0.113.7'));
  });

  it('the address hash uses the daily salt', () => {
    const ring0 = loadKeyRing('00'.repeat(32), null);
    expect(addressHashOf(ring0, '203.0.113.7', new Date('2027-03-05T12:00:00.000Z'))).toBe(
      'e0a44b312533f30faebbd79e8f92007a5625bca457e162bc74c3d1f098d3bac4',
    );
    expect(addressHashOf(ring0, '203.0.113.7', new Date('2027-03-06T12:00:00.000Z'))).toBe(
      'e9f0854f007bf6acedabb795bc8e12ae52dd4cf5b7d34fc3cf8df0cb52f53bd5',
    );
  });

  it('one /64 hashes once', () => {
    const ring = createUnitDeps().keyRing;
    const now = new Date('2027-03-05T12:00:00.000Z');
    const hash = (addr: string) => addressHashOf(ring, addr, now);
    expect(hash('2001:db8:1:2::1')).toBe(hash('2001:db8:1:2:ffff::9'));
    expect(hash('2001:db8:1:3::1')).not.toBe(hash('2001:db8:1:2::1'));
    expect(hash('::ffff:203.0.113.7')).toBe(hash('203.0.113.7'));
  });

  it('the last forwarded element is the client', async () => {
    const app = createRouter();
    app.get('/probe/address', (c) => c.text(clientAddress(c, 'x-real-ip')));
    const forwarded = await app.request('/probe/address', {
      headers: { 'x-real-ip': '198.51.100.1, 203.0.113.9' },
    });
    expect(await forwarded.text()).toBe('203.0.113.9');
    // No configured header, and in process no socket.
    const unset = createRouter();
    unset.get('/probe/address', (c) => c.text(clientAddress(c, null)));
    const none = await unset.request('/probe/address', { headers: { 'x-real-ip': ADDRESS } });
    expect(await none.text()).toBe('unknown');
  });

  it('windows are UTC', async () => {
    await eachZone(() => {
      const end = new Date('2027-03-05T23:59:59.999Z');
      expect(windowStart('1d', end).toISOString()).toBe('2027-03-05T00:00:00.000Z');
      expect(windowStart('1h', end).toISOString()).toBe('2027-03-05T23:00:00.000Z');
      expect(windowStart('1m', end).toISOString()).toBe('2027-03-05T23:59:00.000Z');
      expect(windowStart('1m', new Date('2027-03-05T12:34:00.000Z')).toISOString()).toBe(
        '2027-03-05T12:34:00.000Z',
      );
    });
  });

  it('Retry-After is whole seconds to the end', () => {
    expect(retryAfterSeconds('1h', new Date('2027-03-05T12:59:59.999Z'))).toBe(1);
    expect(retryAfterSeconds('1h', new Date('2027-03-05T12:00:00.000Z'))).toBe(3600);
    expect(retryAfterSeconds('1m', new Date('2027-03-05T12:00:30.500Z'))).toBe(30);
    expect(retryAfterSeconds('1d', new Date('2027-03-05T23:00:00.000Z'))).toBe(3600);
  });

  it('the largest Retry-After wins', () => {
    expect(
      decideRateLimit([
        { count: 21, limit: 20, retryAfter: 30 },
        { count: 5, limit: 60, retryAfter: 9000 },
        { count: 11, limit: 10, retryAfter: 3000 },
      ]),
    ).toEqual({ refused: true, retryAfter: 3000 });
    expect(
      decideRateLimit([
        { count: 20, limit: 20, retryAfter: 30 },
        { count: 1, limit: 10, retryAfter: 3000 },
      ]),
    ).toEqual({ refused: false, retryAfter: 0 });
    expect(decideRateLimit([])).toEqual({ refused: false, retryAfter: 0 });
  });

  it('keys follow the three families', () => {
    expect(userKey('u1', 'logout', '1m')).toBe('u:u1:logout:1m');
    expect(addrKey('h', 'auth_code', '1h')).toBe('ip:h:auth_code:1h');
    expect(emailCodeKey('e')).toBe('em:e:code:1h');
  });

  it('a 429 ApiError thrown by a service carries Retry-After', async () => {
    const deps = createUnitDeps();
    for (const code of ['rate_limited', 'signup_limit_reached'] as const) {
      const app = createRouter();
      app.use('*', requestVariables(deps));
      app.post('/v1/fixture', () => {
        throw new ApiError(code, { retryAfterSeconds: 20 });
      });
      app.onError(handleError(deps));
      const response = await app.request('/v1/fixture', { method: 'POST' });
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('20');
      expect(await response.json()).toMatchObject({ error: { code } });
    }
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
    expect(first).not.toContain(ADDRESS);
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
    const deps = createUnitDeps({ env: { CLIENT_IP_HEADER: undefined } });
    const { app } = fixtureApp(deps);
    // No configured header and, in process, no socket: every request is the address `unknown`.
    expect((await app.request('/v1/fixture', from(null))).status).toBe(200);
    expect((await app.request('/v1/fixture', from(ADDRESS))).status).toBe(200);
    expect((await app.request('/v1/fixture', from(OTHER_ADDRESS))).status).toBe(429);
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

  it('a full store walks its keys at most once per window end', () => {
    const store = createMemoryStore(3);
    const now = new Date('2027-03-05T12:00:10.000Z');
    store.hit('a', '1m', now);
    store.hit('b', '1h', now);
    store.hit('c', '1m', now);
    // A walk of the store is one iteration of its map; only the hits below are counted.
    const iterate = Reflect.get(Map.prototype, Symbol.iterator) as () => Iterator<unknown>;
    let counting = false;
    let walks = 0;
    const spy = vi.spyOn(Map.prototype, Symbol.iterator).mockImplementation(function (
      this: Map<unknown, unknown>,
    ) {
      if (counting) {
        walks += 1;
      }
      return Reflect.apply(iterate, this, []) as MapIterator<[unknown, unknown]>;
    });
    const hits = (keys: readonly string[], at: Date): unknown[] => {
      counting = true;
      try {
        return keys.map((key) => store.hit(key, '1m', at));
      } finally {
        counting = false;
      }
    };
    try {
      const flood = Array.from({ length: 50 }, (_, n) => `new-${String(n)}`);
      // Nothing has ended before 12:01, so 50 new keys are refused without one walk.
      expect(hits(flood, now)).toEqual(flood.map(() => 'full'));
      expect(walks).toBe(0);

      // The first new key after 12:01 walks once, drops 'a' and 'c' and is stored.
      const nextMinute = new Date('2027-03-05T12:01:05.000Z');
      expect(hits(['d', 'e'], nextMinute)).toEqual([
        { count: 1, windowEnd: new Date('2027-03-05T12:02:00.000Z') },
        { count: 1, windowEnd: new Date('2027-03-05T12:02:00.000Z') },
      ]);
      expect(walks).toBe(1);
      // Full again; the earliest end is 12:02, so the flood walks nothing until then.
      expect(hits(flood, nextMinute)).toEqual(flood.map(() => 'full'));
      expect(walks).toBe(1);
      expect(hits(['f'], new Date('2027-03-05T12:02:00.000Z'))).toEqual([
        { count: 1, windowEnd: new Date('2027-03-05T12:03:00.000Z') },
      ]);
      expect(walks).toBe(2);
    } finally {
      spy.mockRestore();
    }
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

  it('a user rule needs a viewer and a logged-out rule none', async () => {
    const deps = createUnitDeps();
    const now = deps.clock.now();
    const table: RateLimitPolicyTable = {
      users: [{ subject: 'user', action: 'fixture_u', limit: 2, window: '1m', store: 'memory' }],
      anonymous: [
        {
          subject: 'ip',
          action: 'fixture_a',
          limit: 2,
          window: '1m',
          store: 'memory',
          when: 'logged_out',
        },
      ],
    };
    const check = (policy: string, userId: string | null) =>
      checkRateLimitPolicyIn(deps, table, { policy, userId, addrHash: 'fixture-hash', now });
    for (let n = 0; n < 3; n += 1) {
      expect(await check('users', null)).toEqual({ ok: true });
      expect(await check('anonymous', 'fixture-user')).toEqual({ ok: true });
    }
    // Half of 2 per replica: the second request of each counted rule is refused.
    expect(await check('users', 'fixture-user')).toEqual({ ok: true });
    expect((await check('users', 'fixture-user')).ok).toBe(false);
    expect(await check('anonymous', null)).toEqual({ ok: true });
    expect((await check('anonymous', null)).ok).toBe(false);
  });

  it('a db rule counts through the database', async () => {
    // Unit deps have no database: a db rule reaches it instead of passing uncounted.
    const deps = createUnitDeps();
    const table: RateLimitPolicyTable = {
      stored: [{ subject: 'ip', action: 'fixture_db', limit: 2, window: '1m', store: 'db' }],
    };
    await expect(
      checkRateLimitPolicyIn(deps, table, {
        policy: 'stored',
        userId: null,
        addrHash: 'fixture-hash',
        now: deps.clock.now(),
      }),
    ).rejects.toThrow('unit deps have no database');
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
