import { describe, expect, it } from 'vitest';
import { V1_CSP } from '../config/csp.ts';
import { createRouter } from '../router.ts';
import { createUnitDeps } from '../testing/unit-deps.ts';
import { handleError, notFound } from './handle-error.ts';
import { secureHeaders } from './secure-headers.ts';
import { requestVariables } from './variables.ts';

// Fixture owner values a deployed environment requires; never a real key.
const PRODUCTION_FIXTURE = {
  APP_ENV: 'production',
  RESEND_API_KEY: 're_fixture_0000000000',
  EMAIL_FROM: 'Fixture <alerts@mail.example.test>',
};

const FIXED_HEADERS: Readonly<Record<string, string>> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'origin-agent-cluster': '?1',
  'x-dns-prefetch-control': 'off',
  'x-download-options': 'noopen',
  'x-permitted-cross-domain-policies': 'none',
  'x-xss-protection': '0',
};

const PERMISSIONS =
  'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()';

function buildApp(env: Record<string, string | undefined> = {}) {
  const deps = createUnitDeps({ env });
  const app = createRouter();
  app.use('*', requestVariables(deps));
  app.use('*', secureHeaders(deps));
  app.get('/v1/thing', (c) => c.json({ ok: true }));
  app.get('/v1/own-policy', (c) => {
    c.header('Content-Security-Policy', "default-src 'self'");
    return c.json({ ok: true });
  });
  app.get('/v1/ws', (c) => c.text('upgrade'));
  app.get('/plain', (c) => c.text('plain'));
  app.get('/page', (c) => c.html('<p>page</p>'));
  app.get('/og/card.png', (c) => c.text('image'));
  app.get('/m/key', (c) => c.text('media'));
  app.get('/.well-known/assetlinks.json', (c) => c.json([]));
  app.get('/ogre', (c) => c.text('not a preview'));
  app.onError(handleError(deps));
  app.notFound(notFound(deps));
  return app;
}

describe('secureHeaders', () => {
  it('security headers on every route class', async () => {
    const app = buildApp();
    for (const path of ['/v1/thing', '/plain', '/page', '/v1/missing', '/missing']) {
      const response = await app.request(path);
      for (const [name, value] of Object.entries(FIXED_HEADERS)) {
        expect(response.headers.get(name), `${name} on ${path}`).toBe(value);
      }
      expect(response.headers.get('cross-origin-embedder-policy')).toBeNull();
      expect(response.headers.get('x-powered-by')).toBeNull();
    }
  });

  it('Referrer-Policy is never no-referrer', async () => {
    const app = buildApp();
    for (const path of ['/v1/thing', '/plain', '/page', '/og/card.png']) {
      const value = (await app.request(path)).headers.get('referrer-policy');
      expect(value).not.toBe('no-referrer');
      expect(value).toBe('strict-origin-when-cross-origin');
    }
  });

  it('/v1 responses carry the restrictive policy', async () => {
    const app = buildApp();
    for (const path of ['/v1/thing', '/v1/missing']) {
      const response = await app.request(path);
      expect(response.headers.get('content-security-policy')).toBe(V1_CSP);
      expect(response.headers.get('content-security-policy-report-only')).toBeNull();
    }
  });

  it('non-HTML responses outside /v1 carry no policy', async () => {
    const app = buildApp();
    for (const path of ['/plain', '/og/card.png', '/.well-known/assetlinks.json', '/missing']) {
      const response = await app.request(path);
      expect(response.headers.get('content-security-policy')).toBeNull();
      expect(response.headers.get('content-security-policy-report-only')).toBeNull();
    }
  });

  it('CORP is cross-origin only on /og/, /m/ and /.well-known/', async () => {
    const app = buildApp();
    const corp = async (path: string) =>
      (await app.request(path)).headers.get('cross-origin-resource-policy');
    expect(await corp('/og/card.png')).toBe('cross-origin');
    expect(await corp('/m/key')).toBe('cross-origin');
    expect(await corp('/.well-known/assetlinks.json')).toBe('cross-origin');
    expect(await corp('/ogre')).toBe('same-origin');
    expect(await corp('/v1/thing')).toBe('same-origin');
    expect(await corp('/page')).toBe('same-origin');
  });

  it('Permissions-Policy only on HTML', async () => {
    const app = buildApp();
    expect((await app.request('/page')).headers.get('permissions-policy')).toBe(PERMISSIONS);
    expect((await app.request('/plain')).headers.get('permissions-policy')).toBeNull();
    expect((await app.request('/v1/thing')).headers.get('permissions-policy')).toBeNull();
  });

  it('noindex everywhere outside production', async () => {
    const ci = buildApp();
    for (const path of ['/v1/thing', '/plain', '/page', '/missing']) {
      expect((await ci.request(path)).headers.get('x-robots-tag')).toBe('noindex');
    }
    const production = buildApp(PRODUCTION_FIXTURE);
    for (const path of ['/v1/thing', '/plain', '/page', '/missing']) {
      expect((await production.request(path)).headers.get('x-robots-tag')).toBeNull();
    }
  });

  it('no HSTS on an http PUBLIC_URL', async () => {
    const app = buildApp({ PUBLIC_URL: 'http://localhost:8080' });
    const response = await app.request('/v1/thing');
    expect(response.headers.get('strict-transport-security')).toBeNull();
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it("a handler's own policy header is kept", async () => {
    const app = buildApp();
    const response = await app.request('/v1/own-policy');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'self'");
  });

  it('the socket upgrade path gets none of them', async () => {
    const app = buildApp();
    const response = await app.request('/v1/ws');
    for (const name of [...Object.keys(FIXED_HEADERS), 'content-security-policy', 'x-robots-tag']) {
      expect(response.headers.get(name)).toBeNull();
    }
  });
});
