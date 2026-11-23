import { randomBytes } from 'node:crypto';
import { getTestBucket, putTestObject, resetStorage } from '@citizenrun/db/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAllObjects } from './storage.ts';
import type { Bucket, ListedObject } from './storage.ts';

async function listed(bucket: Bucket, prefix: string, pageSize?: number): Promise<ListedObject[]> {
  const items: ListedObject[] = [];
  for await (const item of listAllObjects(
    bucket,
    prefix,
    pageSize === undefined ? {} : { pageSize },
  )) {
    items.push(item);
  }
  return items;
}

beforeEach(async () => {
  await resetStorage();
});

describe('listAllObjects', () => {
  it('lists every object under a prefix across pages', async () => {
    const keys = [1, 2, 3, 4, 5].map((index) => `pg/2026/11/fixture-${String(index)}.dump.enc`);
    for (const [index, key] of keys.entries()) {
      await putTestObject('backups', key, new Uint8Array(index + 1), 'application/octet-stream');
    }
    await putTestObject('backups', 'other/fixture.json', new Uint8Array(9), 'application/json');
    const bucket = await getTestBucket('backups');
    const send = vi.spyOn(bucket.client, 'send');
    try {
      const items = await listed(bucket, 'pg/', 2);
      expect(items.map((item) => item.key)).toEqual(keys);
      expect(items.map((item) => item.size)).toEqual([1, 2, 3, 4, 5]);
      for (const item of items) {
        expect(item.lastModified).toBeInstanceOf(Date);
        expect(Number.isNaN(item.lastModified.getTime())).toBe(false);
      }
      // Five keys at two a page take three requests.
      expect(send).toHaveBeenCalledTimes(3);
    } finally {
      send.mockRestore();
    }
  });

  it('an empty prefix lists the whole bucket', async () => {
    await putTestObject('backups', 'pg/a', new Uint8Array(1), 'application/octet-stream');
    await putTestObject('backups', 'other/b', new Uint8Array(2), 'application/octet-stream');
    const items = await listed(await getTestBucket('backups'), '');
    expect(items.map((item) => item.key).sort()).toEqual(['other/b', 'pg/a']);
  });

  it('a listing error is thrown', async () => {
    const { client } = await getTestBucket('backups');
    const missing: Bucket = { client, bucket: `t-missing-${randomBytes(6).toString('hex')}` };
    await expect(listed(missing, 'pg/')).rejects.toBeInstanceOf(Error);
  });
});
