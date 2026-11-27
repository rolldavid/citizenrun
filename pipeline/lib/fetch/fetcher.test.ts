import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@citizenrun/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { captureLogger } from '../../testing/capture-log.ts';
import { createMemoryBucket } from '../../testing/memory-bucket.ts';
import { bucketKeys } from '../bucket.ts';
import { ForbiddenHostError } from './fetcher.ts';
import { FetchQueueSchema, HostRegistrySchema } from './hosts.ts';
import { DAILY_CAP, MIN_GAP_MS } from './rate.ts';
import {
  FakeTransport,
  TestClock,
  makeFetcher,
  removeStateDirs,
  robotsAnswer,
  tempStateDir,
} from './test-fakes.ts';
import type { Handler, Scripted } from './test-fakes.ts';
import { productToken, userAgent } from './user-agent.ts';

const HOST = 'a.example.test';
const PAGE = `https://${HOST}/page`;
const CHALLENGE_BODY = '<html><head><title>Just a moment...</title></head></html>';

afterEach(async () => {
  await removeStateDirs();
});

/** Answers robots.txt from `robots` (404 when a host has none) and every other path with `page`. */
function site(
  page: (url: URL) => Scripted | 'network_error',
  robots: Readonly<Record<string, Scripted>> = {},
): Handler {
  return (_req, url) => (url.pathname === '/robots.txt' ? robotsAnswer(url, robots) : page(url));
}

const ok = (body = '<p>fixture</p>', headers: Record<string, string> = {}): Scripted => ({
  status: 200,
  headers: { 'content-type': 'text/html', ...headers },
  body,
});

function starts(transport: FakeTransport, host: string): number[] {
  return transport.requests.filter((req) => req.host === host).map((req) => req.startedAt);
}

function expectGaps(times: readonly number[]): void {
  for (let i = 1; i < times.length; i += 1) {
    expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(MIN_GAP_MS);
  }
}

describe('obeys robots.txt', () => {
  it('a disallowed path is never requested', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok(), {
        [HOST]: { status: 200, body: 'User-agent: *\nDisallow: /private\n' },
      }),
    });
    const result = await fetcher.fetch({ url: `https://${HOST}/private/x`, class: 'dataset' });
    expect(result).toEqual({ kind: 'disallowed', reason: 'robots' });
    expect(transport.requests.map((req) => req.path)).toEqual(['/robots.txt']);
  });

  it('robots is cached for at most 24 hours', async () => {
    const { fetcher, transport, clock } = await makeFetcher({ handler: site(() => ok()) });
    const start = clock.now();
    expect((await fetcher.fetch({ url: PAGE, class: 'dataset' })).kind).toBe('ok');
    expect(transport.robots()).toHaveLength(1);
    clock.set(start + 23 * 60 * 60 * 1000);
    expect((await fetcher.fetch({ url: PAGE, class: 'dataset' })).kind).toBe('ok');
    expect(transport.robots()).toHaveLength(1);
    clock.set(start + 25 * 60 * 60 * 1000);
    expect((await fetcher.fetch({ url: PAGE, class: 'dataset' })).kind).toBe('ok');
    expect(transport.robots()).toHaveLength(2);
  });

  it('404 robots allows', async () => {
    const { fetcher, transport } = await makeFetcher({ handler: site(() => ok()) });
    const result = await fetcher.fetch({ url: PAGE, class: 'dataset' });
    expect(result.kind).toBe('ok');
    expect(transport.pages()).toHaveLength(1);
  });

  it('503 robots refuses the host', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok(), { [HOST]: { status: 503, body: 'unavailable' } }),
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'disallowed',
      reason: 'robots_unavailable',
    });
    expect(transport.pages()).toHaveLength(0);
  });

  it('a robots.txt status outside 100 to 599 makes robots.txt unavailable', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok(), { [HOST]: { status: 999, body: 'odd' } }),
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'crawl' })).toEqual({
      kind: 'disallowed',
      reason: 'robots_unavailable',
    });
    expect(transport.pages()).toHaveLength(0);
  });

  it('robots.txt behind a challenge is treated as a blocked host', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok(), { [HOST]: { status: 403, body: CHALLENGE_BODY } }),
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'challenge',
      status: 403,
    });
    expect(fetcher.stoppedHosts()).toEqual([HOST]);
    expect(transport.pages()).toHaveLength(0);
  });
});

