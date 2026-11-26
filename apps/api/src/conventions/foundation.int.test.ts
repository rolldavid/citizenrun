import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTestDb, insertWorkerHeartbeat } from '@citizenrun/db/testing';
import { ERROR_CODES, ErrorEnvelopeSchema, newId } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { V1_CSP } from '../config/csp.ts';
import { createRouteMetaIndex } from '../middleware/route-meta.ts';
import { createTestApp } from '../testing/app.ts';
import { testPublicUrl } from '../testing/env.ts';
import type { TestApp } from '../testing/app.ts';
import { createTestClient } from '../testing/request.ts';
import type { TestClient } from '../testing/request.ts';
import { mountConventionTestRoutes } from './test-routes.ts';

// TEST-api-foundation. The cases proved elsewhere: `every route declares auth and a rate-limit
// policy` and `every route has an integration test` in routes/registry.test.ts; `starts with no
// owner input`, `a deployed service needs its required inputs` and the production refusal of
// ENABLE_DEV_ROUTES in env.test.ts; `liveness and readiness` in the two health route tests;
// `serves the shell` and `dev routes are gated` in web/shell.int.test.ts.

const OPENAPI_FILE = resolve(import.meta.dirname, '../../openapi.json');
// The operations that need no client header, in registration order (L-client-version).
const CLIENT_HEADER_EXEMPT_OPERATIONS: readonly string[] = [
  'appleSignInCallback',
  'receiveAppleNotification',
  'getOpenApiDocument',
];
const HSTS = 'max-age=31536000; includeSubDomains';
const STATIC_FILE = '/favicon.ico';
const DEPLOYED_FIXTURE_VALUES = {
  RESEND_API_KEY: 're_fixture_0000000000',
  EMAIL_FROM: 'Fixture <alerts@mail.example.test>',
  ADMIN_EMAILS: 'admin@example.test',
};

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

// The /v1 operations of the app's route index, with any path parameter filled with a fixture.
function v1Operations(testApp: TestApp) {
  const index = createRouteMetaIndex();
  index.load(testApp.app);
  return index
    .all()
    .filter((entry) => entry.path.startsWith('/v1/'))
    .map((entry) => ({ ...entry, url: entry.path.replaceAll(/:[A-Za-z0-9_]+/g, 'fixture') }));
}

function call(
  client: TestClient,
  method: string,
  url: string,
  options: { client: string | null },
): ReturnType<TestClient['get']> {
  const common = { ip: freshIp(), client: options.client };
  switch (method) {
    case 'GET':
      return client.get(url, common);
    case 'POST':
      return client.post(url, { ...common, body: {} });
    case 'PUT':
      return client.put(url, { ...common, body: {} });
    case 'PATCH':
      return client.patch(url, { ...common, body: {} });
    case 'DELETE':
      return client.delete(url, common);
    default:
      throw new Error(`no test request for ${method}`);
  }
}

async function plainGet(testApp: TestApp, path: string, headers: Record<string, string> = {}) {
  const url = new URL(path, testApp.deps.env.PUBLIC_URL).toString();
  return testApp.app.request(url, { headers: { 'x-real-ip': freshIp(), ...headers } });
}

