import { describe, expect, it } from 'vitest';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { RouteContext } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { cacheHeaders } from './cache-headers.ts';
import { handleError, notFound } from './handle-error.ts';
import { createRouteMetaIndex } from './route-meta.ts';
import { requestVariables } from './variables.ts';

const NO_CONTEXT: RouteContext = { routeMiddleware: [], getOpenApiDocument: () => ({}) };

function route(path: string, operationId: string) {
  return defineRoute({
    method: 'get',
    path,
    operationId,
    responses: { 200: { description: 'Ok.' } },
    meta: { auth: 'none', rateLimit: 'ref.openapi' },
    errors: [],
  });
}

function buildApp() {
  const deps = createUnitDeps();
  const index = createRouteMetaIndex();
  const app = createRouter();
  app.use('*', requestVariables(deps));
  app.use('/v1/*', cacheHeaders(index));
  registerRoute(app, route('/v1/doc', 'getOpenApiDocument'), (c) => c.json({}), NO_CONTEXT);
  registerRoute(app, route('/v1/plain', 'getPlain'), (c) => c.json({}), NO_CONTEXT);
  registerRoute(
    app,
    route('/v1/own', 'getOwn'),
    (c) => {
      c.header('Cache-Control', 'private, max-age=60');
      return c.json({});
    },
    NO_CONTEXT,
  );
  registerRoute(
    app,
    route('/v1/gone', 'getGone'),
    (c) => {
      // A 4xx built by the handler itself, with a header that must not survive.
      c.header('Cache-Control', 'public, max-age=600');
      return c.json({ error: { code: 'not_found', message: 'Not found.', fields: {} } }, 404);
    },
    NO_CONTEXT,
  );
  index.load(app);
  app.onError(handleError(deps));
  app.notFound(notFound(deps));
  return app;
}

async function cacheControl(path: string): Promise<string | null> {
  return (await buildApp().request(path)).headers.get('cache-control');
}

describe('cacheHeaders', () => {
  it('errors are no-store', async () => {
    expect(await cacheControl('/v1/gone')).toBe('no-store');
    expect(await cacheControl('/v1/missing')).toBe('no-store');
  });

  it('the OpenAPI document is public for five minutes', async () => {
    expect(await cacheControl('/v1/doc')).toBe('public, max-age=300');
  });

  it('a route without a rule is no-store', async () => {
    expect(await cacheControl('/v1/plain')).toBe('no-store');
  });

  it("a handler's own value is kept", async () => {
    expect(await cacheControl('/v1/own')).toBe('private, max-age=60');
  });
});
