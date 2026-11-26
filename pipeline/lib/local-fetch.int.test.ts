import { beforeEach, describe, expect, it } from 'vitest';
import type { PipelineEnv } from '../env.ts';
import { captureLogger } from '../testing/capture-log.ts';
import { getTestBucket, resetStorage } from '../testing/setup.ts';
import { bucketKeys } from './bucket.ts';
import type { DataBucket } from './bucket.ts';
import { HostRegistry, queueForLocalFetch, readQueue } from './fetch/hosts.ts';
import { TestClock, makeFetcher, robotsAnswer } from './fetch/test-fakes.ts';
import type { Scripted } from './fetch/test-fakes.ts';
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
  isCi: false,
});

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
    expect(await runLocalFetch(ctx, { state: null })).toEqual({ exitCode: 0, fetched: 0, left: 0 });
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
    expect(await runLocalFetch(ctx, { state: null })).toEqual({ exitCode: 0, fetched: 2, left: 0 });
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
    expect(await runLocalFetch(ctx, { state: 'WA' })).toEqual({ exitCode: 0, fetched: 0, left: 0 });
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
    expect(await runLocalFetch(ctx, { state: null })).toEqual({ exitCode: 1, fetched: 0, left: 2 });
    expect(transport.pages()).toHaveLength(1);
    expect((await readQueue(bucket, HOST)).map((entry) => entry.url)).toEqual([
      `https://${HOST}/a`,
      `https://${HOST}/b`,
    ]);
  });
});
