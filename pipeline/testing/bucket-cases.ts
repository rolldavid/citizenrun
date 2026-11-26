import { expect, it } from 'vitest';
import { z } from 'zod';
import { BucketJsonError } from '../lib/bucket.ts';
import type { DataBucket } from '../lib/bucket.ts';

const FixtureSchema = z.strictObject({ name: z.string(), count: z.int() });

/** A bucket under test and the parsed lines its logger wrote. */
export type BucketUnderTest = {
  bucket: DataBucket;
  logLines: () => readonly Record<string, unknown>[];
};

/**
 * The json, list, delete and invalid-index cases, run against the store (`bucket.int.test.ts`) and
 * against the memory bucket (`memory-bucket.test.ts`), so both keep the same contract.
 */
export function bucketContractCases(make: () => Promise<BucketUnderTest>): void {
  it('json round trip with its schema', async () => {
    const { bucket } = await make();
    await bucket.putJson('pipeline-state/fixture.json', { name: 'a', count: 2 }, FixtureSchema);
    expect(await bucket.getJson('pipeline-state/fixture.json', FixtureSchema)).toEqual({
      name: 'a',
      count: 2,
    });
    const info = await bucket.head('pipeline-state/fixture.json');
    expect(info?.contentType).toBe('application/json');
    expect(await bucket.getJson('pipeline-state/absent.json', FixtureSchema)).toBeNull();
    await expect(
      bucket.putJson('pipeline-state/bad.json', { name: 'a' } as never, FixtureSchema),
    ).rejects.toThrow();
    expect(await bucket.head('pipeline-state/bad.json')).toBeNull();
  });

  it('a stored object that fails the schema throws with its key', async () => {
    const { bucket } = await make();
    await bucket.putBytes('pipeline-state/x.json', Buffer.from('{"name":1}'), 'application/json');
    const attempt = bucket.getJson('pipeline-state/x.json', FixtureSchema);
    await expect(attempt).rejects.toBeInstanceOf(BucketJsonError);
    await expect(attempt).rejects.toMatchObject({ objectKey: 'pipeline-state/x.json' });
    await bucket.putBytes('pipeline-state/y.json', Buffer.from('not json'), 'application/json');
    await expect(bucket.getJson('pipeline-state/y.json', FixtureSchema)).rejects.toBeInstanceOf(
      BucketJsonError,
    );
  });

  it('an invalid index file reads as absent and logs index_file.invalid with objectKey only', async () => {
    const { bucket, logLines } = await make();
    await bucket.putBytes(
      'bundles/index/full.json',
      Buffer.from('{"kind":"fixture-content"}'),
      'application/json',
    );
    expect(await bucket.readIndexFile('bundles/index/full.json', FixtureSchema)).toBeNull();
    const lines = logLines().filter((line) => line.event === 'index_file.invalid');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.objectKey).toBe('bundles/index/full.json');
    expect(JSON.stringify(lines[0])).not.toContain('fixture-content');
    expect(await bucket.readIndexFile('bundles/index/geometry.json', FixtureSchema)).toBeNull();
  });

  it('lists a prefix and deletes keys', async () => {
    const { bucket } = await make();
    for (const key of ['datasets/a/1/x', 'datasets/a/2/x', 'datasets/b/1/x', 'cache/raw/z']) {
      await bucket.putBytes(key, Buffer.from(key), 'text/plain');
    }
    const listed: string[] = [];
    for await (const info of bucket.list('datasets/a/')) {
      listed.push(info.key);
      expect(info.size).toBe(info.key.length);
      expect(info.lastModified).toBeInstanceOf(Date);
    }
    expect(listed.sort()).toEqual(['datasets/a/1/x', 'datasets/a/2/x']);
    await bucket.delete(['datasets/a/1/x', 'cache/raw/z']);
    await bucket.delete([]);
    expect(await bucket.head('datasets/a/1/x')).toBeNull();
    expect(await bucket.head('cache/raw/z')).toBeNull();
    expect(await bucket.head('datasets/b/1/x')).not.toBeNull();
  });
}
