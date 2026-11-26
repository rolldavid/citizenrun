import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { bucketContractCases } from './bucket-cases.ts';
import { captureLogger } from './capture-log.ts';
import { createMemoryBucket } from './memory-bucket.ts';

describe('the memory bucket', () => {
  bucketContractCases(() => {
    const { log, lines } = captureLogger();
    return Promise.resolve({
      bucket: createMemoryBucket({ log }),
      logLines: () => lines.map((line) => line.parsed),
    });
  });

  it('keeps content types, sizes and a LastModified the test sets', async () => {
    const bucket = createMemoryBucket();
    await bucket.putStream('cache/raw/a', Readable.from([Buffer.from('abc')]), 'text/html');
    const at = new Date('2020-01-01T00:00:00.000Z');
    bucket.setLastModified('cache/raw/a', at);
    expect(await bucket.head('cache/raw/a')).toEqual({
      key: 'cache/raw/a',
      size: 3,
      lastModified: at,
      contentType: 'text/html',
    });
    expect(bucket.keys()).toEqual(['cache/raw/a']);
  });

  it('a dry run writes nothing and counts', async () => {
    const bucket = createMemoryBucket({ dryRun: true });
    await bucket.putBytes('datasets/a/1/x', Buffer.from('abcd'), 'text/plain');
    expect(bucket.keys()).toEqual([]);
    expect(bucket.dryRunCounts().get('datasets')).toEqual({ objects: 1, bytes: 4 });
  });
});