describe('the documented public API exception', () => {
  const API = 'https://en.wikipedia.org/w/api.php?action=query&format=json';
  const STAR = { status: 200, body: 'User-agent: *\nDisallow: /w/\n' };

  it('a star-group disallow is passed for a listed endpoint and logged as excepted', async () => {
    const { log, lines } = captureLogger();
    const { fetcher, transport } = await makeFetcher({
      log,
      handler: site(() => ok('{}', { 'content-type': 'application/json' }), {
        'en.wikipedia.org': STAR,
      }),
    });
    const result = await fetcher.fetch({ url: API, class: 'api' });
    expect(result.kind).toBe('ok');
    expect(transport.requests.map((req) => req.path)).toEqual(['/robots.txt', '/w/api.php']);
    expect(transport.requests[1]?.headers['User-Agent']).toBe(userAgent('0.0.0'));
    const done = lines.find((line) => line.parsed.event === 'fetch.done');
    expect(done?.parsed).toMatchObject({
      host: 'en.wikipedia.org',
      result: 'ok',
      robots: 'excepted',
    });
  });

  it('other paths on that host still follow the star group', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok(), { 'en.wikipedia.org': STAR }),
    });
    const result = await fetcher.fetch({
      url: 'https://en.wikipedia.org/w/index.php?title=A',
      class: 'api',
    });
    expect(result).toEqual({ kind: 'disallowed', reason: 'robots' });
    expect(transport.requests.map((req) => req.path)).toEqual(['/robots.txt']);
  });

  it('a group naming our token still refuses a listed endpoint', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok(), {
        'en.wikipedia.org': {
          status: 200,
          body: `User-agent: ${productToken()}\nDisallow: /\n\nUser-agent: *\nAllow: /\n`,
        },
      }),
    });
    expect(await fetcher.fetch({ url: API, class: 'api' })).toEqual({
      kind: 'disallowed',
      reason: 'robots',
    });
    expect(transport.requests.map((req) => req.path)).toEqual(['/robots.txt']);
  });

  it('robots_unavailable still refuses a listed endpoint', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok(), { 'en.wikipedia.org': { status: 503, body: 'down' } }),
    });
    expect(await fetcher.fetch({ url: API, class: 'api' })).toEqual({
      kind: 'disallowed',
      reason: 'robots_unavailable',
    });
    expect(transport.requests.map((req) => req.path)).toEqual(['/robots.txt']);
  });

  it('listed endpoints keep the two-second pace', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok('{}', { 'content-type': 'application/json' }), {
        'en.wikipedia.org': STAR,
      }),
    });
    await fetcher.fetch({ url: API, class: 'api' });
    await fetcher.fetch({ url: `${API}&titles=B`, class: 'api' });
    expectGaps(starts(transport, 'en.wikipedia.org'));
    expect(starts(transport, 'en.wikipedia.org')).toHaveLength(3);
  });

  it('the archive endpoint follows its codeload redirect, robots checked on each host', async () => {
    const tarball = 'https://api.github.com/repos/openstates/people/tarball/main';
    const codeload = 'https://codeload.github.com/openstates/people/legacy.tar.gz/refs/heads/main';
    const { fetcher, transport, bucket } = await makeFetcher({
      handler: site(
        (url) =>
          url.hostname === 'api.github.com'
            ? { status: 302, headers: { location: codeload } }
            : { status: 200, headers: { 'content-type': 'application/x-gzip' }, body: 'tar' },
        {
          'api.github.com': { status: 200, body: 'User-agent: *\nDisallow: /\n' },
          'codeload.github.com': { status: 200, body: 'User-agent: *\nDisallow: /\n' },
        },
      ),
    });
    const result = await fetcher.download(
      { url: tarball, class: 'dataset' },
      'datasets/x/main.tar.gz',
    );
    expect(result).toMatchObject({ kind: 'ok', finalUrl: codeload, bytes: 3 });
    expect(transport.requests.map((req) => `${req.host}${req.path}`)).toEqual([
      'api.github.com/robots.txt',
      'api.github.com/repos/openstates/people/tarball/main',
      'codeload.github.com/robots.txt',
      'codeload.github.com/openstates/people/legacy.tar.gz/refs/heads/main',
    ]);
    expect(await bucket.getBytes('datasets/x/main.tar.gz')).not.toBeNull();
  });

  it('a redirect off the listed path is refused by the star group', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(
        (url) =>
          url.hostname === 'api.github.com'
            ? {
                status: 302,
                headers: {
                  location: 'https://codeload.github.com/someone/else/legacy.tar.gz/main',
                },
              }
            : ok(),
        { 'codeload.github.com': { status: 200, body: 'User-agent: *\nDisallow: /\n' } },
      ),
    });
    expect(
      await fetcher.fetch({
        url: 'https://api.github.com/repos/openstates/people/tarball/main',
        class: 'dataset',
      }),
    ).toEqual({ kind: 'disallowed', reason: 'robots' });
    expect(transport.requests.map((req) => `${req.host}${req.path}`)).toEqual([
      'api.github.com/robots.txt',
      'api.github.com/repos/openstates/people/tarball/main',
      'codeload.github.com/robots.txt',
    ]);
  });
});

