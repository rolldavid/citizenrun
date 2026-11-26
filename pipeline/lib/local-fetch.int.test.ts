import { beforeEach, describe, expect, it } from 'vitest';
import { SnapshotSidecarSchema } from '../crawlers/archiver.ts';
import type { PipelineEnv } from '../env.ts';
import { captureLogger } from '../testing/capture-log.ts';
import { getTestBucket, resetStorage } from '../testing/setup.ts';
import { bucketKeys } from './bucket.ts';
import type { DataBucket } from './bucket.ts';
import { HostRegistry, queueForLocalFetch, readQueue } from './fetch/hosts.ts';
import { TestClock, makeFetcher, robotsAnswer } from './fetch/test-fakes.ts';
import type { Scripted } from './fetch/test-fakes.ts';
import type { BrowserSession } from './fetch/browser.ts';
import { runLocalFetch } from './local-fetch.ts';
import { createRunContext } from './runner.ts';

const HOST = 'blocked.example.test';
const NOW = '2026-11-26T12:00:00.000Z';
const ENV: PipelineEnv = Object.freeze({
  DATA_BUCKET: 'fixture',
  DATA_ENDPOINT: 'http://localhost:8333',
  DATA_REGION: 'us-east-1',
  DATA_ACCESS_KEY_ID: 'fixture',
  DATA_SECRET_ACCESS_KEY: 'fixture',
  S3_FORCE_PATH_STYLE: true,
  LOG_LEVEL: 'debug',
  PIPELINE_RUN_ID: null,
  FEC_API_KEY: null,
  PIPELINE_SCRATCH_URL: null,
  isCi: false,
});

/** No snapshot entries, and a browser that is never opened. */
const NO_SNAPSHOTS = {
  snapshots: [],
  browser: (): Promise<BrowserSession> => Promise.reject(new Error('no browser in this test')),
} as const;

beforeEach(async () => {
  await resetStorage();
});

async function blockHost(bucket: DataBucket, urls: readonly string[]): Promise<void> {
  const registry = new HostRegistry(bucket);
  await registry.load();
  registry.markBlocked(HOST, 403, 'challenge', NOW);
  await registry.save();
  for (const url of urls) {
    await queueForLocalFetch(bucket, HOST, {
      url,
      class: 'crawl',
      state: 'NC',
      purpose: 'cache',
      queued_at: NOW,
    });
  }
}

async function context(bucket: DataBucket, page: (url: URL) => Scripted) {
  const { log, lines } = captureLogger();
  // A Saturday, so crawl-class requests are outside business hours.
  const made = await makeFetcher({
    bucket,
    log,
    clock: new TestClock(Date.parse('2026-11-28T16:00:00.000Z')),
    handler: (_req, url) => (url.pathname === '/robots.txt' ? robotsAnswer(url) : page(url)),
  });
  const ctx = createRunContext({
    env: ENV,
    now: new Date(NOW),
    bucket,
    fetcher: made.fetcher,
    log,
  });
  return { ctx, lines, transport: made.transport };
}

