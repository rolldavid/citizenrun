import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { brandVariant } from '@citizenrun/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { sha256Source } from '../config/csp.ts';
import { defineRoute, registerRoute } from '../router.ts';
import { createTestApp } from '../testing/app.ts';
import type { TestApp } from '../testing/app.ts';
import { webAssetsFor } from './assets.ts';
import { escapeHtml } from './escape.ts';
import {
  BODY_MARKER,
  HEAD_MARKER,
  WebShellInvalidError,
  fillShell,
  parseShellTemplate,
} from './shell.ts';

const FIXTURE_DIR = join(import.meta.dirname, '__fixtures__/dist');
const CHUNK = '/_expo/static/js/web/entry-0123456789abcdef.js';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const HOUR = 'public, max-age=3600';
const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()';
// web_page allows 240 a minute and web_static 1,200, each held at half per replica (D-240).
const SHELL_PER_REPLICA = 120;
const STATIC_PER_REPLICA = 600;
// v1.unmatched allows 120 a minute, half per replica (D-854).
const UNMATCHED_V1_PER_REPLICA = 60;

let temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  temporaryDirs = [];
});

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'web-export-'));
  temporaryDirs.push(dir);
  return dir;
}

function fixtureText(path: string): string {
  return readFileSync(join(FIXTURE_DIR, path), 'utf8');
}

function fixtureBytes(path: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, path));
}

function displayName(): string {
  return brandVariant('development').displayName;
}

// Every occurrence of `from` replaced by `to`, with no replacement patterns.
function swap(text: string, from: string, to: string): string {
  return text.split(from).join(to);
}

// The fixture's index.html as the shell must answer it: the template's own title and description
// removed, the head marker turned into the variant's title and the body marker into nothing.
function expectedShell(): string {
  let html = fixtureText('index.html');
  html = swap(html, '<title>Fixture shell</title>', '');
  html = swap(html, '<meta name="description" content="Fixture description" />', '');
  html = swap(html, HEAD_MARKER, `<title>${escapeHtml(displayName())}</title>`);
  return swap(html, BODY_MARKER, '');
}

// A request sent through the app as given, with any method and headers.
function send(
  testApp: TestApp,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(path, testApp.deps.env.PUBLIC_URL).toString();
  return Promise.resolve(
    testApp.app.request(url, { method, headers: { 'x-real-ip': '203.0.113.10', ...headers } }),
  );
}