describe('the Washington code exception', () => {
  const SECTION = 'https://app.leg.wa.gov/RCW/default.aspx?cite=29A.24.050';
  const STAR_ALL = { status: 200, body: 'User-agent: *\nDisallow: /\n' };
  const make = (at: string, robots: Scripted = STAR_ALL, log?: Logger) =>
    makeFetcher({
      clock: new TestClock(at),
      ...(log === undefined ? {} : { log }),
      handler: site(
        (url) =>
          url.search.includes('pdf=true')
            ? { status: 200, headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.7' }
            : ok(),
        { 'app.leg.wa.gov': robots },
      ),
      zoneForState: (state) => (state === 'WA' ? 'America/Los_Angeles' : null),
    });
  // Tuesday 2027-03-02, 19:00 in Los Angeles.
  const EVENING = '2027-03-03T03:00:00.000Z';

  it('the section page and its PDF copy pass a star-group disallow of the whole host', async () => {
    const { log, lines } = captureLogger();
    const { fetcher, transport } = await make(EVENING, STAR_ALL, log);
    expect((await fetcher.fetch({ url: SECTION, class: 'crawl', state: 'WA' })).kind).toBe('ok');
    expect(
      (await fetcher.fetch({ url: `${SECTION}&pdf=true`, class: 'crawl', state: 'WA' })).kind,
    ).toBe('ok');
    expect(transport.requests.map((req) => req.url)).toEqual([
      'https://app.leg.wa.gov/robots.txt',
      SECTION,
      `${SECTION}&pdf=true`,
    ]);
    expectGaps(starts(transport, 'app.leg.wa.gov'));
    const done = lines.filter((line) => line.parsed.event === 'fetch.done');
    expect(done.map((line) => line.parsed.robots)).toEqual(['excepted', 'excepted']);
  });

  it('a sibling path on that host still follows the star group', async () => {
    const { fetcher, transport } = await make(EVENING);
    expect(
      await fetcher.fetch({ url: 'https://app.leg.wa.gov/other/', class: 'crawl', state: 'WA' }),
    ).toEqual({ kind: 'disallowed', reason: 'robots' });
    expect(transport.requests.map((req) => req.path)).toEqual(['/robots.txt']);
  });

  it('a group naming our token still refuses it', async () => {
    const { fetcher, transport } = await make(EVENING, {
      status: 200,
      body: `User-agent: ${productToken()}\nDisallow: /\n\nUser-agent: *\nAllow: /\n`,
    });
    expect(await fetcher.fetch({ url: SECTION, class: 'crawl', state: 'WA' })).toEqual({
      kind: 'disallowed',
      reason: 'robots',
    });
    expect(transport.requests.map((req) => req.path)).toEqual(['/robots.txt']);
  });

  it('a crawl request in Washington working hours is fetched', async () => {
    // Tuesday 2027-03-02, 10:00 in Los Angeles.
    const { fetcher, transport } = await make('2027-03-02T18:00:00.000Z');
    expect((await fetcher.fetch({ url: SECTION, class: 'crawl', state: 'WA' })).kind).toBe('ok');
    expect(transport.requests.map((req) => req.url)).toEqual([
      'https://app.leg.wa.gov/robots.txt',
      SECTION,
    ]);
  });
});

describe('two seconds per host', () => {
  it('two requests to one host start at least 2,000 ms apart', async () => {
    const { fetcher, transport } = await makeFetcher({ handler: site(() => ok()) });
    await fetcher.fetch({ url: PAGE, class: 'dataset' });
    await fetcher.fetch({ url: `https://${HOST}/second`, class: 'dataset' });
    const times = starts(transport, HOST);
    expect(times).toHaveLength(3);
    expectGaps(times);
  });

  it('one request in flight per host', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok('x'.repeat(50_000))),
    });
    const [first, second] = await Promise.all([
      fetcher.fetch({ url: `https://${HOST}/one`, class: 'dataset' }),
      fetcher.fetch({ url: `https://${HOST}/two`, class: 'dataset' }),
    ]);
    expect(first.kind).toBe('ok');
    expect(second.kind).toBe('ok');
    expect(transport.maxOpenPerHost.get(HOST)).toBe(1);
    const [one, two] = transport.pages(HOST);
    expect(one?.endedAt).not.toBeNull();
    expect(two?.startedAt ?? 0).toBeGreaterThanOrEqual(one?.endedAt ?? Infinity);
  });

  it('two fetchers on one state folder never hold one host at once and start 2,000 ms apart', async () => {
    const stateDir = await tempStateDir();
    const clock = new TestClock();
    const transport = new FakeTransport(
      clock,
      site(() => ok('x'.repeat(40_000))),
    );
    const a = await makeFetcher({ handler: site(() => ok()), clock, transport, stateDir });
    const b = await makeFetcher({
      handler: site(() => ok()),
      clock,
      transport,
      stateDir,
      bucket: createMemoryBucket(),
    });
    const results = await Promise.all([
      a.fetcher.fetch({ url: PAGE, class: 'dataset' }),
      b.fetcher.fetch({ url: PAGE, class: 'dataset' }),
    ]);
    expect(results.map((result) => result.kind)).toEqual(['ok', 'ok']);
    expect(transport.maxOpenPerHost.get(HOST)).toBe(1);
    const times = starts(transport, HOST);
    expect(times).toHaveLength(4);
    expectGaps(times);
  });

  it('a count of 2,000 for the host and day refuses with daily_cap and no transport call', async () => {
    const stateDir = await tempStateDir();
    const clock = new TestClock('2026-11-26T12:00:00.000Z');
    await mkdir(join(stateDir, 'counts', '2026-11-26'), { recursive: true });
    await writeFile(join(stateDir, 'counts', '2026-11-26', HOST), String(DAILY_CAP));
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok()),
      clock,
      stateDir,
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'disallowed',
      reason: 'daily_cap',
    });
    expect(transport.requests).toHaveLength(0);
    expect(existsSync(join(stateDir, 'locks', HOST))).toBe(false);
  });
});

