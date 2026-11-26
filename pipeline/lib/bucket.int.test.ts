import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client } from '@citizenrun/shared/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { bucketContractCases } from '../testing/bucket-cases.ts';
import { captureLogger } from '../testing/capture-log.ts';
import { getTestBucket, resetStorage } from '../testing/setup.ts';
import { BucketKeyError, PART_SIZE, bucketKeys, createDataBucket } from './bucket.ts';

beforeEach(async () => {
  await resetStorage();
});

describe('the data bucket', () => {
  bucketContractCases(async () => {
    const { config } = await getTestBucket('data');
    const { log, lines } = captureLogger();
    return {
      bucket: createDataBucket(config, { dryRun: false, log }),
      logLines: () => lines.map((line) => line.parsed),
    };
  });

  it('putStream of 40 MiB uses multipart and reports the right sha256', async () => {
    const { bucket, config } = await getTestBucket('data');
    const bytes = randomBytes(40 * 1024 * 1024);
    // Chunks of 1 MiB, as a download arrives.
    const chunks = Array.from({ length: 40 }, (_, index) =>
      bytes.subarray(index * 1024 * 1024, (index + 1) * 1024 * 1024),
    );
    const key = 'datasets/fixture/2026/big.bin';
    const result = await bucket.putStream(key, Readable.from(chunks), 'application/octet-stream');
    expect(result.bytes).toBe(bytes.length);
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const client = createS3Client(config);
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      expect(head.ContentLength).toBe(bytes.length);
      // A multipart object's ETag ends with the part count: 16, 16 and 8 MiB.
      expect(head.ETag?.replaceAll('"', '').endsWith('-3')).toBe(true);
    } finally {
      client.destroy();
    }
    const back = await bucket.getBytes(key);
    expect(back === null ? '' : createHash('sha256').update(back).digest('hex')).toBe(
      result.sha256,
    );
  });

  it('putStream of exactly one part is a single put', async () => {
    const { bucket } = await getTestBucket('data');
    const bytes = randomBytes(PART_SIZE);
    const result = await bucket.putStream(
      'datasets/fixture/2026/one.bin',
      Readable.from([bytes]),
      'application/octet-stream',
    );
    expect(result.bytes).toBe(PART_SIZE);
    expect((await bucket.head('datasets/fixture/2026/one.bin'))?.size).toBe(PART_SIZE);
  });

  it('list pages past 1,000 keys', async () => {
    const { bucket } = await getTestBucket('data');
    const keys = Array.from(
      { length: 1005 },
      (_, index) => `cache/raw/${createHash('sha256').update(String(index)).digest('hex')}.html`,
    );
    for (let start = 0; start < keys.length; start += 50) {
      await Promise.all(
        keys
          .slice(start, start + 50)
          .map((key) => bucket.putBytes(key, Buffer.from('x'), 'text/html')),
      );
    }
    let count = 0;
    for await (const info of bucket.list(bucketKeys.rawCachePrefix())) {
      expect(info.size).toBe(1);
      count += 1;
    }
    expect(count).toBe(1005);
    await bucket.delete(keys);
    let left = 0;
    for await (const info of bucket.list(bucketKeys.rawCachePrefix())) {
      left += info.key === '' ? 0 : 1;
    }
    expect(left).toBe(0);
  });

  it('dry run writes nothing and counts', async () => {
    const { config } = await getTestBucket('data');
    const { log } = captureLogger();
    const dry = createDataBucket(config, { dryRun: true, log });
    await dry.putBytes('datasets/a/1/x.csv', Buffer.from('abc'), 'text/csv');
    await dry.putStream('datasets/a/1/y.csv', Readable.from([Buffer.from('abcdef')]), 'text/csv');
    await dry.putBytes('cache/raw/z', Buffer.from('z'), 'text/html');
    expect(await dry.head('datasets/a/1/x.csv')).toBeNull();
    expect(await dry.head('datasets/a/1/y.csv')).toBeNull();
    expect(dry.dryRunCounts().get('datasets')).toEqual({ objects: 2, bytes: 9 });
    expect(dry.dryRunCounts().get('cache')).toEqual({ objects: 1, bytes: 1 });
  });

  it('copyFrom copies bytes and content type', async () => {
    const { bucket: source } = await getTestBucket('data');
    const { bucket: target } = await getTestBucket('target');
    await source.putBytes('assets/photos/a.jpg', Buffer.from('jpeg'), 'image/jpeg');
    expect(await target.copyFrom(source, 'assets/photos/a.jpg')).toEqual({ bytes: 4 });
    const info = await target.head('assets/photos/a.jpg');
    expect(info?.contentType).toBe('image/jpeg');
    expect(Buffer.from((await target.getBytes('assets/photos/a.jpg')) ?? []).toString()).toBe(
      'jpeg',
    );
  });

  it('bucketKeys refuses a bad host and a bad date', () => {
    expect(bucketKeys.robots('www.example.gov')).toBe('cache/robots/www.example.gov.json');
    expect(() => bucketKeys.robots('WWW.Example.gov')).toThrow(BucketKeyError);
    expect(() => bucketKeys.robots('a/b.gov')).toThrow(BucketKeyError);
    expect(() => bucketKeys.fetchQueue('user@example.gov')).toThrow(BucketKeyError);
    expect(() => bucketKeys.reachability('2026-13-01')).toThrow(BucketKeyError);
    expect(() => bucketKeys.reachability('2026-02-30')).toThrow(BucketKeyError);
    expect(() => bucketKeys.reachability('20261116')).toThrow(BucketKeyError);
    expect(() => bucketKeys.pages('nc')).toThrow(BucketKeyError);
    expect(() => bucketKeys.dataset('acs5', '..', 'x')).toThrow(BucketKeyError);
    expect(() => bucketKeys.bundleFile('20261116T030000Z-full', '../x')).toThrow(BucketKeyError);
  });

  it('bucketKeys builds the layout keys', () => {
    const sha = 'a'.repeat(64);
    expect(bucketKeys.reachability('2026-11-16')).toBe(
      'pipeline-state/reachability/2026-11-16.json',
    );
    expect(bucketKeys.rawFilings('NC', '2026-11-16', 'nc-sbe', '073000', 'csv')).toBe(
      'raw/filings/NC/2026-11-16/nc-sbe/073000Z.csv',
    );
    expect(bucketKeys.rawFilings('LA', '2026-11-16', 'la-sos', '073000', 'csv', '123')).toBe(
      'raw/filings/LA/2026-11-16/la-sos/073000Z-123.csv',
    );
    expect(bucketKeys.rawFilingsSidecar('LA', '2026-11-16', 'la-sos', '073000', '123')).toBe(
      'raw/filings/LA/2026-11-16/la-sos/073000Z-123.json',
    );
    expect(() =>
      bucketKeys.rawFilings('LA', '2026-11-16', 'la-sos', '073000', 'csv', 'x1'),
    ).toThrow(BucketKeyError);
    expect(bucketKeys.stagePart('s01-base', 'NC', 'districts.ndjson.gz', 'local-1')).toBe(
      'stage-out/s01-base/NC/districts.ndjson.gz.part-local-1',
    );
    expect(bucketKeys.rawCache(sha, 'html')).toBe(`cache/raw/${sha}.html`);
    expect(bucketKeys.textCache(sha)).toBe(`cache/text/${sha}.txt.gz`);
    expect(bucketKeys.aiLedgerWorker('2026-11')).toBe('ai-ledger/2026-11/worker.json');
    expect(bucketKeys.aiBatchPending('run-1', 2)).toBe('ai-batches/pending-run-1-2/manifest.json');
    expect(bucketKeys.pointer('full')).toBe('bundles/index/full.json');
  });
});
