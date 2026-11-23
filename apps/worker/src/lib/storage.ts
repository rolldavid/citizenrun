import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createS3Client } from '@citizenrun/shared/storage';
import type { BucketHandle } from '@citizenrun/shared/storage';
import type { WorkerEnv } from '../env.ts';
import { OUTBOUND_TIMEOUT_MS } from './outbound-fetch.ts';

/** A client and the one bucket it serves (D-248). */
export type Bucket = BucketHandle;

/** One object of a listing: its key, its size in bytes and when the store last wrote it. */
export type ListedObject = { key: string; size: number; lastModified: Date };

// ListObjectsV2's own page limit.
const DEFAULT_PAGE_SIZE = 1000;

/** The buckets the worker holds keys for: `backups` for now. Opens no connection itself. */
export function createWorkerBuckets(env: WorkerEnv): { backups: Bucket } {
  return {
    backups: {
      client: createS3Client({
        endpoint: env.BACKUPS_ENDPOINT,
        region: env.BACKUPS_REGION,
        accessKeyId: env.BACKUPS_ACCESS_KEY_ID,
        secretAccessKey: env.BACKUPS_SECRET_ACCESS_KEY,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      }),
      bucket: env.BACKUPS_BUCKET,
    },
  };
}

/**
 * The host a bucket's requests go to (D-248): the endpoint's host in path style, otherwise
 * `<bucket>.<endpoint host>`.
 */
export function bucketHost(input: {
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
}): string {
  const host = new URL(input.endpoint).host;
  return input.forcePathStyle ? host : `${input.bucket}.${host}`;
}

/**
 * Every object under `prefix`, page by page (`pageSize` keys a request, default 1,000), in the
 * store's key order. Throws on any store error, so a job's caller lets pg-boss retry it. Each
 * request is abandoned after the bucket timeout (CTL-37).
 */
export async function* listAllObjects(
  bucket: Bucket,
  prefix: string,
  options: { pageSize?: number } = {},
): AsyncIterable<ListedObject> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  let token: string | undefined;
  do {
    const page = await bucket.client.send(
      new ListObjectsV2Command({
        Bucket: bucket.bucket,
        Prefix: prefix,
        MaxKeys: pageSize,
        ...(token === undefined ? {} : { ContinuationToken: token }),
      }),
      { abortSignal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS.bucket) },
    );
    for (const item of page.Contents ?? []) {
      if (item.Key === undefined || item.Size === undefined || item.LastModified === undefined) {
        continue;
      }
      yield { key: item.Key, size: item.Size, lastModified: item.LastModified };
    }
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
}
