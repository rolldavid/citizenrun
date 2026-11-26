import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { RATE_LIMIT_POLICIES } from '../config/rate-limits.ts';
import { createRouteMetaIndex } from '../middleware/route-meta.ts';
import { buildOpenApiDocument, createDocDeps, documentFor } from '../openapi.ts';
import type { OpenApiDocument } from '../openapi.ts';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';

// The /v1 paths that may be registered without being an operation of the document (D-438).
const REGISTRATION_EXEMPT_PATHS: readonly string[] = ['/v1/ws'];
// The operations marked `clientHeader: 'exempt'`; each is in L-client-version's list of exempt routes.
const CLIENT_HEADER_EXEMPT_OPERATIONS: readonly string[] = [
  'getOpenApiDocument',
  'appleSignInCallback',
  'receiveAppleNotification',
];
const AUTH_LEVELS: readonly string[] = ['none', 'optional', 'user', 'onboarded', 'admin'];
// INV-40: names that would put a sensitive value in a URL.
const SENSITIVE_PARAMETERS: readonly string[] = ['lat', 'lng', 'near', 'address', 'code', 'token'];
// The one route allowed a `q` parameter, and the one allowed a `token` parameter (INV-40).
const Q_ALLOWED_OPERATIONS: readonly string[] = ['suggestPlaces'];
const TOKEN_ALLOWED_OPERATIONS: readonly string[] = ['getCalendarFeed'];
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
// Hono's method name for middleware added with `use`.
const ANY_METHOD = 'ALL';
const ROUTES_DIR = import.meta.dirname;

type Operation = {
  method: string;
  path: string;
  operationId: string;
  value: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function operationsOf(document: OpenApiDocument): Operation[] {
  const operations: Operation[] = [];
  const paths = isRecord(document['paths']) ? document['paths'] : {};
  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const value = isRecord(item) ? item[method] : undefined;
      if (isRecord(value)) {
        const operationId = typeof value['operationId'] === 'string' ? value['operationId'] : '';
        operations.push({ method, path, operationId, value });
      }
    }
  }
  return operations;
}

function routeMetaOf(operation: Operation): Record<string, unknown> {
  const meta = operation.value['x-route'];
  return isRecord(meta) ? meta : {};
}

/** The query and path parameters INV-40 forbids, as `<operationId> <name>`. */
function sensitiveParameters(document: OpenApiDocument): string[] {
  const found: string[] = [];
  for (const operation of operationsOf(document)) {
    const parameters = operation.value['parameters'];
    for (const parameter of Array.isArray(parameters) ? parameters : []) {
      if (!isRecord(parameter) || (parameter['in'] !== 'query' && parameter['in'] !== 'path')) {
        continue;
      }
      const name = typeof parameter['name'] === 'string' ? parameter['name'] : '';
      const allowedToken =
        name === 'token' && TOKEN_ALLOWED_OPERATIONS.includes(operation.operationId);
      const forbidden =
        (SENSITIVE_PARAMETERS.includes(name) && !allowedToken) ||
        (name === 'q' && !Q_ALLOWED_OPERATIONS.includes(operation.operationId));
      if (forbidden) {
        found.push(`${operation.operationId} ${name}`);
      }
    }
  }
  return found;
}

// The OpenAPI form of a Hono path: `:id` becomes `{id}`.
function openApiPath(honoPath: string): string {
  return honoPath.replaceAll(/:([A-Za-z0-9_]+)/g, '{$1}');
}

// The non-middleware `/v1` routes that are not operations of the document, as `<METHOD> <path>`.
function undocumentedV1Routes(
  routes: readonly { method: string; path: string }[],
  documentOperations: readonly Operation[],
): string[] {
  const documented = new Set(
    documentOperations.map((operation) => `${operation.method.toUpperCase()} ${operation.path}`),
  );
  const undocumented = new Set<string>();
  for (const route of routes) {
    const isV1 = route.path === '/v1' || route.path.startsWith('/v1/');
    if (!isV1 || route.method === ANY_METHOD || REGISTRATION_EXEMPT_PATHS.includes(route.path)) {
      continue;
    }
    const key = `${route.method} ${openApiPath(route.path)}`;
    if (!documented.has(key)) {
      undocumented.add(key);
    }
  }
  return [...undocumented];
}

const document = buildOpenApiDocument();
const operations = operationsOf(document);

