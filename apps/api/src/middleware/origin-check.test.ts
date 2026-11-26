import { describe, expect, it } from 'vitest';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { ApiRouteMeta, RouteContext } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { handleError } from './handle-error.ts';
import { originAllowed, originCheckMiddleware, webOrigins } from './origin-check.ts';
import { createRouteMetaIndex } from './route-meta.ts';
import type { SessionOptions } from './session-cookie.ts';
import { requestVariables } from './variables.ts';

const PUBLIC_URL = 'https://app.example.test';
const ADMIN_URL = 'https://admin.app.example.test';
const FOREIGN = 'https://evil.example.test';
const META: ApiRouteMeta = { auth: 'optional', rateLimit: 'clientErrors' };
const NO_CONTEXT: RouteContext = { routeMiddleware: [], getOpenApiDocument: () => ({}) };
const ADMIN_SESSION: SessionOptions = {
  cookieBase: 'os_admin_session',
  sameSite: 'Strict',
  cookieOrigin: ADMIN_URL,
  acceptBearer: false,
};

type Input = Parameters<typeof originAllowed>[0];

function allowed(overrides: Partial<Input>): boolean {
  return originAllowed({
    method: 'POST',
    meta: META,
    hasAuthorization: false,
    hasSessionCookie: false,
    origin: null,
    client: 'ios/1.4.0',
    origins: [PUBLIC_URL],
    ...overrides,
  });
}

// A /v1 app with only the forgery check in front of one optional POST route.
function appWith(origins?: readonly string[], session?: SessionOptions) {
  const deps = createUnitDeps({ env: { PUBLIC_URL } });
  const index = createRouteMetaIndex();
  const app = createRouter();
  app.use('*', requestVariables(deps));
  app.use('/v1/*', originCheckMiddleware(deps, index, origins, session));
  registerRoute(
    app,
    defineRoute({
      method: 'post',
      path: '/v1/fixture',
      operationId: 'postFixture',
      responses: { 204: { description: 'Ok.' } },
      meta: META,
      errors: ['origin_rejected'],
    }),
    (c) => c.body(null, 204),
    NO_CONTEXT,
  );
  index.load(app);
  app.onError(handleError(deps));
  return { app, deps };
}

function post(app: ReturnType<typeof appWith>['app'], headers: Record<string, string>) {
  return app.request('/v1/fixture', { method: 'POST', headers });
}

describe('request-forgery check', () => {
  it('reads, exempt routes and bearer requests pass', () => {
    expect(allowed({ method: 'GET', origin: FOREIGN, hasSessionCookie: true })).toBe(true);
    expect(allowed({ method: 'HEAD', origin: FOREIGN, client: null })).toBe(true);
    expect(allowed({ meta: { ...META, originCheck: 'exempt' }, origin: FOREIGN })).toBe(true);
    expect(allowed({ hasAuthorization: true, hasSessionCookie: true, origin: null })).toBe(true);
  });

  it('a cookie or browser write needs an exact origin and a web client', () => {
    const web = { client: 'web/1.4.0', origin: PUBLIC_URL };
    expect(allowed({ ...web, hasSessionCookie: true })).toBe(true);
    expect(allowed({ client: 'web', origin: PUBLIC_URL, hasSessionCookie: true })).toBe(true);
    expect(allowed({ ...web, origin: FOREIGN, hasSessionCookie: true })).toBe(false);
    expect(allowed({ ...web, origin: null, hasSessionCookie: true })).toBe(false);
    expect(allowed({ ...web, origin: `${PUBLIC_URL}/`, hasSessionCookie: true })).toBe(false);
    expect(allowed({ ...web, origin: 'https://app.example.test:443' })).toBe(false);
    expect(allowed({ client: 'ios/1.4.0', origin: PUBLIC_URL, hasSessionCookie: true })).toBe(
      false,
    );
    // A pre-session web call from another site.
    expect(allowed({ client: 'web/1.4.0', origin: FOREIGN })).toBe(false);
    // A missing or unparseable client is treated as a browser.
    expect(allowed({ client: null, origin: null })).toBe(false);
    expect(allowed({ client: 'curl/8.0', origin: null })).toBe(false);
  });

  it('a phone call before a session passes, unless it sends a foreign Origin', () => {
    expect(allowed({ client: 'ios/1.4.0' })).toBe(true);
    expect(allowed({ client: 'android/1.4.0' })).toBe(true);
    expect(allowed({ client: 'android/1.4.0', origin: FOREIGN })).toBe(false);
  });

  it('the public origins are PUBLIC_URL alone', async () => {
    const { app, deps } = appWith();
    expect(webOrigins(deps.env)).toEqual([PUBLIC_URL]);
    const cookie = `__Host-os_session=${'A'.repeat(43)}`;
    expect(
      (await post(app, { Cookie: cookie, 'X-OS-Client': 'web/1.4.0', Origin: PUBLIC_URL })).status,
    ).toBe(204);
    const admin = await post(app, {
      Cookie: cookie,
      'X-OS-Client': 'web/1.4.0',
      Origin: ADMIN_URL,
    });
    expect(admin.status).toBe(403);
    expect(await admin.json()).toMatchObject({ error: { code: 'origin_rejected' } });
  });

  it('a second service checks its own origins and cookie', async () => {
    const { app } = appWith([ADMIN_URL], ADMIN_SESSION);
    const cookie = `__Host-os_admin_session=${'A'.repeat(43)}`;
    expect(
      (await post(app, { Cookie: cookie, 'X-OS-Client': 'web/1.4.0', Origin: ADMIN_URL })).status,
    ).toBe(204);
    const publicOrigin = await post(app, {
      Cookie: cookie,
      'X-OS-Client': 'web/1.4.0',
      Origin: PUBLIC_URL,
    });
    expect(publicOrigin.status).toBe(403);
    expect(await publicOrigin.json()).toMatchObject({ error: { code: 'origin_rejected' } });
    // Its own cookie, with a phone client and no Origin, is a browser write and is refused.
    expect((await post(app, { Cookie: cookie, 'X-OS-Client': 'ios/1.4.0' })).status).toBe(403);
  });
});
