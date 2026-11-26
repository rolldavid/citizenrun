import { describe, expect, it } from 'vitest';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { RouteContext } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { handleError } from './handle-error.ts';
import { createRouteMetaIndex } from './route-meta.ts';
import {
  clearSessionCookie,
  isHttpsOrigin,
  readSessionCookie,
  writeSessionCookie,
} from './session-cookie.ts';
import type { SessionOptions } from './session-cookie.ts';
import { PUBLIC_SESSION_OPTIONS, publicSessionOptions, sessionMiddleware } from './session.ts';
import { requestVariables } from './variables.ts';

const NOW = new Date('2027-03-05T12:00:00.000Z');
const NINETY_DAYS_S = 7_776_000;
const TOKEN = 'A'.repeat(43);
const NO_CONTEXT: RouteContext = { routeMiddleware: [], getOpenApiDocument: () => ({}) };
const PUBLIC_OPTIONS_HTTPS = publicSessionOptions('https://app.example.test');

// The options the admin server passes (D-801).
const ADMIN_OPTIONS: SessionOptions = {
  cookieBase: 'os_admin_session',
  sameSite: 'Strict',
  cookieOrigin: 'https://admin.example.test',
  acceptBearer: false,
};

// The Set-Cookie header one write or clear with `options` produces, and what a read returns.
async function cookieRoundTrip(options: SessionOptions, cookieHeader?: string) {
  const app = createRouter();
  app.get('/write', (c) => {
    writeSessionCookie(c, options, TOKEN, new Date(NOW.getTime() + NINETY_DAYS_S * 1000), NOW);
    return c.body(null, 204);
  });
  app.get('/clear', (c) => {
    clearSessionCookie(c, options);
    return c.body(null, 204);
  });
  app.get('/read', (c) => c.json({ value: readSessionCookie(c, options) ?? null }));
  const written = (await app.request('/write')).headers.get('set-cookie');
  const cleared = (await app.request('/clear')).headers.get('set-cookie');
  const read: unknown = await (
    await app.request(
      '/read',
      cookieHeader === undefined ? {} : { headers: { Cookie: cookieHeader } },
    )
  ).json();
  return { written, cleared, read: (read as { value: string | null }).value }; // the probe's own body
}

describe('session cookie', () => {
  it('an https origin gets the __Host- cookie with SameSite=Lax', async () => {
    const options = publicSessionOptions('https://app.example.test');
    const { written, cleared, read } = await cookieRoundTrip(
      options,
      `os_session=wrong; __Host-os_session=${TOKEN}`,
    );
    expect(written).toBe(
      `__Host-os_session=${TOKEN}; Max-Age=${String(NINETY_DAYS_S)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(cleared).toBe('__Host-os_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
    expect(read).toBe(TOKEN);
  });

  it('a local origin gets os_session without Secure', async () => {
    const options = publicSessionOptions('http://localhost:8081');
    const { written, read } = await cookieRoundTrip(options, `os_session=${TOKEN}`);
    expect(written).toBe(
      `os_session=${TOKEN}; Max-Age=${String(NINETY_DAYS_S)}; Path=/; HttpOnly; SameSite=Lax`,
    );
    expect(read).toBe(TOKEN);
    // The plain name is not read on https, and the prefixed one is not read locally.
    expect(
      (
        await cookieRoundTrip(
          publicSessionOptions('https://app.example.test'),
          `os_session=${TOKEN}`,
        )
      ).read,
    ).toBeNull();
    expect((await cookieRoundTrip(options, `__Host-os_session=${TOKEN}`)).read).toBeNull();
  });

  it('a past expiry writes Max-Age 0', async () => {
    const app = createRouter();
    app.get('/write', (c) => {
      writeSessionCookie(c, PUBLIC_OPTIONS_HTTPS, TOKEN, new Date(NOW.getTime() - 1000), NOW);
      return c.body(null, 204);
    });
    expect((await app.request('/write')).headers.get('set-cookie')).toContain('Max-Age=0;');
  });

  it('the public options are the public cookie', () => {
    expect(PUBLIC_SESSION_OPTIONS).toEqual({
      cookieBase: 'os_session',
      sameSite: 'Lax',
      acceptBearer: true,
    });
    expect(publicSessionOptions('https://app.example.test')).toEqual({
      cookieBase: 'os_session',
      sameSite: 'Lax',
      cookieOrigin: 'https://app.example.test',
      acceptBearer: true,
    });
    expect(isHttpsOrigin('https://app.example.test')).toBe(true);
    expect(isHttpsOrigin('http://localhost:8081')).toBe(false);
  });

  it('a second service writes its own cookie with SameSite=Strict', async () => {
    const { written, cleared, read } = await cookieRoundTrip(
      ADMIN_OPTIONS,
      `__Host-os_session=wrong; __Host-os_admin_session=${TOKEN}`,
    );
    expect(written).toBe(
      `__Host-os_admin_session=${TOKEN}; Max-Age=${String(NINETY_DAYS_S)}; Path=/; HttpOnly; Secure; SameSite=Strict`,
    );
    expect(cleared).toBe(
      '__Host-os_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict',
    );
    expect(read).toBe(TOKEN);
  });

  it('a service that refuses bearer tokens answers 401 before any lookup', async () => {
    // Unit deps have no database: a lookup would fail the request with 500.
    const deps = createUnitDeps();
    const index = createRouteMetaIndex();
    const app = createRouter();
    app.use('*', requestVariables(deps));
    app.use('/v1/*', sessionMiddleware(deps, index, ADMIN_OPTIONS));
    registerRoute(
      app,
      defineRoute({
        method: 'get',
        path: '/v1/fixture',
        operationId: 'getFixture',
        responses: { 200: { description: 'Ok.' } },
        meta: { auth: 'optional', rateLimit: 'clientErrors' },
        errors: ['unauthenticated'],
      }),
      (c) => c.json({ viewer: c.get('viewer') }),
      NO_CONTEXT,
    );
    index.load(app);
    app.onError(handleError(deps));
    const bearer = await app.request('/v1/fixture', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(bearer.status).toBe(401);
    expect(await bearer.json()).toMatchObject({ error: { code: 'unauthenticated' } });
    // No credential at all reads nothing and passes as no viewer.
    const none = await app.request('/v1/fixture');
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ viewer: null });
  });
});