describe('conditional and polite', () => {
  it('conditional headers are sent and 304 is not_modified', async () => {
    const { fetcher, transport } = await makeFetcher({ handler: site(() => ({ status: 304 })) });
    const result = await fetcher.fetch({
      url: PAGE,
      class: 'dataset',
      conditional: { etag: '"fixture-etag"', lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT' },
    });
    expect(result).toEqual({ kind: 'not_modified', finalUrl: PAGE });
    const [page] = transport.pages();
    expect(page?.headers['If-None-Match']).toBe('"fixture-etag"');
    expect(page?.headers['If-Modified-Since']).toBe('Wed, 21 Oct 2026 07:28:00 GMT');
  });

  it('Retry-After is honoured and 429 backs off', async () => {
    // A 429 with Retry-After: 30, then a page.
    let calls = 0;
    const first = await makeFetcher({
      handler: site(() => {
        calls += 1;
        return calls === 1 ? { status: 429, headers: { 'retry-after': '30' } } : ok();
      }),
    });
    expect((await first.fetcher.fetch({ url: PAGE, class: 'dataset' })).kind).toBe('ok');
    expect(first.clock.sleeps.filter((ms) => ms > MIN_GAP_MS)).toEqual([30_000]);

    // 429 every time: 4 s, 8 s and 16 s, then it stops after three retries.
    const second = await makeFetcher({ handler: site(() => ({ status: 429 })) });
    expect(await second.fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'challenge',
      status: 429,
    });
    expect(second.clock.sleeps.filter((ms) => ms > MIN_GAP_MS)).toEqual([4000, 8000, 16_000]);
    expect(second.transport.pages()).toHaveLength(4);
    expect(second.fetcher.stoppedHosts()).toEqual([HOST]);
  });

  it('503 backs off and ends as an error, not a block', async () => {
    const { fetcher, transport } = await makeFetcher({ handler: site(() => ({ status: 503 })) });
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'error',
      status: 503,
      reason: 'http_status',
    });
    expect(transport.pages()).toHaveLength(4);
    expect(fetcher.stoppedHosts()).toEqual([]);
  });
});