describe('the route registry', () => {
  it('registering routes reads no dependency', () => {
    expect(() => createApp(createDocDeps())).not.toThrow();
    expect(operations.length).toBeGreaterThan(0);
  });

  it('every operation has an auth level and a policy', () => {
    for (const operation of operations) {
      const meta = routeMetaOf(operation);
      expect(AUTH_LEVELS, operation.operationId).toContain(meta['auth']);
      expect(Object.keys(RATE_LIMIT_POLICIES), operation.operationId).toContain(meta['rateLimit']);
    }
  });

  it('no policy is unlimited', () => {
    const policies: Readonly<Record<string, readonly { limit: number }[]>> = RATE_LIMIT_POLICIES;
    for (const operation of operations) {
      const name = String(routeMetaOf(operation)['rateLimit']);
      const rules = policies[name] ?? [];
      const limited = rules.some((rule) => Number.isInteger(rule.limit) && rule.limit > 0);
      expect(limited, `${operation.operationId} ${name}`).toBe(true);
    }
  });

  it('every /v1 route is an operation, except the listed paths', () => {
    const app = createApp(createDocDeps());
    expect(undocumentedV1Routes(app.routes, operations)).toEqual([]);
    expect(app.routes.some((route) => route.path === '/v1/client-errors')).toBe(true);
  });

  it('the operation check finds a plain /v1 route', () => {
    const probe = createRouter();
    probe.get('/v1/__plain/:id', (c) => c.text(''));
    probe.get('/v1/ws', (c) => c.text(''));
    probe.use('/v1/*', async (_c, next) => {
      await next();
    });
    expect(undocumentedV1Routes(probe.routes, operations)).toEqual(['GET /v1/__plain/{id}']);
  });

  it('a hidden /v1 route declares its metadata and stays out of the document', async () => {
    const hidden = defineRoute({
      method: 'post',
      path: '/__hidden',
      hide: true,
      operationId: 'probeHidden',
      responses: { 200: { description: 'Ok.' } },
      // Declared as the development mailbox is: no client header and no request-forgery check.
      meta: {
        auth: 'none',
        rateLimit: 'clientErrors',
        clientHeader: 'exempt',
        originCheck: 'exempt',
        bodyLimitBytes: 64,
      },
      errors: [],
    });
    const app = createApp(createUnitDeps(), {
      extraRoutes: (root) => {
        const v1 = createRouter();
        registerRoute(v1, hidden, (c) => c.json({ ok: true }), {
          routeMiddleware: [],
          getOpenApiDocument: () => ({}),
        });
        root.route('/v1', v1);
      },
    });
    const index = createRouteMetaIndex();
    index.load(app);
    expect(index.all().find((entry) => entry.path === '/v1/__hidden')?.meta.operationId).toBe(
      'probeHidden',
    );
    const paths = documentFor(app)['paths'];
    expect(Object.keys(isRecord(paths) ? paths : {})).not.toContain('/v1/__hidden');
    // The route's own exemption and body limit apply, with no client header.
    const post = (path: string, bytes: number) =>
      app.request(path, { method: 'POST', body: 'a'.repeat(bytes) });
    expect((await post('/v1/__hidden', 64)).status).toBe(200);
    expect((await post('/v1/__hidden', 65)).status).toBe(413);
  });

  it('a /v1 request no route declares gets the default body limit', async () => {
    const app = createApp(createUnitDeps());
    const post = (bytes: number) =>
      app.request('/v1/__nothing', { method: 'POST', body: 'a'.repeat(bytes) });
    expect((await post(65_536)).status).toBe(404);
    expect((await post(65_537)).status).toBe(413);
  });

  it('the client-header exemptions are the listed ones', () => {
    const exempt = operations
      .filter((operation) => routeMetaOf(operation)['clientHeader'] === 'exempt')
      .map((operation) => operation.operationId)
      .sort();
    expect(exempt).toEqual([...CLIENT_HEADER_EXEMPT_OPERATIONS].sort());
  });

  it('no route is in the admin area', () => {
    const app = createApp(createDocDeps());
    const index = createRouteMetaIndex();
    index.load(app);
    const mounted = index.all();
    expect(mounted.length).toBeGreaterThan(0);
    for (const entry of mounted) {
      expect(entry.meta.auth, entry.path).not.toBe('admin');
    }
    const adminArea = (path: string) => path === '/v1/admin' || path.startsWith('/v1/admin/');
    expect(app.routes.filter((route) => adminArea(route.path))).toEqual([]);
    expect(operations.filter((operation) => adminArea(operation.path))).toEqual([]);
    expect(operations.filter((operation) => routeMetaOf(operation)['auth'] === 'admin')).toEqual(
      [],
    );
  });

  it('no operation declares a sensitive query or path parameter', () => {
    expect(sensitiveParameters(document)).toEqual([]);
  });

  it('the sensitive-parameter check finds each forbidden name', () => {
    const parameter = (name: string, place: string) => ({ name, in: place, schema: {} });
    const probe: OpenApiDocument = {
      paths: {
        '/v1/a/{token}': {
          get: {
            operationId: 'probeA',
            parameters: [parameter('token', 'path'), parameter('lat', 'query')],
          },
        },
        '/v1/b': {
          get: {
            operationId: 'probeB',
            parameters: [
              parameter('q', 'query'),
              parameter('code', 'query'),
              parameter('near', 'header'),
            ],
          },
        },
        '/v1/geo': {
          get: { operationId: 'suggestPlaces', parameters: [parameter('q', 'query')] },
        },
        '/v1/calendar/{token}': {
          get: { operationId: 'getCalendarFeed', parameters: [parameter('token', 'path')] },
        },
      },
    };
    expect(sensitiveParameters(probe).sort()).toEqual([
      'probeA lat',
      'probeA token',
      'probeB code',
      'probeB q',
    ]);
  });

  it('every route file has an integration test', () => {
    const missing: string[] = [];
    let routeFiles = 0;
    for (const entry of readdirSync(ROUTES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const folder = join(ROUTES_DIR, entry.name);
      for (const file of readdirSync(folder)) {
        if (!file.endsWith('.ts') || file === 'index.ts' || file.endsWith('.test.ts')) {
          continue;
        }
        routeFiles += 1;
        const sibling = file.replace(/\.ts$/, '.int.test.ts');
        if (!existsSync(join(folder, sibling))) {
          missing.push(`${entry.name}/${file}`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(routeFiles).toBeGreaterThanOrEqual(4);
  });
});