describe('TEST-api-foundation', () => {
  it('OpenAPI document matches the routes', async () => {
    const committed: unknown = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8'));
    const testApp = await createTestApp();
    const served = await testApp.request.get('/v1/openapi.json', { ip: freshIp() });
    expect(served.status).toBe(200);
    expect(await served.json()).toEqual(committed);
    // The convention test routes are mounted after the document is built and never enter it.
    const conventions = createApp(testApp.deps, { extraRoutes: mountConventionTestRoutes });
    const client = createTestClient(conventions, testApp.deps.env);
    const withTestRoutes = await client.get('/v1/openapi.json', { ip: freshIp() });
    const document = await withTestRoutes.json();
    expect(document).toEqual(committed);
    expect(JSON.stringify(document)).not.toContain('__conventions');
  });

  it('validation failures use the envelope', async () => {
    const testApp = await createTestApp();
    const report = validReport();
    report['frames'] = [{ file: 'src/app.tsx', line: -1, column: 1 }];
    const response = await testApp.request.post('/v1/client-errors', {
      ip: freshIp(),
      body: report,
    });
    expect(response.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await response.json())).toEqual({
      error: {
        code: 'invalid_request',
        message: ERROR_CODES.invalid_request.message,
        fields: { 'frames.0.line': 'out_of_range' },
      },
    });
  });

  it('unknown errors become 500 internal', async () => {
    const testApp = await createTestApp();
    const app = createApp(testApp.deps, { extraRoutes: mountConventionTestRoutes });
    const client = createTestClient(app, testApp.deps.env);
    const response = await client.post('/v1/__conventions/throw', {
      ip: freshIp(),
      body: { text: marker() },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'Internal error.', fields: {} },
    });
    const errorLines = testApp.logs.filter((line) => line.parsed['event'] === 'request.error');
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0]?.parsed['errorClass']).toBe('Error');
    for (const line of testApp.logs) {
      expect(line.raw).not.toContain('fixture failure');
      expect(line.raw).not.toContain(marker());
    }
  });

  it('every response carries X-Request-Id', async () => {
    const testApp = await createTestApp();
    await insertWorkerHeartbeat(getTestDb(), { beatAt: testApp.deps.clock.now() });
    const ids = new Set<string>();
    const paths = ['/healthz', '/readyz', '/robots.txt', '/', STATIC_FILE, '/v1/openapi.json'];
    for (const path of paths) {
      const response = await plainGet(testApp, path);
      expect(response.status, path).toBe(200);
      ids.add(response.headers.get('x-request-id') ?? '');
    }
    const error = await testApp.request.get('/v1/nope', { ip: freshIp() });
    expect(error.status).toBe(404);
    ids.add(error.headers.get('x-request-id') ?? '');
    expect(ids.size).toBe(paths.length + 1);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('old builds get 426 on every route that requires the header', async () => {
    const testApp = await createTestApp();
    const operations = v1Operations(testApp).filter(
      (operation) => operation.meta.clientHeader !== 'exempt',
    );
    expect(operations.map((operation) => operation.meta.operationId)).toContain(
      'createClientError',
    );
    for (const operation of operations) {
      const response = await call(testApp.request, operation.method, operation.url, {
        client: 'ios/0.9.0',
      });
      expect(response.status, operation.meta.operationId).toBe(426);
      expect(ErrorEnvelopeSchema.parse(await response.json()).error.code).toBe('upgrade_required');
    }
  });

  it('the client header is required', async () => {
    const testApp = await createTestApp();
    const operations = v1Operations(testApp);
    const exempt = operations
      .filter((operation) => operation.meta.clientHeader === 'exempt')
      .map((operation) => operation.meta.operationId);
    expect(exempt).toEqual([...CLIENT_HEADER_EXEMPT_OPERATIONS]);
    for (const operation of operations) {
      if (operation.meta.clientHeader === 'exempt') {
        continue;
      }
      const response = await call(testApp.request, operation.method, operation.url, {
        client: null,
      });
      expect(response.status, operation.meta.operationId).toBe(400);
      expect(ErrorEnvelopeSchema.parse(await response.json()).error.code).toBe(
        'client_header_required',
      );
    }
  });

  it('security headers on every route class', async () => {
    const testApp = await createTestApp();
    for (const path of ['/v1/openapi.json', '/', '/healthz', '/robots.txt', STATIC_FILE]) {
      const response = await plainGet(testApp, path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('strict-transport-security'), path).toBe(HSTS);
      expect(response.headers.get('x-frame-options'), path).toBe('DENY');
      expect(response.headers.get('referrer-policy'), path).toBe('strict-origin-when-cross-origin');
      expect(response.headers.get('cross-origin-resource-policy'), path).toBe('same-origin');
      const isV1 = path.startsWith('/v1/');
      const isShell = path === '/';
      expect(response.headers.get('content-security-policy'), path).toBe(isV1 ? V1_CSP : null);
      expect(response.headers.get('content-security-policy-report-only') !== null, path).toBe(
        isShell,
      );
    }
    expect(V1_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it('an http GET is redirected with 308', async () => {
    const testApp = await createTestApp({
      env: { APP_ENV: 'staging', ...DEPLOYED_FIXTURE_VALUES },
    });
    const response = await plainGet(testApp, '/', { 'X-Forwarded-Proto': 'http' });
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`${testPublicUrl('staging')}/`);
  });

  it('logs the route pattern only', async () => {
    const testApp = await createTestApp();
    const response = await plainGet(testApp, `/explore?q=${marker()}`);
    expect(response.status).toBe(200);
    const line = testApp.logs.find(
      (each) =>
        each.parsed['event'] === 'request.done' &&
        each.parsed['requestId'] === response.headers.get('x-request-id'),
    );
    // The catch-all `GET *`, which Hono registers as `/*`.
    expect(line?.parsed['route']).toBe('/*');
    for (const each of testApp.logs) {
      expect(each.raw).not.toContain(marker());
      expect(each.raw).not.toContain('/explore');
    }
  });
});
