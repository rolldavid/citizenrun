import { createDb, createPool } from '@citizenrun/db';
import { afterEach, describe, expect, it } from 'vitest';
import type { Pool } from '../../lib/db.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';

// A database no query reaches: nothing listens on port 1.
const UNREACHABLE_DATABASE_URL = 'postgres://citizenrun:citizenrun@127.0.0.1:1/none';
const CONNECT_TIMEOUT_MS = 500;
// web_health allows 600 a minute, held in memory at half per replica (D-240).
const PER_REPLICA_LIMIT = 300;

let openPools: Pool[] = [];

afterEach(async () => {
  const pools = openPools;
  openPools = [];
  await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
});

function unreachableDb(): ReturnType<typeof createDb> {
  const pool = createPool(UNREACHABLE_DATABASE_URL, { max: 1 });
  // pg reads the connection timeout from the pool's options at each connect.
  pool.options.connectionTimeoutMillis = CONNECT_TIMEOUT_MS;
  openPools.push(pool);
  return createDb(pool);
}

function head(testApp: TestApp, path: string): Promise<Response> {
  return Promise.resolve(
    testApp.app.request(new URL(path, testApp.deps.env.PUBLIC_URL).toString(), {
      method: 'HEAD',
      headers: { 'x-real-ip': '203.0.113.120' },
    }),
  );
}

describe('GET /healthz', () => {
  it('ok', async () => {
    const testApp = await createTestApp();
    const response = await testApp.request.get('/healthz', { client: null, ip: '203.0.113.100' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers while the database is unreachable', async () => {
    const testApp = await createTestApp({ db: unreachableDb() });
    const response = await testApp.request.get('/healthz', { ip: '203.0.113.101' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers during the drain', async () => {
    const testApp = await createTestApp();
    testApp.deps.lifecycle.beginDrain();
    const response = await testApp.request.get('/healthz', { ip: '203.0.113.102' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('makes no database query', async () => {
    const testApp = await createTestApp();
    await testApp.request.get('/healthz', { ip: '203.0.113.103' });
    expect(testApp.statementCount()).toBe(0);
  });

  it('HEAD answers with no body', async () => {
    const testApp = await createTestApp();
    const response = await head(testApp, '/healthz');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('rate-limited', async () => {
    const testApp = await createTestApp();
    testApp.deps.clock.set('2026-11-23T12:00:20.000Z');
    for (let index = 0; index < PER_REPLICA_LIMIT; index += 1) {
      const allowed = await testApp.request.get('/healthz', { ip: '203.0.113.200' });
      expect(allowed.status).toBe(200);
    }
    const refused = await testApp.request.get('/healthz', { ip: '203.0.113.200' });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(refused.headers.get('retry-after')).toBe('40');
    expect(await refused.text()).toBe('Too many requests');
  });

  it('no session is read', async () => {
    const testApp = await createTestApp();
    const plain = await testApp.request.get('/healthz', { ip: '203.0.113.104' });
    const withCookie = await testApp.request.get('/healthz', {
      ip: '203.0.113.105',
      auth: { kind: 'cookie', token: 'fixture-session-token' },
    });
    expect(withCookie.status).toBe(plain.status);
    expect(await withCookie.json()).toEqual(await plain.json());
    expect(withCookie.headers.get('set-cookie')).toBeNull();
    expect(testApp.statementCount()).toBe(0);
  });
});
