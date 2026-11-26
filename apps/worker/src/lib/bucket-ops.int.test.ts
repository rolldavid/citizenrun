import { randomUUID } from 'node:crypto';
import {
  getTestBucket,
  getTestObject,
  listTestKeys,
  putTestObject,
  resetStorage,
} from '@citizenrun/db/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE_BATCH_MAX,
  ObjectTooLargeError,
  deleteKeys,
  deletePrefix,
  getObjectBytes,
  headObject,
  listKeys,
  listPrefixes,
  putObject,
} from './bucket-ops.ts';

const FIXTURE_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const OCTETS = 'application/octet-stream';

beforeEach(async () => {
  await resetStorage();
});

describe('bucket helpers', () => {
  it('heads, puts and gets an object', async () => {
    const media = await getTestBucket('media');
    await putObject(media, 't/one.bin', FIXTURE_BYTES, {
      contentType: 'image/webp',
      cacheControl: 'private, max-age=60',
    });
    expect(await headObject(media, 't/one.bin')).toEqual({ size: 11, contentType: 'image/webp' });
    expect(await getObjectBytes(media, 't/one.bin', 11)).toEqual(FIXTURE_BYTES);
    expect(await getTestObject('media', 't/one.bin')).toEqual(FIXTURE_BYTES);
  });

  it('a missing object heads as null', async () => {
    const media = await getTestBucket('media');
    expect(await headObject(media, 't/absent.bin')).toBeNull();
    await expect(getObjectBytes(media, 't/absent.bin', 10)).rejects.toMatchObject({
      name: 'NoSuchKey',
    });
  });

  it('refuses a body over the limit', async () => {
    await putTestObject('media', 't/eleven.bin', FIXTURE_BYTES, OCTETS);
    const media = await getTestBucket('media');
    await expect(getObjectBytes(media, 't/eleven.bin', 10)).rejects.toBeInstanceOf(
      ObjectTooLargeError,
    );
  });

  it('deletes a prefix in batches', async () => {
    const media = await getTestBucket('media');
    for (const name of ['1', '2', '3', '4', '5', '6', '7']) {
      await putTestObject('media', `t/a/${name}`, new Uint8Array([1]), OCTETS);
    }
    await putTestObject('media', 't/b/x', new Uint8Array([1]), OCTETS);
    const afterBatch = vi.fn(() => Promise.resolve());
    expect(await deletePrefix(media, 't/a/', { batchSize: 3, afterBatch })).toBe(7);
    expect(afterBatch).toHaveBeenCalledTimes(3);
    expect(await listTestKeys('media', 't/')).toEqual(['t/b/x']);
  });

  it('refuses an unsafe prefix', async () => {
    const media = await getTestBucket('media');
    await putTestObject('media', 't/a/1', new Uint8Array([1]), OCTETS);
    const send = vi.spyOn(media.client, 'send');
    try {
      await expect(deletePrefix(media, '')).rejects.toBeInstanceOf(RangeError);
      await expect(deletePrefix(media, 't/a')).rejects.toBeInstanceOf(RangeError);
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
    expect(await listTestKeys('media', '')).toEqual(['t/a/1']);
  });

  it('lists keys with their sizes and deletes a list of keys', async () => {
    const media = await getTestBucket('media');
    await putTestObject('media', 't/k/1', new Uint8Array(2), OCTETS);
    await putTestObject('media', 't/k/2', new Uint8Array(3), OCTETS);
    const listed: { key: string; size: number }[] = [];
    for await (const item of listKeys(media, 't/k/')) {
      expect(item.lastModified).toBeInstanceOf(Date);
      listed.push({ key: item.key, size: item.size });
    }
    expect(listed).toEqual([
      { key: 't/k/1', size: 2 },
      { key: 't/k/2', size: 3 },
    ]);
    expect(await deleteKeys(media, [])).toBe(0);
    expect(await deleteKeys(media, ['t/k/1', 't/k/2'])).toBe(2);
    expect(await listTestKeys('media', 't/')).toEqual([]);
    await expect(deleteKeys(media, ['t/k/1'], { batchSize: DELETE_BATCH_MAX + 1 })).rejects.toThrow(
      RangeError,
    );
  });

  it('an aborted signal stops a delete before its next batch', async () => {
    const media = await getTestBucket('media');
    for (const name of ['1', '2', '3']) {
      await putTestObject('media', `t/s/${name}`, new Uint8Array([1]), OCTETS);
    }
    const controller = new AbortController();
    const reason = new Error('fixture abort');
    await expect(
      deleteKeys(media, ['t/s/1', 't/s/2', 't/s/3'], {
        batchSize: 1,
        signal: controller.signal,
        afterBatch: () => {
          controller.abort(reason);
          return Promise.resolve();
        },
      }),
    ).rejects.toBe(reason);
    expect(await listTestKeys('media', 't/')).toEqual(['t/s/2', 't/s/3']);
  });
});

async function collect(items: AsyncIterable<string>): Promise<string[]> {
  const found: string[] = [];
  for await (const item of items) {
    found.push(item);
  }
  return found;
}

describe('listPrefixes', () => {
  it('lists the prefixes one level down', async () => {
    const data = await getTestBucket('data');
    // A folder of its own: the local store may still list folders an earlier file emptied.
    const root = `fixture-${randomUUID()}/`;
    for (const key of ['bundles/a/x', 'bundles/a/y', 'bundles/b/z', 'bundles/top', 'other/c/w']) {
      await putTestObject('data', `${root}${key}`, FIXTURE_BYTES, OCTETS);
    }
    expect((await collect(listPrefixes(data, `${root}bundles/`))).sort()).toEqual([
      `${root}bundles/a/`,
      `${root}bundles/b/`,
    ]);
    expect(await collect(listPrefixes(data, `${root}bundles/a/`))).toEqual([]);
  });

  it('refuses an unsafe prefix', async () => {
    const data = await getTestBucket('data');
    const send = vi.spyOn(data.client, 'send');
    try {
      expect(() => listPrefixes(data, '')).toThrow(new RangeError('unsafe prefix'));
      expect(() => listPrefixes(data, 'bundles')).toThrow(new RangeError('unsafe prefix'));
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });
});
