import { describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/app.ts';
import type { TestApp } from '../testing/app.ts';
import type { TestResponse } from '../testing/request.ts';

// Owner values of a deployed environment, all fixtures (never real).
const DEPLOYED_FIXTURE_VALUES = {
  RESEND_API_KEY: 're_fixture_0000000000',
  EMAIL_FROM: 'Fixture <alerts@mail.example.test>',
  ADMIN_EMAILS: 'admin@example.test',
};
const PRODUCTION_ROBOTS = [
  'User-agent: *',
  'Disallow: /v1/',
  'Disallow: /admin',
  'Disallow: /settings',
  'Disallow: /messages',
  'Disallow: /dev/',
  'Disallow: /r/',
  'Disallow: /unsubscribe',
  'Disallow: /m/',
  'Disallow: /tiles/',
  'Disallow: /map/',
]
  .map((line) => `${line}\n`)
  .join('');
const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';
// web_seo allows 120 a minute, held at half per replica (D-240).
const ROBOTS_PER_REPLICA = 60;
const STATIC_FILE = '/favicon.ico';

function deployedApp(appEnv: 'staging' | 'production'): Promise<TestApp> {
  return createTestApp({ env: { APP_ENV: appEnv, ...DEPLOYED_FIXTURE_VALUES } });
}

// One response of each route class: the shell, robots, health, a /v1 document and a static file.
async function routeClassResponses(testApp: TestApp): Promise<Map<string, Response>> {
  const responses = new Map<string, Response>();
  for (const path of ['/', '/robots.txt', '/healthz', '/v1/openapi.json', STATIC_FILE]) {
    const url = new URL(path, testApp.deps.env.PUBLIC_URL).toString();
    const response = await testApp.app.request(url, { headers: { 'x-real-ip': '203.0.113.30' } });
    responses.set(path, response);
  }
  return responses;
}

async function robots(testApp: TestApp, ip = '203.0.113.31'): Promise<TestResponse> {
  return testApp.request.get('/robots.txt', { client: null, ip });
}

describe('robots and indexing', () => {
  it('production serves the ten Disallow lines', async () => {
    const testApp = await deployedApp('production');
    const response = await robots(testApp);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    const text = await response.text();
    expect(text).toBe(PRODUCTION_ROBOTS);
    expect(text.split('\n').filter((line) => line.startsWith('Disallow: '))).toHaveLength(10);
    expect(text).not.toContain('Disallow: /\n');
    expect(response.headers.get('x-robots-tag')).toBeNull();
    for (const [path, each] of await routeClassResponses(testApp)) {
      expect(each.status, path).toBe(200);
      expect(each.headers.get('x-robots-tag'), path).toBeNull();
    }
  });

  it('staging and ci disallow everything', async () => {
    for (const testApp of [await deployedApp('staging'), await createTestApp()]) {
      const response = await robots(testApp);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(await response.text()).toBe(DISALLOW_ALL);
    }
  });

  it('every non-production response carries noindex', async () => {
    const testApp = await deployedApp('staging');
    for (const [path, response] of await routeClassResponses(testApp)) {
      expect(response.status, path).toBe(200);
      expect(response.headers.get('x-robots-tag'), path).toBe('noindex');
    }
  });

  it('robots is rate-limited', async () => {
    const testApp = await createTestApp();
    for (let n = 1; n <= ROBOTS_PER_REPLICA; n += 1) {
      const response = await robots(testApp, '203.0.113.32');
      expect(response.status, `request ${String(n)}`).toBe(200);
    }
    const refused = await robots(testApp, '203.0.113.32');
    expect(refused.status).toBe(429);
    expect(refused.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await refused.text()).toBe('Too many requests');
    const other = await robots(testApp, '203.0.113.33');
    expect(other.status).toBe(200);
  });
});
