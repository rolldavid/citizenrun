import { clientErrors, rateLimits, workerHeartbeats } from '@citizenrun/db';
import { getTestDb, insertUser, insertWorkerHeartbeat } from '@citizenrun/db/testing';
import { newId } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { signIn } from './testing/auth.ts';
import { createTestApp } from './testing/app.ts';
import type { TestApp } from './testing/app.ts';

// INV-15: two instances over one database keep nothing in process but the per-replica memory
// counters and the web export read at start; sessions and per-user limits live in Postgres.

const MINUTE_MS = 60_000;
// clientErrors allows 20 a minute per address, held in memory at half per replica (D-240, D-408).
const CLIENT_ERRORS_PER_REPLICA = 10;
// clientErrors allows 20 a minute per user, counted in rate_limits (D-408).
const CLIENT_ERRORS_PER_USER = 20;

let nextHost = 100;
function freshIp(): string {
  const ip = `203.0.113.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

function validReport(): Record<string, unknown> {
  return {
    name: 'TypeError',
    code: 'render.failed',
    route: '/office/[slug]',
    component: 'OfficeScreen',
    appVersion: '1.4.0',
    platform: 'ios',
    frames: [{ file: 'src/features/office/office-screen.tsx', line: 42, column: 7 }],
    requestId: newId(),
  };
}

// Two instances with one clock, so both judge the same heartbeat at the same instant.
async function twoInstances(): Promise<[TestApp, TestApp]> {
  const clock = new FakeClock();
  return [await createTestApp({ clock }), await createTestApp({ clock })];
}

async function readiness(testApp: TestApp): Promise<unknown> {
  const response = await testApp.request.get('/readyz', { client: null, ip: freshIp() });
  expect(response.status).toBe(200);
  return response.json();
}

describe('a stateless API', () => {
  it('readiness reads one heartbeat for both instances', async () => {
    const [a, b] = await twoInstances();
    const now = a.deps.clock.now();
    await insertWorkerHeartbeat(getTestDb(), { beatAt: now });
    expect(await readiness(a)).toEqual({ db: 'ok', worker: 'ok' });
    expect(await readiness(b)).toEqual({ db: 'ok', worker: 'ok' });
    await getTestDb()
      .update(workerHeartbeats)
      .set({ beatAt: new Date(now.getTime() - 6 * MINUTE_MS) });
    expect(await readiness(a)).toEqual({ db: 'ok', worker: 'stale' });
    expect(await readiness(b)).toEqual({ db: 'ok', worker: 'stale' });
  });

  it('a client error sent to A is stored where B reads', async () => {
    const [a, b] = await twoInstances();
    const first = await a.request.post('/v1/client-errors', { ip: freshIp(), body: validReport() });
    const second = await b.request.post('/v1/client-errors', {
      ip: freshIp(),
      body: validReport(),
    });
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    const rows = await b.deps.db.select().from(clientErrors);
    expect(rows).toHaveLength(2);
  });

  it('both instances serve the same shell', async () => {
    const [a, b] = await twoInstances();
    const fromA = await a.request.get('/', { client: null, ip: freshIp() });
    const fromB = await b.request.get('/', { client: null, ip: freshIp() });
    expect(fromA.status).toBe(200);
    expect(fromB.status).toBe(200);
    const bodyA = await fromA.text();
    expect(bodyA.length).toBeGreaterThan(0);
    expect(await fromB.text()).toBe(bodyA);
    expect(fromB.headers.get('content-security-policy-report-only')).toBe(
      fromA.headers.get('content-security-policy-report-only'),
    );
  });

  it('memory limits are per instance, the only counters kept in process', async () => {
    const [a, b] = await twoInstances();
    const ip = '203.0.113.200';
    for (let n = 1; n <= CLIENT_ERRORS_PER_REPLICA; n += 1) {
      const response = await a.request.post('/v1/client-errors', { ip, body: validReport() });
      expect(response.status, `report ${String(n)}`).toBe(204);
    }
    const refusedByA = await a.request.post('/v1/client-errors', { ip, body: validReport() });
    expect(refusedByA.status).toBe(429);
    const acceptedByB = await b.request.post('/v1/client-errors', { ip, body: validReport() });
    expect(acceptedByB.status).toBe(204);
  });

  it('request ids are unique across instances', async () => {
    const [a, b] = await twoInstances();
    const ids = new Set<string>();
    for (let n = 0; n < 20; n += 1) {
      const instance = n % 2 === 0 ? a : b;
      const response = await instance.request.get('/healthz', { client: null, ip: freshIp() });
      expect(response.status).toBe(200);
      ids.add(response.headers.get('x-request-id') ?? '');
    }
    expect(ids.size).toBe(20);
    expect(ids.has('')).toBe(false);
  });
  it('a session created through A authenticates on B', async () => {
    const [a, b] = await twoInstances();
    const user = await insertUser(getTestDb());
    const auth = await signIn(getTestDb(), user, 'bearer');
    const onA = await a.request.post('/v1/client-errors', {
      auth,
      ip: freshIp(),
      body: validReport(),
    });
    const onB = await b.request.post('/v1/client-errors', {
      auth,
      ip: freshIp(),
      body: validReport(),
    });
    expect(onA.status).toBe(204);
    expect(onB.status).toBe(204);
    const rows = await getTestDb().select().from(rateLimits);
    expect(rows.map((row) => [row.key, row.count])).toEqual([[`u:${user.id}:client_err:1m`, 2]]);
  });

  it('a per-user limit counted on A is enforced on B', async () => {
    const [a, b] = await twoInstances();
    // Within one minute of the shared clock.
    const minute = Math.ceil(a.deps.clock.now().getTime() / MINUTE_MS) * MINUTE_MS;
    a.deps.clock.set(new Date(minute + 1000));
    const user = await insertUser(getTestDb());
    const auth = await signIn(getTestDb(), user, 'bearer');
    for (let n = 1; n <= CLIENT_ERRORS_PER_USER; n += 1) {
      const response = await a.request.post('/v1/client-errors', {
        auth,
        ip: `203.0.113.${String(n)}`,
        body: validReport(),
      });
      expect(response.status, `report ${String(n)}`).toBe(204);
    }
    const refusedByB = await b.request.post('/v1/client-errors', {
      auth,
      ip: '203.0.113.21',
      body: validReport(),
    });
    expect(refusedByB.status).toBe(429);
    expect(refusedByB.headers.get('retry-after')).toBe('59');
  });
});
