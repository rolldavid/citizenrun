import { describe, expect, it } from 'vitest';
import { ApiError } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { RouteContext } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { clientVersion } from './client-version.ts';
import { handleError, notFound } from './handle-error.ts';
import { logRequest } from './log-request.ts';
import { addressHash } from './rate-limit.ts';
import { requestId } from './request-id.ts';
import { createRouteMetaIndex } from './route-meta.ts';
import { requestVariables } from './variables.ts';

const NO_CONTEXT: RouteContext = { routeMiddleware: [], getOpenApiDocument: () => ({}) };
const ADDRESS = '203.0.113.7';

const fixtureRoute = defineRoute({
  method: 'get',
  path: '/v1/fixture/{id}',
  operationId: 'getFixture',
  responses: { 200: { description: 'The fixture.' } },
  meta: { auth: 'none', rateLimit: 'ref.openapi' },
  errors: [],
});

function buildApp() {
  const deps = createUnitDeps();
  const index = createRouteMetaIndex();
  const app = createRouter();
  app.use('*', requestVariables(deps));
  app.use('*', requestId());
  app.use('*', logRequest(deps));
  app.use('*', addressHash(deps));
  app.use('/v1/*', clientVersion(deps, index));
  registerRoute(app, fixtureRoute, (c) => c.json({ ok: true }), NO_CONTEXT);
  app.get('/v1/bad', () => {
    throw new ApiError('invalid_request');
  });
  app.get('/v1/boom', () => {
    throw new Error('fixture failure');
  });
  index.load(app);
  app.onError(handleError(deps));
  app.notFound(notFound(deps));
  return { app, deps };
}

function requestLines(deps: ReturnType<typeof createUnitDeps>) {
  return deps.logs.filter((line) => line.parsed['event'] === 'request.done');
}

describe('logRequest', () => {
  it('one line per request with exactly the documented fields', async () => {
    const { app, deps } = buildApp();
    const response = await app.request('/v1/fixture/abc', {
      headers: { 'X-OS-Client': 'ios/1.4.0', 'x-real-ip': ADDRESS },
    });
    expect(response.status).toBe(200);
    const lines = requestLines(deps);
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]?.parsed ?? {}).sort()).toEqual(
      [
        'time',
        'level',
        'service',
        'event',
        'requestId',
        'method',
        'route',
        'status',
        'durationMs',
        'client',
        'addrHash',
      ].sort(),
    );
    expect(lines[0]?.parsed).toMatchObject({
      level: 'info',
      service: 'api',
      requestId: response.headers.get('x-request-id'),
      method: 'GET',
      route: '/v1/fixture/:id',
      status: 200,
      client: 'ios/1.4.0',
    });
  });

  it('the route pattern is logged, never the path or query', async () => {
    const { app, deps } = buildApp();
    const value = marker();
    await app.request(`/v1/fixture/${value}?q=${value}`, {
      headers: { 'X-OS-Client': 'ios/1.4.0' },
    });
    await app.request(`/v1/nothing/${value}?q=${value}`);
    const lines = requestLines(deps);
    expect(lines.map((line) => line.parsed['route'])).toEqual(['/v1/fixture/:id', '/v1/*']);
    for (const line of deps.logs) {
      expect(line.raw).not.toContain(value);
    }
  });

  it('Server-Timing equals the logged duration', async () => {
    const { app, deps } = buildApp();
    const headers = { 'X-OS-Client': 'ios/1.4.0' };
    const responses = [
      await app.request('/v1/fixture/abc', { headers }),
      await app.request('/v1/bad', { headers }),
      await app.request('/v1/boom', { headers }),
    ];
    expect(responses.map((response) => response.status)).toEqual([200, 400, 500]);
    const lines = requestLines(deps);
    expect(lines).toHaveLength(3);
    responses.forEach((response, at) => {
      const timing = response.headers.get('server-timing') ?? '';
      expect(timing).toMatch(/^app;dur=\d+$/);
      expect(Number(timing.slice('app;dur='.length))).toBe(lines[at]?.parsed['durationMs']);
    });
  });

  it('a 5xx is logged at error, a 4xx at info', async () => {
    const { app, deps } = buildApp();
    await app.request('/v1/bad');
    await app.request('/v1/boom');
    await app.request('/v1/fixture/abc');
    const lines = requestLines(deps).map((line) => line.parsed);
    expect(lines).toMatchObject([
      { level: 'info', status: 400, errorCode: 'invalid_request' },
      { level: 'error', status: 500, errorCode: 'internal' },
      { level: 'info', status: 400, errorCode: 'client_header_required' },
    ]);
    // A malformed client header is never logged.
    expect('client' in (lines[2] ?? {})).toBe(false);
  });

  it('addrHash is 16 hex characters and the address never appears', async () => {
    const { app, deps } = buildApp();
    await app.request('/v1/fixture/abc', {
      headers: { 'X-OS-Client': 'ios/1.4.0', 'x-real-ip': ADDRESS },
    });
    await app.request('/v1/fixture/abc', { headers: { 'X-OS-Client': 'ios/1.4.0' } });
    const lines = requestLines(deps);
    expect(lines[0]?.parsed['addrHash']).toMatch(/^[0-9a-f]{16}$/);
    // No header and, in process, no socket: the address is `unknown`, which is hashed like any other.
    expect(lines[1]?.parsed['addrHash']).toMatch(/^[0-9a-f]{16}$/);
    expect(lines[1]?.parsed['addrHash']).not.toBe(lines[0]?.parsed['addrHash']);
    for (const line of deps.logs) {
      expect(line.raw).not.toContain(ADDRESS);
    }
  });
});
