import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { BundleObjectMissingError } from '@citizenrun/db/bundle';
import type { BundleReader, DataBucketClient, MediaObjectStore } from '@citizenrun/db/bundle';
import { getObjectBytes, headObject, putObject } from '../../lib/bucket-ops.ts';
import { OUTBOUND_TIMEOUT_MS } from '../../lib/outbound-fetch.ts';
import type { Bucket } from '../../lib/storage.ts';

// The load core's storage seams over the worker's buckets: the `data` bucket it reads bundles
// from and the `media` bucket it copies civic assets into.

export const ASSET_MAX_BYTES = 20_000_000; // B-manifest

/** Lines read between two calls of `touch` (J-bundle.load step 5). */
export const TOUCH_EVERY_LINES = 1000;

/** True for the store's answer to a key that does not exist; a missing bucket is not one. */
export function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = 'name' in error ? error.name : null;
  if (name === 'NoSuchKey' || name === 'NotFound') {
    return true;
  }
  if (name === 'NoSuchBucket') {
    return false;
  }
  const metadata = '$metadata' in error ? error.$metadata : null;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    'httpStatusCode' in metadata &&
    metadata.httpStatusCode === 404
  );
}

/** GetObjectCommand; Body as a Node stream; NoSuchKey or 404 -> BundleObjectMissingError. */
export function dataBucketClient(bucket: Bucket): DataBucketClient {
  return {
    async getStream(key) {
      // The bucket timeout bounds the request until the body starts; a long file then streams
      // for as long as it takes, which the job's heartbeat covers.
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, OUTBOUND_TIMEOUT_MS.bucket);
      try {
        const result = await bucket.client.send(
          new GetObjectCommand({ Bucket: bucket.bucket, Key: key }),
          { abortSignal: controller.signal },
        );
        if (!(result.Body instanceof Readable)) {
          throw new TypeError('The object body is not a stream.');
        }
        return result.Body;
      } catch (error) {
        if (isMissingObject(error)) {
          throw new BundleObjectMissingError(key);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** exists: headObject !== null; get: getObjectBytes(bucket, key, ASSET_MAX_BYTES); put: putObject(bucket, key, body, { contentType }). */
export function mediaObjectStore(bucket: Bucket): MediaObjectStore {
  return {
    async exists(key) {
      return (await headObject(bucket, key)) !== null;
    },
    get(key) {
      return getObjectBytes(bucket, key, ASSET_MAX_BYTES);
    },
    async put(key, body, contentType) {
      await putObject(bucket, key, body, { contentType });
    },
  };
}

/** Wraps a reader so that every 1,000 lines read call touch() (J-bundle.load). */
export function touchingReader(reader: BundleReader, touch: () => Promise<void>): BundleReader {
  let read = 0;
  return {
    readManifest(path) {
      return reader.readManifest(path);
    },
    bytes(path, expect) {
      return reader.bytes(path, expect);
    },
    lines(path, expect) {
      const source = reader.lines(path, expect);
      return {
        async *[Symbol.asyncIterator]() {
          for await (const line of source) {
            read += 1;
            if (read % TOUCH_EVERY_LINES === 0) {
              await touch();
            }
            yield line;
          }
        },
      };
    },
  };
}