describe('a long Retry-After on a crawl request (D-884)', () => {
  it('defers the host and refuses later crawl requests to it without a request', async () => {
    const { fetcher, transport, clock } = await makeFetcher({
      handler: site(() => ({ status: 503, headers: { 'retry-after': '7200' } })),
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'crawl' })).toEqual({
      kind: 'disallowed',
      reason: 'retry_later',
    });
    expect(transport.pages()).toHaveLength(1);
    expect(clock.sleeps.filter((ms) => ms > MIN_GAP_MS)).toEqual([]);
    expect(await fetcher.fetch({ url: `https://${HOST}/other`, class: 'crawl' })).toEqual({
      kind: 'disallowed',
      reason: 'retry_later',
    });
    expect(transport.pages()).toHaveLength(1);
    // The wait is not capped at an hour: the host is still deferred after 61 minutes.
    clock.set(clock.now() + 61 * 60 * 1000);
    expect((await fetcher.fetch({ url: PAGE, class: 'crawl' })).kind).toBe('disallowed');
    expect(transport.pages()).toHaveLength(1);
    clock.set(clock.now() + 60 * 60 * 1000);
    await fetcher.fetch({ url: PAGE, class: 'crawl' });
    expect(transport.pages()).toHaveLength(2);
  });

  it('a dataset request still waits out a long Retry-After', async () => {
    let calls = 0;
    const { fetcher, clock } = await makeFetcher({
      handler: site(() => {
        calls += 1;
        return calls === 1 ? { status: 503, headers: { 'retry-after': '120' } } : ok();
      }),
    });
    expect((await fetcher.fetch({ url: PAGE, class: 'dataset' })).kind).toBe('ok');
    expect(clock.sleeps.filter((ms) => ms > MIN_GAP_MS)).toEqual([120_000]);
  });

  it('a crawl request still retries after a short Retry-After', async () => {
    let calls = 0;
    const { fetcher, clock } = await makeFetcher({
      handler: site(() => {
        calls += 1;
        return calls === 1 ? { status: 429, headers: { 'retry-after': '60' } } : ok();
      }),
    });
    expect((await fetcher.fetch({ url: PAGE, class: 'crawl' })).kind).toBe('ok');
    expect(clock.sleeps.filter((ms) => ms > MIN_GAP_MS)).toEqual([60_000]);
  });
});

describe('user agent', () => {
  it('every request carries our user agent, robots.txt included', async () => {
    const { fetcher, transport } = await makeFetcher({ handler: site(() => ok()) });
    await fetcher.fetch({ url: PAGE, class: 'dataset', headers: { 'user-agent': 'Other/1.0' } });
    expect(transport.requests).toHaveLength(2);
    for (const req of transport.requests) {
      expect(req.headers['User-Agent']).toBe(userAgent('0.0.0'));
      expect(req.headers['user-agent']).toBeUndefined();
    }
  });

  it('a cookie is never sent, and Authorization only to the api.data.gov hosts', async () => {
    const { fetcher, transport } = await makeFetcher({ handler: site(() => ok()) });
    await expect(
      fetcher.fetch({ url: PAGE, class: 'dataset', headers: { Cookie: 'a=b' } }),
    ).rejects.toThrow('cookie');
    await expect(
      fetcher.fetch({ url: PAGE, class: 'api', headers: { Authorization: 'fixture' } }),
    ).rejects.toThrow('Authorization');
    expect(transport.requests).toHaveLength(0);
  });
});

