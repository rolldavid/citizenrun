import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BundleObjectMissingError } from '../bundle/errors.ts';
import type { MediaObjectStore } from '../bundle/assets.ts';
import type { DataBucketClient } from '../bundle/reader.ts';
import { getTestBucket, getTestObject, isMissingKey } from './storage.ts';

// The load core's two storage seams on this worker's test buckets.

/** The test `data` bucket as the load core's DataBucketClient: a missing key rejects with BundleObjectMissingError. */
export function testDataBucketClient(): DataBucketClient {
  return {
    async getStream(key) {
      const { client, bucket } = await getTestBucket('data');
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!(result.Body instanceof Readable)) {
          throw new Error('The store returned no stream.');
        }
        return result.Body;
      } catch (error) {
        if (isMissingKey(error)) {
          throw new BundleObjectMissingError(key);
        }
        throw error;
      }
    },
  };
}

/** The test `media` bucket as the load core's MediaObjectStore. */
export function testMediaStore(): MediaObjectStore {
  return {
    async exists(key) {
      const { client, bucket } = await getTestBucket('media');
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (isMissingKey(error)) {
          return false;
        }
        throw error;
      }
    },
    async get(key) {
      const bytes = await getTestObject('media', key);
      if (bytes === null) {
        throw new Error('No such media object.');
      }
      return bytes;
    },
    async put(key, body, contentType) {
      const { client, bucket } = await getTestBucket('media');
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
  };
}

/** The bytes under `key` in this worker's bucket of `kind`, or null. */
export async function readTestObject(
  kind: 'data' | 'media',
  key: string,
): Promise<Uint8Array | null> {
  return getTestObject(kind, key);
}
