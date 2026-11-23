import { describe, expect, it } from 'vitest';
import { createRouter, defineRoute, registerRoute } from '../router.ts';
import type { RouteContext } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { clientVersion, isBelowMinimum, parseClientValue } from './client-version.ts';
import { handleError, notFound } from './handle-error.ts';
import { createRouteMetaIndex } from './route-meta.ts';
import { requestVariables } from './variables.ts';

const NO_CONTEXT: RouteContext = { routeMiddleware: [], getOpenApiDocument: () => ({}) };

const requiredRoute = defineRoute({
  method: 'get',
  path: '/v1/required',
  operationId: 'getRequired',
  responses: { 200: { description: 'Ok.' } },
  meta: { auth: 'none', rateLimit: 'ref.openapi' },
  errors: ['client_header_required', 'upgrade_required'],
});

const exemptRoute = defineRoute({
  method: 'get',
  path: '/v1/exempt',
  operationId: 'getExempt',
  responses: { 200: { description: 'Ok.' } },
  meta: { auth: 'none', rateLimit: 'ref.openapi', clientHeader: 'exempt' },
  errors: [],
});

function buildApp(env: Record<string, string | undefined> = {}) {
  const deps = createUnitDeps({ env });
  const index = createRouteMetaIndex();
  const app = createRouter();
  app.use('*', requestVariables(deps));
  app.use('/v1/*', clientVersion(deps, index));
  registerRoute(app, requiredRoute, (c) => c.json({ client: c.get('client') }), NO_CONTEXT);
  registerRoute(app, exemptRoute, (c) => c.json({ client: c.get('client') }), NO_CONTEXT);
  index.load(app);
  app.onError(handleError(deps));
  app.notFound(notFound(deps));
  return { app, deps };
}

function withClient(value: string): RequestInit {
  return { headers: { 'X-OS-Client': value } };
}

async function codeOf(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return (body as { error: { code: string } }).error.code; // the envelope of a refusal
}

describe('client version', () => {
  it('parses the documented forms', () => {
    expect(parseClientValue('ios/1.4.0')).toEqual({ platform: 'ios', version: [1, 4, 0] });
    expect(parseClientValue('android/0.0.0')).toEqual({ platform: 'android', version: [0, 0, 0] });
    expect(parseClientValue('web/9999.9999.9999')).toEqual({
      platform: 'web',
      version: [9999, 9999, 9999],
    });
    expect(parseClientValue('web')).toEqual({ platform: 'web', version: null });
    for (const refused of [
      'ios/1.4',
      'ios/01.0.0',
      'desktop/1.0.0',
      'web/10000.0.0',
      'ios',
      'IOS/1.0.0',
      ' ios/1.0.0',
      'ios/1.0.0 ',
      '',
    ]) {
      expect(parseClientValue(refused), refused).toBeNull();
    }
    expect(parseClientValue(null)).toBeNull();
    expect(parseClientValue(undefined)).toBeNull();
  });

  it('a missing header answers 400 client_header_required on a required route', async () => {
    const { app } = buildApp();
    const missing = await app.request('/v1/required');
    expect(missing.status).toBe(400);
    expect(await codeOf(missing)).toBe('client_header_required');
    const malformed = await app.request('/v1/required', withClient('desktop/1.0.0'));
    expect(malformed.status).toBe(400);
    expect(await codeOf(malformed)).toBe('client_header_required');
  });

  it('an exempt route needs no header', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/exempt');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ client: null });
  });

  it('ios/1.3.9 under a 1.4.0 minimum answers 426 and ios/1.4.0 passes', async () => {
    const { app } = buildApp({ MIN_CLIENT_VERSION_IOS: '1.4.0' });
    const old = await app.request('/v1/required', withClient('ios/1.3.9'));
    expect(old.status).toBe(426);
    expect(await codeOf(old)).toBe('upgrade_required');
    const current = await app.request('/v1/required', withClient('ios/1.4.0'));
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({
      client: { value: { platform: 'ios', version: [1, 4, 0] }, raw: 'ios/1.4.0' },
    });
    // Each platform has its own minimum.
    expect((await app.request('/v1/required', withClient('android/1.3.9'))).status).toBe(200);
  });

  it('bare web is never too old', async () => {
    const { app, deps } = buildApp({ MIN_CLIENT_VERSION_WEB: '9.9.9' });
    expect(isBelowMinimum({ platform: 'web', version: null }, deps.env)).toBe(false);
    expect((await app.request('/v1/required', withClient('web'))).status).toBe(200);
    expect((await app.request('/v1/required', withClient('web/9.9.8'))).status).toBe(426);
  });

  it('ios/0.9.0 under the test minimum 1.0.0 answers 426', async () => {
    const { app } = buildApp();
    const response = await app.request('/v1/required', withClient('ios/0.9.0'));
    expect(response.status).toBe(426);
    expect(await codeOf(response)).toBe('upgrade_required');
    expect((await app.request('/v1/required', withClient('ios/1.0.0'))).status).toBe(200);
    expect((await app.request('/v1/required', withClient('ios/0.10.0'))).status).toBe(426);
    expect((await app.request('/v1/required', withClient('ios/10.0.0'))).status).toBe(200);
  });
});
