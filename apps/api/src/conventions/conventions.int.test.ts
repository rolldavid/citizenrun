import { ApiError, ErrorEnvelopeSchema, newId } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { RATE_LIMIT_POLICIES } from '../config/rate-limits.ts';
import { encodeCursor } from '../lib/cursor.ts';
import { createRouteMetaIndex } from '../middleware/route-meta.ts';
import { createTestApp } from '../testing/app.ts';
import type { TestAppOverrides } from '../testing/app.ts';
import { createTestClient } from '../testing/request.ts';
import type { TestClient, TestRequestOptions, TestResponse } from '../testing/request.ts';
import { mountConventionTestRoutes } from './test-routes.ts';

// The /v1 paths that may be registered without being an operation of the document (D-438).
const REGISTRATION_EXEMPT_PATHS: readonly string[] = ['/v1/ws'];
const AUTH_LEVELS: readonly string[] = ['none', 'optional', 'user', 'onboarded', 'admin'];
// Hono's method name for middleware added with `use`.
const ANY_METHOD = 'ALL';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SERVER_TIMING = /^app;dur=(\d+)$/;
// The default body limit of a /v1 route (L-body-limit) and the bytes of `{"pad":""}`.
const BODY_LIMIT_BYTES = 65_536;
const EMPTY_ECHO_BYTES = '{"pad":""}'.length;
// clientErrors allows 20 a minute per address, held in memory at half per replica (D-240).
const CLIENT_ERRORS_PER_REPLICA = 10;
// The one address of the rate-limit case; no other case of this file uses it.
const RATE_LIMIT_IP = '203.0.113.200';
// The address the envelope case is refused from; no other case uses it.
const ENVELOPE_LIMIT_IP = '203.0.113.201';
const LOGGED_ADDRESS = '203.0.113.7';

// Every other request comes from its own address, so no case nears a per-replica limit.
let nextHost = 100;
function freshIp(): string {
  const ip = `203.0.113.${String(nextHost)}`;
  nextHost += 1;
  return ip;
}

type ConventionsApp = {
  app: ReturnType<typeof createApp>;
  request: TestClient;
  logs: Awaited<ReturnType<typeof createTestApp>>['logs'];
  env: Awaited<ReturnType<typeof createTestApp>>['deps']['env'];
};

// The app of TEST-api-conventions: createApp over the test app's dependencies, with the three
// convention routes mounted through `extraRoutes` and no other option.
async function conventionsApp(overrides: TestAppOverrides = {}): Promise<ConventionsApp> {
  const testApp = await createTestApp(overrides);
  const app = createApp(testApp.deps, { extraRoutes: mountConventionTestRoutes });
  return {
    app,
    request: createTestClient(app, testApp.deps.env),
    logs: testApp.logs,
    env: testApp.deps.env,
  };
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

// A request whose body text is sent as given (malformed or of an exact size).
function postRaw(
  conventions: ConventionsApp,
  path: string,
  text: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(path, conventions.env.PUBLIC_URL).toString();
  return Promise.resolve(
    conventions.app.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OS-Client': 'ios/1.4.0',
        'x-real-ip': freshIp(),
        ...headers,
      },
      body: text,
    }),
  );
}

function echoBody(totalBytes: number): string {
  return JSON.stringify({ pad: 'p'.repeat(totalBytes - EMPTY_ECHO_BYTES) });
}

function post(conventions: ConventionsApp, path: string, options: TestRequestOptions = {}) {
  return conventions.request.post(path, { ip: freshIp(), ...options });
}

async function expectEnvelope(response: TestResponse | Response, code: ErrorCode): Promise<void> {
  const body: unknown = JSON.parse(await response.text());
  const parsed = ErrorEnvelopeSchema.parse(body);
  expect(parsed.error.code).toBe(code);
}

function requestLine(
  conventions: ConventionsApp,
  requestId: string | null,
): Record<string, unknown> | undefined {
  return conventions.logs.find(
    (line) => line.parsed['event'] === 'request.done' && line.parsed['requestId'] === requestId,
  )?.parsed;
}

function expectNoLineHolds(conventions: ConventionsApp, text: string): void {
  for (const line of conventions.logs) {
    expect(line.raw).not.toContain(text);
  }
}

// Never called: it compiles only while ERROR_CODES refuses an unknown code.
function throwsAnUnknownCode(): never {
  // @ts-expect-error: an unknown ApiError code does not compile (TEST-api-conventions)
  throw new ApiError('no_such_code');
}