describe('blocked hosts are marked, not evaded', () => {
  it('a Cloudflare challenge marks the host in CI', async () => {
    const { fetcher, bucket } = await makeFetcher({
      isCi: true,
      handler: site(() => ({ status: 403, body: CHALLENGE_BODY })),
    });
    expect(
      await fetcher.fetch({ url: PAGE, class: 'adapter', state: 'NC', purpose: 'cache' }),
    ).toEqual({ kind: 'challenge', status: 403 });
    const registry = await bucket.getJson(bucketKeys.hosts(), HostRegistrySchema);
    expect(registry?.[HOST]?.status).toBe('blocked_from_ci');
    expect(registry?.[HOST]?.reason).toBe('challenge');
    expect(registry?.[HOST]?.last_status).toBe(403);
    const queue = await bucket.getJson(bucketKeys.fetchQueue(HOST), FetchQueueSchema);
    expect(queue?.map((entry) => [entry.url, entry.class, entry.state, entry.purpose])).toEqual([
      [PAGE, 'adapter', 'NC', 'cache'],
    ]);
    expect(fetcher.stoppedHosts()).toEqual([]);
  });

  it('a host marked in CI is skipped and its URL queued once', async () => {
    const { fetcher, bucket, transport } = await makeFetcher({
      isCi: true,
      handler: site(() => ({ status: 403, body: CHALLENGE_BODY })),
    });
    await fetcher.fetch({ url: PAGE, class: 'dataset' });
    const before = transport.requests.length;
    expect(await fetcher.fetch({ url: `https://${HOST}/other`, class: 'dataset' })).toEqual({
      kind: 'disallowed',
      reason: 'blocked_host',
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'disallowed',
      reason: 'blocked_host',
    });
    expect(transport.requests).toHaveLength(before);
    const queue = await bucket.getJson(bucketKeys.fetchQueue(HOST), FetchQueueSchema);
    expect(queue?.map((entry) => entry.url)).toEqual([PAGE, `https://${HOST}/other`]);
  });

  it('the same challenge locally stops the host and marks nothing', async () => {
    const { fetcher, bucket, transport } = await makeFetcher({
      handler: site(() => ({ status: 503, body: CHALLENGE_BODY })),
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'challenge',
      status: 503,
    });
    const before = transport.requests.length;
    expect(await fetcher.fetch({ url: `https://${HOST}/other`, class: 'dataset' })).toEqual({
      kind: 'disallowed',
      reason: 'blocked_host',
    });
    expect(transport.requests).toHaveLength(before);
    expect(fetcher.stoppedHosts()).toEqual([HOST]);
    expect(await bucket.head(bucketKeys.hosts())).toBeNull();
    expect(await bucket.head(bucketKeys.fetchQueue(HOST))).toBeNull();
  });

  it('a 403 on the first request blocks', async () => {
    const { fetcher, bucket } = await makeFetcher({
      isCi: true,
      handler: site(() => ({ status: 403, body: 'Forbidden' })),
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'challenge',
      status: 403,
    });
    const registry = await bucket.getJson(bucketKeys.hosts(), HostRegistrySchema);
    expect(registry?.[HOST]?.reason).toBe('first_request_403');

    // A 403 after the host has answered once is an ordinary error.
    let calls = 0;
    const later = await makeFetcher({
      isCi: true,
      handler: site(() => {
        calls += 1;
        return calls === 1 ? ok() : { status: 403, body: 'Forbidden' };
      }),
    });
    expect((await later.fetcher.fetch({ url: PAGE, class: 'dataset' })).kind).toBe('ok');
    expect(await later.fetcher.fetch({ url: `https://${HOST}/x`, class: 'dataset' })).toEqual({
      kind: 'error',
      status: 403,
      reason: 'http_status',
    });
    expect(await later.bucket.head(bucketKeys.hosts())).toBeNull();
  });

  it('reportChallenge marks the host in CI and stops it locally', async () => {
    const entry = { url: PAGE, class: 'adapter' as const, state: 'WA', purpose: 'snapshot:wa-sos' };
    const ci = await makeFetcher({ isCi: true, handler: site(() => ok()) });
    await ci.fetcher.reportChallenge(HOST, 403, entry);
    const registry = await ci.bucket.getJson(bucketKeys.hosts(), HostRegistrySchema);
    expect(registry?.[HOST]?.status).toBe('blocked_from_ci');
    expect(registry?.[HOST]?.reason).toBe('challenge');
    const queue = await ci.bucket.getJson(bucketKeys.fetchQueue(HOST), FetchQueueSchema);
    expect(queue?.map((item) => item.purpose)).toEqual(['snapshot:wa-sos']);
    expect(await ci.fetcher.fetch({ url: PAGE, class: 'adapter' })).toEqual({
      kind: 'disallowed',
      reason: 'blocked_host',
    });
    expect(ci.transport.requests).toHaveLength(0);

    const local = await makeFetcher({ handler: site(() => ok()) });
    await local.fetcher.reportChallenge(HOST, 403, entry);
    expect(local.fetcher.stoppedHosts()).toEqual([HOST]);
    expect(await local.bucket.head(bucketKeys.hosts())).toBeNull();
    expect(await local.fetcher.fetch({ url: PAGE, class: 'adapter' })).toEqual({
      kind: 'disallowed',
      reason: 'blocked_host',
    });
    expect(local.transport.requests).toHaveLength(0);
  });

  it('a host blocked 30 days ago is tried once from CI and marked ok when it answers', async () => {
    const clock = new TestClock('2026-11-26T12:00:00.000Z');
    const bucket = createMemoryBucket();
    await bucket.putJson(
      bucketKeys.hosts(),
      {
        [HOST]: {
          status: 'blocked_from_ci',
          since: '2026-10-27T12:00:00.000Z',
          last_status: 403,
          last_checked_at: '2026-10-27T12:00:00.000Z',
          reason: 'challenge',
        },
      },
      HostRegistrySchema,
    );
    const { fetcher } = await makeFetcher({ isCi: true, clock, bucket, handler: site(() => ok()) });
    expect((await fetcher.fetch({ url: PAGE, class: 'dataset' })).kind).toBe('ok');
    const registry = await bucket.getJson(bucketKeys.hosts(), HostRegistrySchema);
    expect(registry?.[HOST]?.status).toBe('ok');
    expect(registry?.[HOST]?.last_status).toBe(200);
  });
});

