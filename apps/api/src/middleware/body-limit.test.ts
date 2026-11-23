import { describe, expect, it } from 'vitest';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { RouteContext } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { DEFAULT_BODY_LIMIT_BYTES, bodyLimit } from './body-limit.ts';
import { handleError, notFound } from './handle-error.ts';
import { createRouteMetaIndex } from './route-meta.ts';
import { requestVariables } from './variables.ts';

const NO_CONTEXT: RouteContext = { routeMiddleware: [], getOpenApiDocument: () => ({}) };

function route(method: 'get' | 'post', path: string, operationId: string, bodyLimitBytes?: number) {
  return defineRoute({
    method,
    path,
    operationId,
    responses: { 200: { description: 'Ok.' } },
    meta: {
      auth: 'none',
      rateLimit: 'clientErrors',
      ...(bodyLimitBytes === undefined ? {} : { bodyLimitBytes }),
    },
    errors: ['payload_too_large'],
  });
}

function buildApp() {
  const deps = createUnitDeps();
  const index = createRouteMetaIndex();
  const app = createRouter();
  app.use('*', requestVariables(deps));
  app.use('/v1/*', bodyLimit(deps, index));
  // Each handler reads the whole body, as validation does, and answers its length.
  const echoLength = registerRouteWith(app);
  echoLength(route('post', '/v1/things', 'createThing'));
  echoLength(route('get', '/v1/things', 'listThings'));
  echoLength(route('post', '/v1/small', 'createSmall', 4096));
  index.load(app);
  app.onError(handleError(deps));
  app.notFound(notFound(deps));
  return app;
}

function registerRouteWith(app: ReturnType<typeof createRouter>) {
  return (definition: ReturnType<typeof route>) => {
    registerRoute(
      app,
      definition,
      async (c) => c.json({ bytes: (await c.req.text()).length }),
      NO_CONTEXT,
    );
  };
}

function post(app: ReturnType<typeof buildApp>, path: string, bytes: number) {
  return app.request(path, { method: 'POST', body: 'a'.repeat(bytes) });
}

describe('bodyLimit', () => {
  it('a 65,537-byte body answers 413 payload_too_large', async () => {
    const app = buildApp();
    const response = await post(app, '/v1/things', DEFAULT_BODY_LIMIT_BYTES + 1);
    expect(DEFAULT_BODY_LIMIT_BYTES).toBe(65_536);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: 'payload_too_large', message: 'The request body is too large.', fields: {} },
    });
    // A declared length over the limit is refused before the body is read.
    const declared = await app.request('/v1/things', {
      method: 'POST',
      headers: { 'Content-Length': String(DEFAULT_BODY_LIMIT_BYTES + 1) },
      body: 'a'.repeat(DEFAULT_BODY_LIMIT_BYTES + 1),
    });
    expect(declared.status).toBe(413);
  });

  it('65,536 bytes pass', async () => {
    const app = buildApp();
    const response = await post(app, '/v1/things', DEFAULT_BODY_LIMIT_BYTES);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bytes: DEFAULT_BODY_LIMIT_BYTES });
  });

  it("a route's own limit applies", async () => {
    const app = buildApp();
    expect((await post(app, '/v1/small', 4096)).status).toBe(200);
    const over = await post(app, '/v1/small', 4097);
    expect(over.status).toBe(413);
  });

  it('GET is not limited', async () => {
    const app = buildApp();
    const response = await app.request('/v1/things', {
      headers: { 'Content-Length': String(DEFAULT_BODY_LIMIT_BYTES * 4) },
    });
    expect(response.status).toBe(200);
  });
});
