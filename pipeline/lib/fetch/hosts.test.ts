import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../../testing/memory-bucket.ts';
import { bucketKeys } from '../bucket.ts';
import {
  BLOCKED_RETRY_MS,
  HostRegistry,
  HostRegistrySchema,
  isForbiddenHost,
  queueForLocalFetch,
  readQueue,
  removeFromQueue,
} from './hosts.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-26T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('blocked hosts are marked, not evaded', () => {
  it('a blocked host is skipped for 30 days, then tried once', async () => {
    const bucket = createMemoryBucket();
    const registry = new HostRegistry(bucket);
    await registry.load();
    expect(registry.isBlocked('a.example.test', T0)).toBe(false);
    registry.markBlocked('a.example.test', 403, 'challenge', iso(T0));
    await registry.save();

    const reloaded = new HostRegistry(bucket);
    await reloaded.load();
    expect(reloaded.blockedHosts()).toEqual(['a.example.test']);
    expect(reloaded.isBlocked('a.example.test', T0 + 29 * DAY_MS)).toBe(true);
    expect(reloaded.isBlocked('A.Example.Test', T0 + BLOCKED_RETRY_MS - 1)).toBe(true);
    // After 30 days one request is allowed; its outcome is recorded.
    expect(reloaded.isBlocked('a.example.test', T0 + BLOCKED_RETRY_MS)).toBe(false);
    reloaded.markBlocked('a.example.test', 403, 'challenge', iso(T0 + BLOCKED_RETRY_MS));
    expect(reloaded.isBlocked('a.example.test', T0 + BLOCKED_RETRY_MS + DAY_MS)).toBe(true);
    reloaded.markOk('a.example.test', 200, iso(T0 + 61 * DAY_MS));
    await reloaded.save();
    expect(reloaded.isBlocked('a.example.test', T0 + 61 * DAY_MS)).toBe(false);
    const file = await bucket.getJson(bucketKeys.hosts(), HostRegistrySchema);
    expect(file?.['a.example.test']).toEqual({
      status: 'ok',
      since: iso(T0 + 61 * DAY_MS),
      last_status: 200,
      last_checked_at: iso(T0 + 61 * DAY_MS),
      reason: null,
    });
  });

  it('the queue does not duplicate a URL', async () => {
    const bucket = createMemoryBucket();
    const entry = {
      url: 'https://a.example.test/page',
      class: 'crawl' as const,
      state: 'NC',
      purpose: 'cache',
      queued_at: iso(T0),
    };
    await queueForLocalFetch(bucket, 'a.example.test', entry);
    await queueForLocalFetch(bucket, 'a.example.test', { ...entry, queued_at: iso(T0 + 1000) });
    await queueForLocalFetch(bucket, 'a.example.test', {
      ...entry,
      url: 'https://a.example.test/other',
    });
    const queue = await readQueue(bucket, 'a.example.test');
    expect(queue.map((item) => item.url)).toEqual([
      'https://a.example.test/page',
      'https://a.example.test/other',
    ]);
    expect(queue[0]?.queued_at).toBe(iso(T0));
    await removeFromQueue(bucket, 'a.example.test', ['https://a.example.test/page']);
    expect((await readQueue(bucket, 'a.example.test')).map((item) => item.url)).toEqual([
      'https://a.example.test/other',
    ]);
    await removeFromQueue(bucket, 'a.example.test', ['https://a.example.test/other']);
    expect(bucket.keys()).toEqual([]);
  });

  it('forbidden matches subdomains', () => {
    const rules = { forbiddenHosts: ['ballotpedia.org'], resultsHosts: [] };
    expect(isForbiddenHost('ballotpedia.org', rules)).toBe(true);
    expect(isForbiddenHost('www.ballotpedia.org', rules)).toBe(true);
    expect(isForbiddenHost('WWW.Ballotpedia.org', rules)).toBe(true);
    expect(isForbiddenHost('notballotpedia.org', rules)).toBe(false);
    expect(isForbiddenHost('elections.il.gov', { forbiddenHosts: [], resultsHosts: [] })).toBe(
      true,
    );
    expect(isForbiddenHost('www.elections.il.gov', { forbiddenHosts: [], resultsHosts: [] })).toBe(
      true,
    );
    expect(isForbiddenHost('il.gov', { forbiddenHosts: [], resultsHosts: [] })).toBe(false);
  });
});