describe('forbidden sources', () => {
  it('a forbidden host is never requested', async () => {
    const hosts = ['ballotpedia.org', 'ballotready.org', 'cicerodata.com', 'ncsl.org', 'csg.org'];
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ok()),
      hostRules: { forbiddenHosts: hosts, resultsHosts: [] },
    });
    for (const host of hosts) {
      for (const name of [host, `www.${host}`]) {
        await expect(fetcher.fetch({ url: `https://${name}/x`, class: 'crawl' })).rejects.toThrow(
          ForbiddenHostError,
        );
        await expect(
          fetcher.download({ url: `http://${name}/x.csv`, class: 'dataset' }, 'datasets/x/1/x.csv'),
        ).rejects.toThrow(ForbiddenHostError);
      }
    }
    const empty = await makeFetcher({ handler: site(() => ok()) });
    await expect(
      empty.fetcher.fetch({ url: 'https://elections.il.gov/x', class: 'adapter' }),
    ).rejects.toThrow(ForbiddenHostError);
    expect(transport.requests).toHaveLength(0);
    expect(empty.transport.requests).toHaveLength(0);
  });

  it('a redirect to a forbidden host is never followed', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(() => ({ status: 302, headers: { location: 'https://www.ncsl.org/table' } })),
      hostRules: { forbiddenHosts: ['ncsl.org'], resultsHosts: [] },
    });
    await expect(fetcher.fetch({ url: PAGE, class: 'adapter' })).rejects.toThrow(
      ForbiddenHostError,
    );
    expect(transport.requests.every((req) => req.host === HOST)).toBe(true);
  });
});

