import { describe, expect, it } from 'vitest';
import { createRouter } from '../router.ts';
import { testPublicUrl } from '../testing/env.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { handleError, notFound } from './handle-error.ts';
import { httpsRedirect } from './https-redirect.ts';
import { requestVariables } from './variables.ts';

// Fixture owner values a deployed environment requires; never a real key.
const DEPLOYED_FIXTURE = {
  APP_ENV: 'staging',
  RESEND_API_KEY: 're_fixture_0000000000',
  EMAIL_FROM: 'Fixture <alerts@mail.example.test>',
};

function buildApp(env: Record<string, string | undefined>) {
  const deps = createUnitDeps({ env });
  const app = createRouter();
  app.use('*', requestVariables(deps));
  app.use('*', httpsRedirect(deps));
  app.get('/some/page', (c) => c.text('page'));
  app.post('/some/form', (c) => c.text('posted'));
  app.post('/v1/things', (c) => c.json({ ok: true }));
  app.onError(handleError(deps));
  app.notFound(notFound(deps));
  return app;
}

const OVER_HTTP = { 'X-Forwarded-Proto': 'http', Host: 'evil.example.test' };
// The deployed fixture's PUBLIC_URL: the staging site origin once brand.json holds its host.
const PUBLIC_ORIGIN = testPublicUrl(DEPLOYED_FIXTURE.APP_ENV);

describe('httpsRedirect', () => {
  it('a deployed http GET is redirected with 308 to PUBLIC_URL', async () => {
    const app = buildApp(DEPLOYED_FIXTURE);
    const response = await app.request('http://evil.example.test/some/page?tab=2&x=y', {
      headers: OVER_HTTP,
    });
    expect(response.status).toBe(308);
    const location = response.headers.get('location') ?? '';
    expect(PUBLIC_ORIGIN.startsWith('https://')).toBe(true);
    expect(location.startsWith(`${PUBLIC_ORIGIN}/`)).toBe(true);
    expect(location).toBe(`${PUBLIC_ORIGIN}/some/page?tab=2&x=y`);

    const head = await app.request('http://evil.example.test/some/page', {
      method: 'HEAD',
      headers: OVER_HTTP,
    });
    expect(head.status).toBe(308);
    expect(head.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/some/page`);

    // Over https the request is served.
    const secure = await app.request('/some/page', { headers: { 'X-Forwarded-Proto': 'https' } });
    expect(secure.status).toBe(200);
  });

  it('a deployed http POST is refused with 400', async () => {
    const app = buildApp(DEPLOYED_FIXTURE);
    const form = await app.request('/some/form', { method: 'POST', headers: OVER_HTTP });
    expect(form.status).toBe(400);
    expect(form.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await form.text()).toBe('Bad request');

    const v1 = await app.request('/v1/things', { method: 'POST', headers: OVER_HTTP });
    expect(v1.status).toBe(400);
    expect(await v1.json()).toEqual({
      error: { code: 'invalid_request', message: 'The request is not valid.', fields: {} },
    });
  });

  it('local and ci never redirect', async () => {
    for (const appEnv of ['local', 'ci']) {
      const app = buildApp({ APP_ENV: appEnv });
      const page = await app.request('/some/page', { headers: OVER_HTTP });
      expect(page.status).toBe(200);
      const form = await app.request('/some/form', { method: 'POST', headers: OVER_HTTP });
      expect(form.status).toBe(200);
    }
  });
});
