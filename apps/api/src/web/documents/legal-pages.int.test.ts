import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { rateLimits } from '@citizenrun/db';
import {
  BRAND,
  DOCUMENT_PAGE_CSS,
  LEGAL_VERSIONS,
  brandVariant,
  createI18n,
  formatDate,
} from '@citizenrun/shared';
import { like, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app.ts';
import type { TestApp } from '../../testing/app.ts';
import { LEGAL_PAGES, loadLegalDocuments } from './load.ts';

// E-WEB-06 to E-WEB-08: the TEST-api-WEB cases of the three legal pages.
const DOCUMENTS_DIR = fileURLToPath(new URL('../../../assets/documents/', import.meta.url));
const APP_NAME = brandVariant('development').displayName;
const PENDING = 'Not published yet.';
const TITLES = {
  privacy: 'Privacy policy',
  terms: 'Terms of use',
  'content-policy': 'Content policy',
};
// web_page allows 240 a minute per address, held in memory at half per replica (D-240).
const PAGE_PER_REPLICA = 120;
const MINUTE_MS = 60_000;

function send(
  testApp: TestApp,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(path, testApp.deps.env.PUBLIC_URL).toString();
  return Promise.resolve(
    testApp.app.request(url, { method, headers: { 'x-real-ip': '203.0.113.30', ...headers } }),
  );
}

function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name = '', ...sources] = part.trim().split(/\s+/);
    if (name !== '') {
      map.set(name, sources);
    }
  }
  return map;
}