describe('the request path', () => {
  it('an http URL that fails over https is not_https', async () => {
    const { fetcher, transport } = await makeFetcher({ handler: site(() => 'network_error') });
    expect(await fetcher.fetch({ url: `http://${HOST}/page`, class: 'dataset' })).toEqual({
      kind: 'disallowed',
      reason: 'not_https',
    });
    expect(transport.pages()[0]?.url).toBe(PAGE);
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'error',
      status: null,
      reason: 'network',
    });
  });

  it('only http and https URLs are accepted', async () => {
    const { fetcher } = await makeFetcher({ handler: site(() => ok()) });
    await expect(
      fetcher.fetch({ url: 'ftp://a.example.test/x', class: 'dataset' }),
    ).rejects.toThrow('only https');
  });

  it('redirects re-check robots on the new host', async () => {
    const { fetcher, transport } = await makeFetcher({
      handler: site(
        (url) =>
          url.hostname === HOST
            ? { status: 302, headers: { location: 'https://b.example.test/y' } }
            : ok(),
        { 'b.example.test': { status: 200, body: 'User-agent: *\nDisallow: /y\n' } },
      ),
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset' })).toEqual({
      kind: 'disallowed',
      reason: 'robots',
    });
    expect(transport.requests.map((req) => `${req.host}${req.path}`)).toEqual([
      `${HOST}/robots.txt`,
      `${HOST}/page`,
      'b.example.test/robots.txt',
    ]);
  });

  it('six redirects is too_many_redirects', async () => {
    const chain = (hopsToPage: number): Handler =>
      site((url) => {
        const n = Number(url.pathname.slice(2));
        return n < hopsToPage ? { status: 301, headers: { location: `/r${String(n + 1)}` } } : ok();
      });
    const six = await makeFetcher({ handler: chain(6) });
    expect(await six.fetcher.fetch({ url: `https://${HOST}/r0`, class: 'dataset' })).toEqual({
      kind: 'error',
      status: 301,
      reason: 'too_many_redirects',
    });
    const five = await makeFetcher({ handler: chain(5) });
    const result = await five.fetcher.fetch({ url: `https://${HOST}/r0`, class: 'dataset' });
    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' ? result.finalUrl : null).toBe(`https://${HOST}/r5`);
  });

  it('a body over maxBytes is too_large', async () => {
    const { fetcher, bucket } = await makeFetcher({
      handler: site(() => ({ ...ok('x'.repeat(11)), chunkSize: 4 })),
    });
    expect(await fetcher.fetch({ url: PAGE, class: 'dataset', maxBytes: 10 })).toEqual({
      kind: 'error',
      status: 200,
      reason: 'too_large',
    });
    expect(
      await fetcher.download(
        { url: `https://${HOST}/data.csv`, class: 'dataset', maxBytes: 10 },
        'datasets/fixture/2026/data.csv',
      ),
    ).toEqual({ kind: 'error', status: 200, reason: 'too_large' });
    expect(await bucket.head('datasets/fixture/2026/data.csv')).toBeNull();
    expect((await fetcher.fetch({ url: PAGE, class: 'dataset', maxBytes: 11 })).kind).toBe('ok');
  });

  it('fetch stores the body in the raw cache; download streams it to its key only', async () => {
    const memory = createMemoryBucket();
    const { fetcher } = await makeFetcher({
      bucket: memory,
      handler: site((url) =>
        url.pathname.endsWith('.csv')
          ? {
              status: 200,
              headers: { 'content-type': 'text/csv', etag: '"e1"' },
              body: 'a,b\n1,2\n',
            }
          : ok(),
      ),
    });
    const page = await fetcher.fetch({ url: PAGE, class: 'dataset' });
    expect(page.kind === 'ok' ? page.cacheKey : null).toMatch(/^cache\/raw\/[0-9a-f]{64}\.html$/u);
    const again = await fetcher.fetch({ url: PAGE, class: 'dataset' });
    expect(again.kind === 'ok' ? again.cacheKey : null).toBe(
      page.kind === 'ok' ? page.cacheKey : '',
    );
    const key = 'datasets/fixture/2026/data.csv';
    const list = await fetcher.download({ url: `https://${HOST}/data.csv`, class: 'dataset' }, key);
    expect(list).toMatchObject({ kind: 'ok', status: 200, etag: '"e1"', bytes: 8, cacheKey: key });
    expect(new TextDecoder().decode((await memory.getBytes(key)) ?? new Uint8Array())).toBe(
      'a,b\n1,2\n',
    );
    expect(memory.keys().filter((name) => name.startsWith('cache/raw/'))).toHaveLength(1);
  });

  it('crawl class is fetched at any hour of the week', async () => {
    const make = (at: string) =>
      makeFetcher({
        clock: new TestClock(at),
        handler: site(() => ok()),
        zoneForState: (state) => (state === 'TX' ? 'America/Chicago' : null),
      });
    // Tuesday 2027-03-02 at 10:00 and 19:00, and Saturday 2027-03-06 at 10:00, in Chicago.
    for (const at of [
      '2027-03-02T16:00:00.000Z',
      '2027-03-03T01:00:00.000Z',
      '2027-03-06T16:00:00.000Z',
    ]) {
      const { fetcher, transport } = await make(at);
      expect((await fetcher.fetch({ url: PAGE, class: 'crawl', state: 'TX' })).kind).toBe('ok');
      expect(transport.requests.map((req) => req.url)).toEqual([
        `https://${HOST}/robots.txt`,
        PAGE,
      ]);
    }
  });

  it('adapter requests to a results host wait out election night', async () => {
    const make = (at: string) =>
      makeFetcher({
        clock: new TestClock(at),
        handler: site(() => ok()),
        hostRules: { forbiddenHosts: [], resultsHosts: [HOST] },
        zoneForState: (state) => (state === 'WA' ? 'America/Los_Angeles' : null),
        electionDatesForState: (state) => (state === 'WA' ? ['2026-11-03'] : []),
      });
    // 17:30 local on the election date.
    const night = await make('2026-11-04T01:30:00.000Z');
    expect(await night.fetcher.fetch({ url: PAGE, class: 'adapter', state: 'WA' })).toEqual({
      kind: 'disallowed',
      reason: 'election_night',
    });
    expect(night.transport.requests).toHaveLength(0);
    // 06:00 local the next day.
    const morning = await make('2026-11-04T14:00:00.000Z');
    expect((await morning.fetcher.fetch({ url: PAGE, class: 'adapter', state: 'WA' })).kind).toBe(
      'ok',
    );
  });

  it('fetch.done never carries the URL', async () => {
    const { log, lines } = captureLogger();
    const { fetcher } = await makeFetcher({
      log,
      handler: site(() => ok()),
    });
    await fetcher.fetch({ url: `${PAGE}/secret-path?q=secret-query`, class: 'dataset' });
    await fetcher.fetch({ url: `https://${HOST}/blocked-path`, class: 'api' });
    const done = lines.filter((line) => line.parsed.event === 'fetch.done');
    expect(done).toHaveLength(2);
    expect(done[0]?.parsed).toMatchObject({
      host: HOST,
      class: 'dataset',
      status: 200,
      result: 'ok',
      robots: 'absent',
      cached: false,
    });
    for (const line of lines) {
      expect(line.raw).not.toContain('secret-path');
      expect(line.raw).not.toContain('secret-query');
      expect(line.raw).not.toContain('blocked-path');
    }
  });
});