describe('TEST-api-conventions', () => {
  it('every route registered has auth and rateLimit', async () => {
    const conventions = await conventionsApp();
    const index = createRouteMetaIndex();
    index.load(conventions.app);
    const entries = index.all();
    expect(entries.map((entry) => entry.meta.operationId)).toEqual(
      expect.arrayContaining([
        'getOpenApiDocument',
        'createClientError',
        'getHealthz',
        'getReadyz',
        'conventionsEcho',
        'conventionsCursor',
        'conventionsThrow',
      ]),
    );
    for (const entry of entries) {
      expect(AUTH_LEVELS, entry.meta.operationId).toContain(entry.meta.auth);
      expect(Object.keys(RATE_LIMIT_POLICIES), entry.meta.operationId).toContain(
        entry.meta.rateLimit,
      );
    }
  });

  it('every non-2xx body parses as ErrorEnvelope and every response has a new request id', async () => {
    const conventions = await conventionsApp();
    const callerId = newId();
    const responses: { response: TestResponse | Response; code: ErrorCode | null }[] = [];
    const record = (response: TestResponse | Response, code: ErrorCode | null): void => {
      responses.push({ response, code });
    };

    record(
      await post(conventions, '/v1/__conventions/echo', { body: { pad: 1 } }),
      'invalid_request',
    );
    record(await conventions.request.get('/v1/nope', { ip: freshIp() }), 'not_found');
    record(
      await postRaw(conventions, '/v1/__conventions/echo', echoBody(BODY_LIMIT_BYTES + 1)),
      'payload_too_large',
    );
    record(
      await post(conventions, '/v1/client-errors', { body: validReport(), client: 'ios/0.9.0' }),
      'upgrade_required',
    );
    for (let n = 1; n <= CLIENT_ERRORS_PER_REPLICA; n += 1) {
      await post(conventions, '/v1/client-errors', { body: validReport(), ip: ENVELOPE_LIMIT_IP });
    }
    record(
      await post(conventions, '/v1/client-errors', { body: validReport(), ip: ENVELOPE_LIMIT_IP }),
      'rate_limited',
    );
    record(
      await post(conventions, '/v1/__conventions/throw', { body: { text: marker() } }),
      'internal',
    );
    record(
      await conventions.request.get('/v1/openapi.json', {
        ip: freshIp(),
        headers: { 'X-Request-Id': callerId },
      }),
      null,
    );
    record(await conventions.request.get('/healthz', { ip: freshIp() }), null);

    const ids = new Set<string>();
    for (const { response, code } of responses) {
      const id = response.headers.get('x-request-id') ?? '';
      expect(id, String(code)).toMatch(UUID_V7);
      expect(id).not.toBe(callerId);
      ids.add(id);
      if (code !== null) {
        await expectEnvelope(response, code);
      } else {
        expect(response.status).toBe(200);
      }
    }
    expect(ids.size).toBe(responses.length);
  });

  it('Server-Timing on every response', async () => {
    const conventions = await conventionsApp();
    const cursor = encodeCursor(z.object({ s: z.array(z.string()), i: z.uuid() }), {
      s: ['a'],
      i: newId(),
    });
    const ok = await conventions.request.get('/v1/__conventions/cursor', {
      ip: freshIp(),
      query: { cursor },
    });
    const invalid = await postRaw(conventions, '/v1/__conventions/echo', '{');
    for (let n = 1; n <= CLIENT_ERRORS_PER_REPLICA; n += 1) {
      await post(conventions, '/v1/__conventions/echo', {
        body: { pad: '' },
        ip: '203.0.113.202',
      });
    }
    const limited = await post(conventions, '/v1/__conventions/echo', {
      body: { pad: '' },
      ip: '203.0.113.202',
    });
    const failed = await post(conventions, '/v1/__conventions/throw', { body: { text: marker() } });
    const statuses: number[] = [];
    for (const response of [ok, invalid, limited, failed]) {
      statuses.push(response.status);
      const timing = response.headers.get('server-timing') ?? '';
      const match = SERVER_TIMING.exec(timing);
      expect(match, timing).not.toBeNull();
      const line = requestLine(conventions, response.headers.get('x-request-id'));
      expect(line?.['durationMs']).toBe(Number(match?.[1]));
    }
    expect(statuses).toEqual([200, 400, 429, 500]);
  });

  it('a missing X-OS-Client answers 400 on a non-exempt route', async () => {
    const conventions = await conventionsApp();
    const response = await post(conventions, '/v1/client-errors', {
      body: validReport(),
      client: null,
    });
    expect(response.status).toBe(400);
    await expectEnvelope(response, 'client_header_required');
  });

  it('ios/1.3.9 under 1.4.0 answers 426 and ios/1.4.0 passes', async () => {
    const conventions = await conventionsApp({ env: { MIN_CLIENT_VERSION_IOS: '1.4.0' } });
    const old = await post(conventions, '/v1/__conventions/echo', {
      body: { pad: '' },
      client: 'ios/1.3.9',
    });
    expect(old.status).toBe(426);
    await expectEnvelope(old, 'upgrade_required');
    const current = await post(conventions, '/v1/__conventions/echo', {
      body: { pad: '' },
      client: 'ios/1.4.0',
    });
    expect(current.status).toBe(204);
  });

  it('bare web passes', async () => {
    const conventions = await conventionsApp({ env: { MIN_CLIENT_VERSION_WEB: '1.4.0' } });
    const response = await post(conventions, '/v1/__conventions/echo', {
      body: { pad: '' },
      client: 'web',
    });
    expect(response.status).toBe(204);
  });

  it('a 65,537-byte body answers 413', async () => {
    const conventions = await conventionsApp();
    const over = await postRaw(
      conventions,
      '/v1/__conventions/echo',
      echoBody(BODY_LIMIT_BYTES + 1),
    );
    expect(over.status).toBe(413);
    await expectEnvelope(over, 'payload_too_large');
    const atLimit = await postRaw(
      conventions,
      '/v1/__conventions/echo',
      echoBody(BODY_LIMIT_BYTES),
    );
    expect(atLimit.status).toBe(204);
  });

  it('malformed JSON answers 400 invalid_request', async () => {
    const conventions = await conventionsApp();
    const response = await postRaw(conventions, '/v1/__conventions/echo', '{"pad":');
    expect(response.status).toBe(400);
    await expectEnvelope(response, 'invalid_request');
  });

  it('an unknown ApiError code fails to compile', () => {
    // The assertion is the compiler's: the expect-error line above fails typecheck if it compiles.
    expect(typeof throwsAnUnknownCode).toBe('function');
  });

  it('a thrown non-ApiError answers 500 internal with the fixed message', async () => {
    const conventions = await conventionsApp();
    const response = await post(conventions, '/v1/__conventions/throw', {
      body: { text: marker() },
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'Internal error.', fields: {} },
    });
    expect(text).not.toContain(marker());
    expect(text).not.toContain('fixture failure');
    expectNoLineHolds(conventions, marker());
    expectNoLineHolds(conventions, 'fixture failure');
  });

  it('a garbage cursor answers 400 invalid_cursor and a cursor round-trips', async () => {
    const conventions = await conventionsApp();
    const garbage = await Promise.resolve(
      conventions.app.request(
        new URL('/v1/__conventions/cursor?cursor=%%%', conventions.env.PUBLIC_URL).toString(),
        { headers: { 'X-OS-Client': 'ios/1.4.0', 'x-real-ip': freshIp() } },
      ),
    );
    expect(garbage.status).toBe(400);
    await expectEnvelope(garbage, 'invalid_cursor');

    const value = { s: ['2027-03-05', 'Fixture County'], i: newId() };
    const cursor = encodeCursor(z.object({ s: z.array(z.string()), i: z.uuid() }), value);
    const response = await conventions.request.get('/v1/__conventions/cursor', {
      ip: freshIp(),
      query: { cursor },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(value);
  });

  it('the request line holds the route pattern, never the raw path or query', async () => {
    const conventions = await conventionsApp();
    const response = await conventions.request.get(`/v1/users/${marker()}`, {
      ip: freshIp(),
      query: { q: marker() },
    });
    expect(response.status).toBe(404);
    const line = requestLine(conventions, response.headers.get('x-request-id'));
    // The catch-all `GET *` (registered as `/*`) is the endpoint every unclaimed GET matches.
    expect(line?.['route']).toBe('/*');
    expectNoLineHolds(conventions, marker());
    expectNoLineHolds(conventions, '/v1/users');
  });

  it('a route over its memory limit answers 429 with Retry-After', async () => {
    const conventions = await conventionsApp();
    for (let n = 1; n <= CLIENT_ERRORS_PER_REPLICA; n += 1) {
      const response = await conventions.request.post('/v1/client-errors', {
        body: validReport(),
        ip: RATE_LIMIT_IP,
      });
      expect(response.status, `report ${String(n)}`).toBe(204);
    }
    const refused = await conventions.request.post('/v1/client-errors', {
      body: validReport(),
      ip: RATE_LIMIT_IP,
    });
    expect(refused.status).toBe(429);
    await expectEnvelope(refused, 'rate_limited');
    const retryAfter = Number(refused.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('the request line carries a 16-hex addrHash and never the address', async () => {
    const conventions = await conventionsApp();
    const response = await conventions.request.get('/v1/openapi.json', { ip: LOGGED_ADDRESS });
    expect(response.status).toBe(200);
    const line = requestLine(conventions, response.headers.get('x-request-id'));
    expect(line?.['addrHash']).toMatch(/^[0-9a-f]{16}$/);
    expectNoLineHolds(conventions, LOGGED_ADDRESS);
  });

  it('GET /v1/ws is the only path the registration test exempts', async () => {
    expect(REGISTRATION_EXEMPT_PATHS).toEqual(['/v1/ws']);
    const conventions = await conventionsApp();
    const index = createRouteMetaIndex();
    index.load(conventions.app);
    const operations = new Set(index.all().map((entry) => `${entry.method} ${entry.path}`));
    const undocumented: string[] = [];
    let v1Routes = 0;
    for (const route of conventions.app.routes) {
      const isV1 = route.path === '/v1' || route.path.startsWith('/v1/');
      if (!isV1 || route.method === ANY_METHOD || REGISTRATION_EXEMPT_PATHS.includes(route.path)) {
        continue;
      }
      v1Routes += 1;
      if (!operations.has(`${route.method} ${route.path}`)) {
        undocumented.push(`${route.method} ${route.path}`);
      }
    }
    expect(undocumented).toEqual([]);
    expect(v1Routes).toBeGreaterThanOrEqual(5);
  });
});
