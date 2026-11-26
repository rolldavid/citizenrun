import { describe, expect, it } from 'vitest';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { RouteContext } from '../router.ts';
import { createRouteMetaIndex, routePattern } from './route-meta.ts';
import type { ResolvedRouteMeta } from './route-meta.ts';

const NO_CONTEXT: RouteContext = { routeMiddleware: [], getOpenApiDocument: () => ({}) };

const updateFixture = defineRoute({
  method: 'post',
  path: '/v1/fixture/{id}',
  operationId: 'updateFixture',
  responses: { 200: { description: 'Ok.' } },
  meta: { auth: 'none', rateLimit: 'clientErrors', bodyLimitBytes: 4096, public: true },
  errors: [],
});

const readDoc = defineRoute({
  method: 'get',
  path: '/v1/doc',
  operationId: 'readDoc',
  responses: { 200: { description: 'Ok.' } },
  meta: { auth: 'none', rateLimit: 'ref.openapi', clientHeader: 'exempt' },
  errors: [],
});

// An app whose first middleware records what the index matched and the logged route pattern.
function buildApp(options: { catchAll?: boolean } = {}) {
  const index = createRouteMetaIndex();
  const seen: { meta: ResolvedRouteMeta | null; route: string }[] = [];
  const app = createRouter();
  app.use('*', async (c, next) => {
    seen.push({ meta: index.match(c), route: routePattern(c) });
    await next();
  });
  registerRoute(app, updateFixture, (c) => c.json({ ok: true }), NO_CONTEXT);
  registerRoute(app, readDoc, (c) => c.json({ ok: true }), NO_CONTEXT);
  if (options.catchAll === true) {
    app.get('*', (c) => c.text('shell'));
  }
  index.load(app);
  return { app, index, seen };
}

describe('route metadata index', () => {
  it('matches a route with a parameter', async () => {
    const { app, index, seen } = buildApp();
    await app.request('/v1/fixture/abc', { method: 'POST' });
    expect(seen[0]?.meta).toEqual({
      auth: 'none',
      rateLimit: 'clientErrors',
      bodyLimitBytes: 4096,
      public: true,
      operationId: 'updateFixture',
    });
    expect(seen[0]?.route).toBe('/v1/fixture/:id');
    expect(
      index
        .all()
        .map(({ method, path }) => `${method} ${path}`)
        .sort(),
    ).toEqual(['GET /v1/doc', 'POST /v1/fixture/:id']);
  });

  it('HEAD resolves as GET', async () => {
    const { app, seen } = buildApp();
    const response = await app.request('/v1/doc', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(seen[0]?.meta?.operationId).toBe('readDoc');
  });

  it('an unmatched path gives null', async () => {
    const { app, seen } = buildApp();
    await app.request('/v1/nothing');
    // A method the route does not have is unmatched too.
    await app.request('/v1/fixture/abc');
    expect(seen.map((entry) => entry.meta)).toEqual([null, null]);
  });

  it('a later catch-all does not hide the endpoint', async () => {
    const { app, seen } = buildApp({ catchAll: true });
    await app.request('/v1/doc');
    await app.request('/somewhere/else');
    expect(seen[0]?.meta?.operationId).toBe('readDoc');
    expect(seen[0]?.route).toBe('/v1/doc');
    expect(seen[1]).toEqual({ meta: null, route: '/*' });
  });

  it('an earlier catch-all does not hide the route behind it', async () => {
    const index = createRouteMetaIndex();
    const seen: (ResolvedRouteMeta | null)[] = [];
    const app = createRouter();
    app.use('*', async (c, next) => {
      seen.push(index.match(c));
      await next();
    });
    // As the shell's catch-all does for /v1, this one passes the request on.
    app.get('*', async (_c, next) => {
      await next();
    });
    registerRoute(app, readDoc, (c) => c.json({ ok: true }), NO_CONTEXT);
    index.load(app);
    expect((await app.request('/v1/doc')).status).toBe(200);
    expect(seen[0]?.operationId).toBe('readDoc');
  });

  it('a hidden route on a mounted router matches under its mounted path', async () => {
    const hidden = defineRoute({
      method: 'post',
      path: '/dev/probe',
      hide: true,
      operationId: 'readProbe',
      responses: { 200: { description: 'Ok.' } },
      meta: { auth: 'none', rateLimit: 'ref.openapi', clientHeader: 'exempt' },
      errors: [],
    });
    const index = createRouteMetaIndex();
    const seen: (ResolvedRouteMeta | null)[] = [];
    const app = createRouter();
    app.use('*', async (c, next) => {
      seen.push(index.match(c));
      await next();
    });
    const v1 = createRouter();
    registerRoute(v1, hidden, (c) => c.json({ ok: true }), NO_CONTEXT);
    // A router with its own error handler is wrapped by Hono when mounted; the metadata still holds.
    const wrapped = createRouter();
    wrapped.onError((_error, c) => c.text('wrapped', 500));
    registerRoute(
      wrapped,
      { ...hidden, operationId: 'readWrapped' },
      (c) => c.text(''),
      NO_CONTEXT,
    );
    app.route('/v1', v1);
    app.route('/v1/wrapped', wrapped);
    index.load(app);
    await app.request('/v1/dev/probe', { method: 'POST' });
    await app.request('/v1/wrapped/dev/probe', { method: 'POST' });
    expect(seen.map((meta) => meta?.operationId)).toEqual(['readProbe', 'readWrapped']);
    expect(seen[0]).toEqual({
      auth: 'none',
      rateLimit: 'ref.openapi',
      clientHeader: 'exempt',
      operationId: 'readProbe',
    });
    expect(index.all().map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /v1/dev/probe',
      'POST /v1/wrapped/dev/probe',
    ]);
    expect(app.openAPIRegistry.definitions).toEqual([]);
  });

  it('a hidden route and an operation on one method and path throw at load', () => {
    const app = createRouter();
    registerRoute(app, readDoc, (c) => c.json({ ok: true }), NO_CONTEXT);
    registerRoute(app, { ...readDoc, hide: true }, (c) => c.json({}), NO_CONTEXT);
    expect(() => {
      createRouteMetaIndex().load(app);
    }).toThrow('route GET /v1/doc is registered twice');
  });

  it('a duplicate method and path throws at load', () => {
    const app = createRouter();
    registerRoute(app, readDoc, (c) => c.json({ ok: true }), NO_CONTEXT);
    registerRoute(app, { ...readDoc, operationId: 'readDocAgain' }, (c) => c.json({}), NO_CONTEXT);
    expect(() => {
      createRouteMetaIndex().load(app);
    }).toThrow('route GET /v1/doc is registered twice');
  });
});
