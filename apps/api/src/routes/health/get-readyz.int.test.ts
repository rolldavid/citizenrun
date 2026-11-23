import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb, createPool } from '@citizenrun/db';
import { getTestDb, insertWorkerHeartbeat } from '@citizenrun/db/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { Pool } from '../../lib/db.ts';
import { createTestApp } from '../../testing/app.ts';

// A database no connection reaches: nothing listens on port 1.
const UNREACHABLE_DATABASE_URL = 'postgres://citizenrun:citizenrun@127.0.0.1:1/none';
const CONNECT_TIMEOUT_MS = 500;
const ANSWER_WITHIN_MS = 3_000;
const MINUTE_MS = 60_000;
// The generated client's `web` tag file, read as text: the API never imports the client.
const WEB_CLIENT_FILE = resolve(
  import.meta.dirname,
  '../../../../../packages/shared/src/api/web/web.ts',
);

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

function minutesBefore(at: Date, minutes: number): Date {
  return new Date(at.getTime() - minutes * MINUTE_MS);
}

describe('GET /readyz', () => {
  it('200 with worker ok after a fresh heartbeat', async () => {
    const testApp = await createTestApp();
    await insertWorkerHeartbeat(getTestDb(), { beatAt: testApp.deps.clock.now() });
    const response = await testApp.request.get('/readyz', { client: null, ip: '203.0.113.100' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ db: 'ok', worker: 'ok' });
  });

  it('stale after six minutes, status unchanged', async () => {
    const testApp = await createTestApp();
    await insertWorkerHeartbeat(getTestDb(), {
      beatAt: minutesBefore(testApp.deps.clock.now(), 6),
    });
    const response = await testApp.request.get('/readyz', { ip: '203.0.113.101' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ db: 'ok', worker: 'stale' });
  });

  it('exactly five minutes is ok', async () => {
    const testApp = await createTestApp();
    await insertWorkerHeartbeat(getTestDb(), {
      beatAt: minutesBefore(testApp.deps.clock.now(), 5),
    });
    const atFive = await testApp.request.get('/readyz', { ip: '203.0.113.102' });
    expect(await atFive.json()).toEqual({ db: 'ok', worker: 'ok' });
    testApp.deps.clock.advance(1_000);
    const pastFive = await testApp.request.get('/readyz', { ip: '203.0.113.103' });
    expect(await pastFive.json()).toEqual({ db: 'ok', worker: 'stale' });
  });

  it('the newest of several heartbeats decides', async () => {
    const testApp = await createTestApp();
    const now = testApp.deps.clock.now();
    await insertWorkerHeartbeat(getTestDb(), { worker: 'old', beatAt: minutesBefore(now, 30) });
    await insertWorkerHeartbeat(getTestDb(), { worker: 'new', beatAt: minutesBefore(now, 1) });
    const response = await testApp.request.get('/readyz', { ip: '203.0.113.104' });
    expect(await response.json()).toEqual({ db: 'ok', worker: 'ok' });
  });

  it('stale with no heartbeat row', async () => {
    const testApp = await createTestApp();
    const response = await testApp.request.get('/readyz', { ip: '203.0.113.105' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ db: 'ok', worker: 'stale' });
  });

  it('503 when the pool cannot connect', async () => {
    const testApp = await createTestApp({ db: unreachableDb() });
    const started = performance.now();
    const response = await testApp.request.get('/readyz', { ip: '203.0.113.106' });
    expect(performance.now() - started).toBeLessThan(ANSWER_WITHIN_MS);
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ db: 'down', worker: 'unknown' });
    const downLines = testApp.logs.filter((line) => line.parsed['event'] === 'readyz.db_down');
    expect(downLines).toHaveLength(1);
    expect(downLines[0]?.parsed['level']).toBe('warn');
    expect(downLines[0]?.parsed['errorClass']).toEqual(expect.any(String));
    expect(downLines[0]?.parsed).not.toHaveProperty('message');
    expect(downLines[0]?.parsed).not.toHaveProperty('error');
    expect(downLines[0]?.parsed).not.toHaveProperty('stack');
    expect(downLines[0]?.raw).not.toContain('127.0.0.1');
  });

  it('503 after SIGTERM', async () => {
    const testApp = await createTestApp();
    await insertWorkerHeartbeat(getTestDb(), { beatAt: testApp.deps.clock.now() });
    testApp.deps.lifecycle.beginDrain();
    const response = await testApp.request.get('/readyz', { ip: '203.0.113.107' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ db: 'down', worker: 'unknown' });
    expect(testApp.statementCount()).toBe(0);
  });

  it('rate-limited', async () => {
    const testApp = await createTestApp();
    testApp.deps.clock.set('2026-11-23T12:00:50.000Z');
    // web_health allows 600 a minute, held in memory at half per replica (D-240).
    for (let index = 0; index < 300; index += 1) {
      const allowed = await testApp.request.get('/readyz', { ip: '203.0.113.200' });
      expect(allowed.status).toBe(200);
    }
    const refused = await testApp.request.get('/readyz', { ip: '203.0.113.200' });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(refused.headers.get('retry-after')).toBe('10');
    expect(await refused.text()).toBe('Too many requests');
  });

  it('the generated client exposes the hook the hello screen uses', () => {
    const text = readFileSync(WEB_CLIENT_FILE, 'utf8');
    expect(text).toContain('export function useGetReadyz');
    expect(text).toContain('/readyz');
  });
});
