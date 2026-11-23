import { readFile } from 'node:fs/promises';
import { ERROR_CODES } from '@citizenrun/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { OPENAPI_FILE } from '../../scripts/gen-openapi.ts';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import type { TestResponse } from '../../testing/request.ts';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
// ref.openapi allows 30 a minute per address, held in memory at half per replica (D-240).
const PER_REPLICA_LIMIT = 15;
const MINUTE_SECONDS = 60;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

let testApp: TestApp;

beforeAll(async () => {
  testApp = await createTestApp();
});

function request(): Promise<TestResponse> {
  return testApp.request.get('/v1/openapi.json');
}

async function committedDocument(): Promise<unknown> {
  return JSON.parse(await readFile(OPENAPI_FILE, 'utf8'));
}

describe('GET /v1/openapi.json', () => {
  it('serves the committed document', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual(await committedDocument());
  });

  it('needs no client header', async () => {
    const response = await testApp.request.get('/v1/openapi.json', { client: null });
    expect(response.status).not.toBe(400);
    expect(response.status).not.toBe(426);
    expect(response.status).toBe(200);
  });

  it('sets the cache header', async () => {
    const response = await request();
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('every operation has x-route with auth and rateLimit', async () => {
    const response = await request();
    const document: unknown = await response.json();
    const paths = isObject(document) ? document['paths'] : undefined;
    expect(isObject(paths)).toBe(true);
    let operations = 0;
    for (const item of Object.values(isObject(paths) ? paths : {})) {
      for (const method of HTTP_METHODS) {
        const operation = isObject(item) ? item[method] : undefined;
        if (operation === undefined) {
          continue;
        }
        operations += 1;
        const route = isObject(operation) ? operation['x-route'] : undefined;
        expect(route).toMatchObject({ auth: expect.any(String), rateLimit: expect.any(String) });
        expect(isObject(operation) && Array.isArray(operation['x-errors'])).toBe(true);
      }
    }
    expect(operations).toBeGreaterThan(0);
  });

  it('rate-limited', async () => {
    const ip = '203.0.113.200';
    for (let index = 0; index < PER_REPLICA_LIMIT; index += 1) {
      const allowed = await testApp.request.get('/v1/openapi.json', { ip });
      expect(allowed.status).toBe(200);
    }
    const refused = await testApp.request.get('/v1/openapi.json', { ip });
    expect(refused.status).toBe(429);
    const secondsLeft = MINUTE_SECONDS - testApp.deps.clock.now().getUTCSeconds();
    expect(refused.headers.get('retry-after')).toBe(String(secondsLeft));
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('envelope on every error', async () => {
    // Its own address, so it counts only its own requests.
    const ip = '203.0.113.201';
    let refused: TestResponse | null = null;
    for (let index = 0; index <= PER_REPLICA_LIMIT; index += 1) {
      refused = await testApp.request.get('/v1/openapi.json', { ip });
    }
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await refused?.json()).toEqual({
      error: { code: 'rate_limited', message: ERROR_CODES.rate_limited.message, fields: {} },
    });
  });
});
