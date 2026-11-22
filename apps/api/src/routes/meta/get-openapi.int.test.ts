import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.ts';
import { createDocDeps } from '../../openapi.ts';
import { OPENAPI_FILE } from '../../scripts/gen-openapi.ts';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// E-REF-03 reads no dependency, so the app is built over the throwing document dependencies.
function request(): Promise<Response> {
  const app = createApp(createDocDeps(), { strictResponses: true });
  return Promise.resolve(app.request('/v1/openapi.json'));
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
    const app = createApp(createDocDeps(), { strictResponses: true });
    const response = await app.request('/v1/openapi.json', { headers: {} });
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
});