describe('pnpm pipeline fetch --hosts blocked', () => {
  it('nothing blocked, nothing to do', async () => {
    const { bucket } = await getTestBucket('data');
    const { ctx, lines, transport } = await context(bucket, () => ({ status: 200 }));
    expect(await runLocalFetch(ctx, { state: null, ...NO_SNAPSHOTS })).toEqual({
      exitCode: 0,
      fetched: 0,
      left: 0,
    });
    expect(lines.some((line) => line.parsed.event === 'local_fetch.none')).toBe(true);
    expect(transport.requests).toHaveLength(0);
  });

  it('a queued URL is fetched into the cache and removed from the queue', async () => {
    const { bucket } = await getTestBucket('data');
    await blockHost(bucket, [`https://${HOST}/a`, `https://${HOST}/b`]);
    const { ctx } = await context(bucket, (url) => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: `<p>${url.pathname}</p>`,
    }));
    expect(await runLocalFetch(ctx, { state: null, ...NO_SNAPSHOTS })).toEqual({
      exitCode: 0,
      fetched: 2,
      left: 0,
    });
    expect(await readQueue(bucket, HOST)).toEqual([]);
    const cached: string[] = [];
    for await (const info of bucket.list(bucketKeys.rawCachePrefix())) {
      cached.push(info.key);
    }
    expect(cached).toHaveLength(2);
    // The registry is unchanged: only CI marks and lifts.
    const registry = new HostRegistry(bucket);
    await registry.load();
    expect(registry.blockedHosts()).toEqual([HOST]);
  });

  it('a state filter leaves other states queued', async () => {
    const { bucket } = await getTestBucket('data');
    await blockHost(bucket, [`https://${HOST}/a`]);
    const { ctx, transport } = await context(bucket, () => ({ status: 200, body: 'x' }));
    expect(await runLocalFetch(ctx, { state: 'WA', ...NO_SNAPSHOTS })).toEqual({
      exitCode: 0,
      fetched: 0,
      left: 0,
    });
    expect(transport.requests).toHaveLength(0);
    expect((await readQueue(bucket, HOST)).map((entry) => entry.url)).toEqual([
      `https://${HOST}/a`,
    ]);
  });

  it('a challenge stops the host and keeps its queue', async () => {
    const { bucket } = await getTestBucket('data');
    await blockHost(bucket, [`https://${HOST}/a`, `https://${HOST}/b`]);
    const { ctx, transport } = await context(bucket, () => ({
      status: 403,
      body: '<title>Attention Required! | Cloudflare</title>',
    }));
    expect(await runLocalFetch(ctx, { state: null, ...NO_SNAPSHOTS })).toEqual({
      exitCode: 1,
      fetched: 0,
      left: 2,
    });
    expect(transport.pages()).toHaveLength(1);
    expect((await readQueue(bucket, HOST)).map((entry) => entry.url)).toEqual([
      `https://${HOST}/a`,
      `https://${HOST}/b`,
    ]);
  });

  it('a queued snapshot URL is stored as the archiver would', async () => {
    const { bucket } = await getTestBucket('data');
    const listUrl = `https://${HOST}/lists/Candidate_Listing_2026.csv`;
    const registry = new HostRegistry(bucket);
    await registry.load();
    registry.markBlocked(HOST, 403, 'challenge', NOW);
    await registry.save();
    await queueForLocalFetch(bucket, HOST, {
      url: listUrl,
      class: 'adapter',
      state: 'NC',
      purpose: 'snapshot:nc-sbe',
      queued_at: NOW,
    });
    const { ctx, lines } = await context(bucket, () => ({
      status: 200,
      headers: { 'content-type': 'text/csv', etag: '"fixture-etag"' },
      body: 'county,contest\nFixture County,Fixture Office\n',
    }));
    expect(await runLocalFetch(ctx, { state: null, ...NO_SNAPSHOTS })).toEqual({
      exitCode: 0,
      fetched: 1,
      left: 0,
    });
    expect(await readQueue(bucket, HOST)).toEqual([]);
    const keys: string[] = [];
    for await (const info of bucket.list('')) {
      keys.push(info.key);
    }
    const listKey = 'raw/filings/NC/2026-11-26/nc-sbe/120000Z.csv';
    const sidecarKey = 'raw/filings/NC/2026-11-26/nc-sbe/120000Z.json';
    expect(keys).toContain(listKey);
    expect(keys).toContain(sidecarKey);
    // The list never reaches the raw cache.
    expect(keys.filter((key) => key.startsWith(bucketKeys.rawCachePrefix()))).toEqual([]);
    const sidecar = await bucket.getJson(sidecarKey, SnapshotSidecarSchema);
    expect(sidecar).toMatchObject({
      url: listUrl,
      fetched_at: NOW,
      status: 200,
      etag: '"fixture-etag"',
      bytes: 45,
    });
    expect(sidecar?.unchanged).toBeUndefined();
    const done = lines.filter((line) => line.parsed.event === 'snapshot.done');
    expect(done.map((line) => line.parsed.result)).toEqual(['saved']);
    expect(lines.some((line) => line.raw.includes('Fixture County'))).toBe(false);
  });
});