describe('the legal pages', () => {
  it('each page answers 200 logged out with its effective date', async () => {
    const testApp = await createTestApp();
    for (const page of LEGAL_PAGES) {
      const response = await send(testApp, 'GET', page.path);
      expect(response.status, page.path).toBe(200);
      expect(response.headers.get('content-type'), page.path).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control'), page.path).toBe('public, max-age=300');
      const body = await response.text();
      const date = formatDate(LEGAL_VERSIONS[page.versionKey], 'en', 'long');
      expect(body, page.path).toContain(`<p>Effective date: ${date}</p>`);
      expect(body, page.path).toContain(`<h1>${TITLES[page.id]}</h1>`);
      expect(body, page.path).toContain(`<title>${TITLES[page.id]} | ${APP_NAME}</title>`);
      expect(body, page.path).toContain(
        `<link rel="canonical" href="https://app.example.test${page.path}">`,
      );
    }
  });

  it('each page links to the others from the footer', async () => {
    const testApp = await createTestApp();
    for (const page of LEGAL_PAGES) {
      const body = await (await send(testApp, 'GET', page.path)).text();
      const footer = /<footer>([\s\S]*)<\/footer>/.exec(body)?.[1] ?? '';
      const hrefs = [...footer.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]);
      expect(hrefs, page.path).toEqual(['/privacy', '/terms', '/content-policy']);
      expect(footer, page.path).toContain(`<a href="${page.path}" aria-current="page">`);
      expect(footer.split('aria-current').length - 1, page.path).toBe(1);
    }
  });

  it('with every contact null each page still renders and the API starts', async () => {
    expect(BRAND.contacts.supportEmail).toBeNull();
    const testApp = await createTestApp();
    for (const page of LEGAL_PAGES) {
      const response = await send(testApp, 'GET', page.path);
      expect(response.status, page.path).toBe(200);
      const body = await response.text();
      expect(body, page.path).toContain(`<li>Email: ${PENDING}</li>`);
      expect(body, page.path).not.toContain('{{');
    }
  });

  it('with contacts set each page shows them', async () => {
    const documents = loadLegalDocuments({
      dir: DOCUMENTS_DIR,
      appName: APP_NAME,
      publicUrl: 'https://app.example.test',
      contacts: {
        ...BRAND.contacts,
        supportEmail: 'support@example.test',
        postalAddress: '1 Fixture Way, Testville, ZZ 00000',
      },
      t: createI18n({ lng: 'en' }).getFixedT('en'),
    });
    const testApp = await createTestApp({ documents });
    const privacy = await (await send(testApp, 'GET', '/privacy')).text();
    expect(privacy).toContain('<li>Email: support@example.test</li>');
    expect(privacy).toContain('<li>Postal address: 1 Fixture Way, Testville, ZZ 00000</li>');
    expect(privacy).not.toContain(PENDING);
    const terms = await (await send(testApp, 'GET', '/terms')).text();
    expect(terms).toContain('<li>Postal address: 1 Fixture Way, Testville, ZZ 00000</li>');
    const policy = await (await send(testApp, 'GET', '/content-policy')).text();
    expect(policy).toContain('<li>Email: support@example.test</li>');
    expect(policy).not.toContain(PENDING);
  });

  it('HEAD works', async () => {
    const testApp = await createTestApp();
    for (const page of LEGAL_PAGES) {
      const get = await send(testApp, 'GET', page.path);
      const head = await send(testApp, 'HEAD', page.path);
      expect(head.status, page.path).toBe(get.status);
      for (const name of [
        'content-type',
        'content-length',
        'cache-control',
        'content-security-policy-report-only',
        'x-robots-tag',
        'x-frame-options',
      ]) {
        expect(head.headers.get(name), `${page.path} ${name}`).toBe(get.headers.get(name));
      }
      expect(await head.text(), page.path).toBe('');
      expect((await get.text()).length, page.path).toBeGreaterThan(0);
    }
  });

  it('no session is read', async () => {
    const testApp = await createTestApp();
    testApp.resetStatementCount();
    const response = await send(testApp, 'GET', '/privacy', {
      Authorization: `Bearer ${'A'.repeat(43)}`,
      Cookie: '__Host-os_session=garbage; os_session=garbage',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    // Not one statement: the page reads no session and its limiter is in memory.
    expect(testApp.statementCount()).toBe(0);
  });

  it('the policy hashes the stylesheet', async () => {
    const testApp = await createTestApp();
    const hash = `'sha256-${createHash('sha256').update(DOCUMENT_PAGE_CSS, 'utf8').digest('base64')}'`;
    for (const page of LEGAL_PAGES) {
      const response = await send(testApp, 'GET', page.path);
      expect(response.headers.get('content-security-policy'), page.path).toBeNull();
      const policy = response.headers.get('content-security-policy-report-only') ?? '';
      const parsed = directives(policy);
      expect(parsed.get('style-src'), page.path).toContain(hash);
      expect(parsed.get('script-src'), page.path).not.toContain("'unsafe-inline'");
      expect(parsed.get('frame-ancestors'), page.path).toEqual(["'none'"]);
    }
  });

  it('a non-production response is not indexable', async () => {
    const testApp = await createTestApp();
    for (const page of LEGAL_PAGES) {
      const response = await send(testApp, 'GET', page.path);
      expect(response.headers.get('x-robots-tag'), page.path).toBe('noindex');
    }
  });

  it('the page is gzip-compressed when accepted', async () => {
    const testApp = await createTestApp();
    const plain = await (await send(testApp, 'GET', '/privacy')).text();
    const gzipped = await send(testApp, 'GET', '/privacy', { 'Accept-Encoding': 'gzip' });
    expect(gzipped.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(Buffer.from(await gzipped.arrayBuffer())).toString('utf8')).toBe(plain);
  });

  it('the pages are registered before the static files', async () => {
    const testApp = await createTestApp();
    const routes = testApp.app.routes;
    const catchAll = routes.findIndex((route) => route.method === 'GET' && route.path === '/*');
    expect(catchAll).toBeGreaterThan(-1);
    // The static files are the last all-methods `/*` handler before the catch-all.
    let staticFiles = -1;
    for (let index = 0; index < catchAll; index += 1) {
      const route = routes[index];
      if (route?.method === 'ALL' && route.path === '/*') {
        staticFiles = index;
      }
    }
    const robots = routes.findIndex((route) => route.path === '/robots.txt');
    expect(staticFiles).toBeGreaterThan(robots);
    for (const page of LEGAL_PAGES) {
      const at = routes.findIndex((route) => route.method === 'GET' && route.path === page.path);
      expect(at, page.path).toBeGreaterThan(robots);
      expect(at, page.path).toBeLessThan(staticFiles);
    }
  });

  it('the page limit holds in memory', async () => {
    const testApp = await createTestApp();
    // Early in a minute, so the 121 requests share one window.
    const now = testApp.deps.clock.now();
    testApp.deps.clock.set(new Date(Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS + 5_000));
    const ip = { 'x-real-ip': '203.0.113.31' };
    for (let n = 1; n <= PAGE_PER_REPLICA; n += 1) {
      const response = await send(testApp, 'GET', LEGAL_PAGES[n % 3]?.path ?? '/privacy', ip);
      expect(response.status, `request ${String(n)}`).toBe(200);
    }
    const refused = await send(testApp, 'GET', '/terms', ip);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(refused.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect(await refused.text()).toBe('Too many requests');
    const [row] = await testApp.deps.db
      .select({ count: sql<number>`count(*)::int` })
      .from(rateLimits)
      .where(like(rateLimits.key, '%web_page%'));
    expect(row?.count).toBe(0);
    // Another address is not limited.
    expect((await send(testApp, 'GET', '/terms', { 'x-real-ip': '203.0.113.32' })).status).toBe(
      200,
    );
  });
});
