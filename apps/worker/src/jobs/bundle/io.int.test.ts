import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { BundleObjectMissingError, bucketReader } from '@citizenrun/db/bundle';
import { getTestBucket, putTestObject, resetStorage } from '@citizenrun/db/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ASSET_MAX_BYTES,
  TOUCH_EVERY_LINES,
  dataBucketClient,
  mediaObjectStore,
  touchingReader,
} from './io.ts';

beforeEach(async () => {
  await resetStorage();
});

describe('the bundle bucket adapters', () => {
  it('a missing key is BundleObjectMissingError', async () => {
    const client = dataBucketClient(await getTestBucket('data'));
    await expect(
      client.getStream('bundles/20270101T000000Z-full/manifest.json'),
    ).rejects.toBeInstanceOf(BundleObjectMissingError);
    // A missing bucket is a store error, retried by the job, never a missing object.
    const data = await getTestBucket('data');
    const gone = dataBucketClient({ client: data.client, bucket: `${data.bucket}-gone` });
    const failure: unknown = await gone
      .getStream('bundles/index/full.json')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(BundleObjectMissingError);
  });

  it('streams an object that exists', async () => {
    await putTestObject(
      'data',
      'bundles/fixture/a.txt',
      new TextEncoder().encode('fixture'),
      'text/plain',
    );
    const stream = await dataBucketClient(await getTestBucket('data')).getStream(
      'bundles/fixture/a.txt',
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe('fixture');
  });

  it('media store round trip', async () => {
    const store = mediaObjectStore(await getTestBucket('media'));
    const key = 'civic/photos/fixture.jpg';
    const body = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(await store.exists(key)).toBe(false);
    await store.put(key, body, 'image/jpeg');
    expect(await store.exists(key)).toBe(true);
    expect(await store.get(key)).toEqual(body);
    expect(ASSET_MAX_BYTES).toBe(20_000_000);
  });

  it('the touching reader touches every 1,000 lines', async () => {
    const lines = Array.from({ length: 2500 }, (_, index) => JSON.stringify({ n: index }));
    const gz = gzipSync(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
    const expect256 = createHash('sha256').update(gz).digest('hex');
    await putTestObject('data', 'bundles/fixture/rows.ndjson.gz', gz, 'application/gzip');
    let touches = 0;
    const reader = touchingReader(
      bucketReader(dataBucketClient(await getTestBucket('data')), 'bundles/fixture/manifest.json'),
      () => {
        touches += 1;
        return Promise.resolve();
      },
    );
    let read = 0;
    for await (const line of reader.lines('rows.ndjson.gz', {
      sha256: expect256,
      bytes: gz.length,
    })) {
      expect(line).toBe(lines[read]);
      read += 1;
    }
    expect(read).toBe(2500);
    expect(TOUCH_EVERY_LINES).toBe(1000);
    expect(touches).toBe(2);
  });
});