// A request whose path keeps its `..` segment: a URL parser would remove it, so the request's URL
// is replaced after it is built.
function sendRawPath(testApp: TestApp, rawPath: string): Promise<Response> {
  const origin = new URL(testApp.deps.env.PUBLIC_URL).origin;
  const request = new Request(`${origin}/`, { headers: { 'x-real-ip': '203.0.113.11' } });
  Object.defineProperty(request, 'url', { value: `${origin}${rawPath}` });
  return Promise.resolve(testApp.app.fetch(request));
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

function varyValues(response: Response): string[] {
  return (response.headers.get('vary') ?? '').split(',').map((value) => value.trim());
}

async function expectPlainNotFound(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(await response.text()).toBe('Not found');
}

async function expectShell(response: Response): Promise<void> {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('no-cache');
  expect(varyValues(response)).toContain('Cookie');
  expect(response.headers.get('content-encoding')).toBeNull();
  const body = await response.text();
  expect(body).toBe(expectedShell());
  expect(body).toContain(`<title>${escapeHtml(displayName())}</title>`);
  expect(body).not.toContain(HEAD_MARKER);
  expect(body).not.toContain(BODY_MARKER);
  expect(body).not.toContain('Fixture shell');
  expect(body).not.toContain('Fixture description');
}

function errorCodes(testApp: TestApp): unknown[] {
  return testApp.logs
    .filter((line) => line.parsed['event'] === 'request.done')
    .map((line) => line.parsed['errorCode']);
}

describe('the web shell and static files', () => {
  it('serves the shell for / and an app route', async () => {
    const testApp = await createTestApp();
    await expectShell(await send(testApp, 'GET', '/'));
    await expectShell(await send(testApp, 'GET', '/explore?x=1'));
  });

  it('the shell policy is report-only with the template hashes', async () => {
    const testApp = await createTestApp();
    const response = await send(testApp, 'GET', '/');
    expect(response.headers.get('content-security-policy')).toBeNull();
    const policy = response.headers.get('content-security-policy-report-only');
    expect(policy).not.toBeNull();
    const parsed = directives(policy ?? '');
    expect(parsed.get('style-src')).toContain(sha256Source('body{margin:0}'));
    expect(parsed.get('script-src')).toContain(sha256Source('globalThis.fixtureShell = true;'));
    expect(parsed.get('script-src')).not.toContain(sha256Source('{}'));
    expect(parsed.get('script-src')).not.toContain("'unsafe-inline'");
    expect(parsed.get('frame-ancestors')).toEqual(["'none'"]);
    expect(parsed.get('base-uri')).toEqual(["'none'"]);
  });

  it('the shell carries the headers of the security header table', async () => {
    const testApp = await createTestApp();
    const response = await send(testApp, 'GET', '/');
    expect(response.headers.get('permissions-policy')).toBe(PERMISSIONS_POLICY);
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('referrer-policy')).not.toBe('no-referrer');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('dev routes are gated', async () => {
    const off = await createTestApp();
    await expectPlainNotFound(await send(off, 'GET', '/dev/gallery'));
    await expectPlainNotFound(await send(off, 'GET', '/dev'));
    expect(errorCodes(off)).toEqual(['not_found', 'not_found']);
    const on = await createTestApp({ env: { ENABLE_DEV_ROUTES: 'true' } });
    await expectShell(await send(on, 'GET', '/dev/gallery'));
    await expectShell(await send(off, 'GET', '/developers'));
  });

  it('/v1 GET paths never get the shell', async () => {
    const testApp = await createTestApp();
    const response = await testApp.request.get('/v1/nope');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Not found.', fields: {} },
    });
  });

  it('a hashed chunk is immutable and compressed', async () => {
    const testApp = await createTestApp();
    const file = fixtureBytes(CHUNK);

    const br = await send(testApp, 'GET', CHUNK, { 'Accept-Encoding': 'br, gzip' });
    expect(br.status).toBe(200);
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(br.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(varyValues(br)).toContain('Accept-Encoding');
    const brBody = Buffer.from(await br.arrayBuffer());
    expect(brBody.length).toBeLessThan(file.length);
    expect(brotliDecompressSync(brBody).equals(file)).toBe(true);

    const gzip = await send(testApp, 'GET', CHUNK, { 'Accept-Encoding': 'gzip' });
    expect(gzip.headers.get('content-encoding')).toBe('gzip');
    expect(gzip.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(varyValues(gzip)).toContain('Accept-Encoding');
    expect(gunzipSync(Buffer.from(await gzip.arrayBuffer())).equals(file)).toBe(true);

    const refused = await send(testApp, 'GET', CHUNK, { 'Accept-Encoding': 'br;q=0, gzip;q=0' });
    expect(refused.headers.get('content-encoding')).toBeNull();

    const plain = await send(testApp, 'GET', CHUNK);
    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(plain.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(Buffer.from(await plain.arrayBuffer()).equals(file)).toBe(true);
  });

  it('a hashed name outside the static folder is immutable', async () => {
    const testApp = await createTestApp();
    const response = await send(testApp, 'GET', '/vendor-0a1b2c3d.mjs');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(await response.text()).toBe(fixtureText('vendor-0a1b2c3d.mjs'));
  });

  it('fonts are immutable woff2', async () => {
    const testApp = await createTestApp();
    const response = await send(testApp, 'GET', '/fonts/1/SpecialGothic-Medium.woff2');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(response.headers.get('content-type')).toBe('font/woff2');
    expect(response.headers.get('content-security-policy')).toBeNull();
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(fixtureBytes('fonts/1/SpecialGothic-Medium.woff2'))).toBe(true);
  });

  it('other public files are cached for an hour', async () => {
    const testApp = await createTestApp();
    for (const path of ['/favicon.ico', '/manifest.json', '/maplibre-gl-worker-6.18.0.mjs']) {
      const response = await send(testApp, 'GET', path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('cache-control'), path).toBe(HOUR);
      expect(response.headers.get('content-security-policy'), path).toBeNull();
      expect(response.headers.get('content-security-policy-report-only'), path).toBeNull();
    }
  });

  it('index.html redirects to the root', async () => {
    const testApp = await createTestApp();
    // Any case: on a case-insensitive disk another case would name the raw template.
    for (const path of ['/index.html', '/INDEX.HTML', '/Index.Html']) {
      const response = await send(testApp, 'GET', path);
      expect(response.status, path).toBe(301);
      expect(response.headers.get('location'), path).toBe('/');
    }
  });

  it('a missing chunk falls through to the shell', async () => {
    const testApp = await createTestApp();
    await expectShell(await send(testApp, 'GET', '/_expo/static/js/web/missing.js'));
  });

  it('a parent segment is refused', async () => {
    const testApp = await createTestApp();
    await expectPlainNotFound(await sendRawPath(testApp, '/fonts/../index.html'));
    await expectPlainNotFound(await sendRawPath(testApp, '/fonts/1/..'));
    expect(errorCodes(testApp)).toEqual(['not_found', 'not_found']);
  });

  it('HEAD answers with headers and no body', async () => {
    const testApp = await createTestApp();
    for (const path of ['/', CHUNK]) {
      const get = await send(testApp, 'GET', path);
      const head = await send(testApp, 'HEAD', path);
      expect(head.status, path).toBe(get.status);
      for (const name of [
        'content-type',
        'content-length',
        'cache-control',
        'content-security-policy-report-only',
        'x-frame-options',
        'x-robots-tag',
      ]) {
        expect(head.headers.get(name), `${path} ${name}`).toBe(get.headers.get(name));
      }
      expect(head.headers.get('content-length'), path).not.toBeNull();
      expect(await head.text(), path).toBe('');
      expect((await get.text()).length, path).toBeGreaterThan(0);
    }
  });

  it('another method on an unclaimed path is a plain 404', async () => {
    const testApp = await createTestApp();
    await expectPlainNotFound(await send(testApp, 'POST', '/explore'));
    await expectPlainNotFound(await send(testApp, 'POST', CHUNK));
    expect(errorCodes(testApp)).toEqual(['not_found', 'not_found']);
  });

  it('the shell and static files are rate-limited', async () => {
    const testApp = await createTestApp();
    const shellIp = { 'x-real-ip': '203.0.113.120' };
    for (let n = 1; n <= SHELL_PER_REPLICA; n += 1) {
      const response = await send(testApp, 'GET', '/', shellIp);
      expect(response.status, `shell request ${String(n)}`).toBe(200);
    }
    const shellRefused = await send(testApp, 'GET', '/', shellIp);
    expect(shellRefused.status).toBe(429);
    expect(shellRefused.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(Number(shellRefused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(shellRefused.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect(await shellRefused.text()).toBe('Too many requests');

    const staticIp = { 'x-real-ip': '203.0.113.121', 'Accept-Encoding': 'gzip' };
    for (let n = 1; n <= STATIC_PER_REPLICA; n += 1) {
      const response = await send(testApp, 'GET', CHUNK, staticIp);
      expect(response.status, `static request ${String(n)}`).toBe(200);
    }
    const staticRefused = await send(testApp, 'GET', CHUNK, staticIp);
    expect(staticRefused.status).toBe(429);
    expect(staticRefused.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(Number(staticRefused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await staticRefused.text()).toBe('Too many requests');
    expect(errorCodes(testApp).filter((code) => code === 'rate_limited')).toHaveLength(2);
  });

  it('an unclaimed /v1 GET never meets the shell limiter or compression', async () => {
    const testApp = await createTestApp();
    const ip = { 'x-real-ip': '203.0.113.122', 'Accept-Encoding': 'gzip' };
    // Past v1.unmatched the refusal is the /v1 envelope, never the shell's plain-text 429.
    for (let n = 1; n <= SHELL_PER_REPLICA + 1; n += 1) {
      const response = await send(testApp, 'GET', '/v1/nope', ip);
      const refused = n > UNMATCHED_V1_PER_REPLICA;
      expect(response.status, `unknown /v1 request ${String(n)}`).toBe(refused ? 429 : 404);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await response.json()).toEqual({
        error: refused
          ? { code: 'rate_limited', message: expect.any(String), fields: {} }
          : { code: 'not_found', message: 'Not found.', fields: {} },
      });
    }
    const routes = testApp.logs
      .filter((line) => line.parsed['event'] === 'request.done')
      .map((line) => line.parsed['route']);
    expect(new Set(routes)).toEqual(new Set(['/*']));
    // The same address still gets the shell: the /v1 requests took nothing from web_page.
    await expectShell(await send(testApp, 'GET', '/', { 'x-real-ip': '203.0.113.122' }));

    // A /v1 route mounted after the registry is not gzipped by the catch-all row. It declares a
    // policy above the shell's, so its 121 requests from one address all pass.
    const probeRoute = defineRoute({
      method: 'get',
      path: '/v1/__probe',
      hide: true,
      operationId: 'getProbe',
      responses: { 200: { description: 'Ok.' } },
      meta: { auth: 'none', rateLimit: 'web_static', clientHeader: 'exempt' },
      errors: [],
    });
    const app = createApp(testApp.deps, {
      extraRoutes: (probe) => {
        registerRoute(probe, probeRoute, (c) => c.text('x'.repeat(4_096)), {
          routeMiddleware: [],
          getOpenApiDocument: () => ({}),
        });
      },
    });
    const url = new URL('/v1/__probe', testApp.deps.env.PUBLIC_URL).toString();
    for (let n = 1; n <= SHELL_PER_REPLICA + 1; n += 1) {
      const response = await app.request(url, {
        headers: { 'x-real-ip': '203.0.113.123', 'Accept-Encoding': 'gzip' },
      });
      expect(response.status, `probe request ${String(n)}`).toBe(200);
      expect(response.headers.get('content-encoding')).toBeNull();
      expect(await response.text()).toBe('x'.repeat(4_096));
    }
  });

  it('the shell is gzip-compressed when accepted', async () => {
    const testApp = await createTestApp();
    const plain = await send(testApp, 'GET', '/');
    expect(plain.headers.get('content-encoding')).toBeNull();
    const plainBody = await plain.text();
    expect(Buffer.byteLength(plainBody)).toBeGreaterThan(1024);
    const gzipped = await send(testApp, 'GET', '/', { 'Accept-Encoding': 'gzip' });
    expect(gzipped.headers.get('content-encoding')).toBe('gzip');
    const body = gunzipSync(Buffer.from(await gzipped.arrayBuffer())).toString('utf8');
    expect(body).toBe(plainBody);
  });

  it('no export: the API still runs', async () => {
    const testApp = await createTestApp({ env: { WEB_DIST_DIR: temporaryDir() } });
    await expectPlainNotFound(await send(testApp, 'GET', '/'));
    await expectPlainNotFound(await send(testApp, 'GET', '/explore'));
    const health = await send(testApp, 'GET', '/healthz');
    expect(health.status).toBe(200);
    const missing = testApp.logs.filter((line) => line.parsed['event'] === 'web.export_missing');
    expect(missing).toHaveLength(1);
    expect(missing[0]?.parsed['level']).toBe('warn');
  });

  it('a template without a marker is refused', async () => {
    const dir = temporaryDir();
    writeFileSync(join(dir, 'index.html'), swap(fixtureText('index.html'), BODY_MARKER, ''));
    const testApp = await createTestApp({ env: { WEB_DIST_DIR: dir } });
    const error: unknown = await webAssetsFor(testApp.deps).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebShellInvalidError);
    expect(error instanceof WebShellInvalidError ? error.marker : null).toBe(BODY_MARKER);
  });

  it('the export is read once per app', async () => {
    const testApp = await createTestApp();
    const first = await webAssetsFor(testApp.deps);
    await send(testApp, 'GET', '/');
    await send(testApp, 'GET', CHUNK, { 'Accept-Encoding': 'br' });
    expect(await webAssetsFor(testApp.deps)).toBe(first);
    expect(first?.compressed.has(CHUNK)).toBe(true);
    expect(first?.compressed.has('/manifest.json')).toBe(true);
    expect(first?.compressed.has('/vendor-0a1b2c3d.mjs')).toBe(false);
    expect(first?.compressed.has('/index.html')).toBe(false);
  });
});

describe('the shell template', () => {
  it('a marker that occurs twice is refused', () => {
    const html = fixtureText('index.html');
    expect(() => parseShellTemplate(swap(html, HEAD_MARKER, HEAD_MARKER + HEAD_MARKER))).toThrow(
      WebShellInvalidError,
    );
    expect(() => parseShellTemplate(swap(html, HEAD_MARKER, ''))).toThrow(
      expect.objectContaining({
        marker: HEAD_MARKER,
        message: expect.not.stringContaining('<html'),
      }),
    );
  });

  it('the title is escaped and nothing else changes', () => {
    const template = parseShellTemplate(
      `<head><title>Old</title>${HEAD_MARKER}</head><body>${BODY_MARKER}<p>$& kept</p></body>`,
    );
    expect(fillShell(template, { title: `</title><script>"'&$&` })).toBe(
      '<head><title>&lt;/title&gt;&lt;script&gt;&quot;&#39;&amp;$&amp;</title></head><body><p>$& kept</p></body>',
    );
  });

  it('hashes inline styles and executable scripts only', () => {
    const template = parseShellTemplate(
      [
        `<head><style>a{}</style><script>one()</script><script type="module">two()</script>`,
        `<script type="text/javascript">three()</script><script src="/x.js"></script>`,
        `<script type="application/json">{"a":1}</script>${HEAD_MARKER}</head>`,
        `<body>${BODY_MARKER}</body>`,
      ].join(''),
    );
    expect(template.styleHashes).toEqual([sha256Source('a{}')]);
    expect(template.scriptHashes).toEqual([
      sha256Source('one()'),
      sha256Source('two()'),
      sha256Source('three()'),
    ]);
  });
});
