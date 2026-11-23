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

  it('a duplicate method and path throws at load', () => {
    const app = createRouter();
    registerRoute(app, readDoc, (c) => c.json({ ok: true }), NO_CONTEXT);
    registerRoute(app, { ...readDoc, operationId: 'readDocAgain' }, (c) => c.json({}), NO_CONTEXT);
    expect(() => {
      createRouteMetaIndex().load(app);
    }).toThrow('route GET /v1/doc is registered twice');
  });
});
