import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { PutObjectCommandInput } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { OUTBOUND_TIMEOUT_MS } from './outbound-fetch.ts';
import { listAllObjects } from './storage.ts';
import type { Bucket } from './storage.ts';

/** DeleteObjects accepts at most 1,000 keys. */
export const DELETE_BATCH_MAX = 1000;

/** What a HeadObject tells about an object. */
export type ObjectHead = { size: number; contentType: string | null };

/** The object's body is longer than the caller allows. Names no key. */
export class ObjectTooLargeError extends Error {
  override readonly name = 'ObjectTooLargeError';

  constructor() {
    super('The object is larger than allowed.');
  }
}

/** The store answered a DeleteObjects call with errors for some keys. Names no key. */
export class BucketDeleteError extends Error {
  override readonly name = 'BucketDeleteError';
  readonly failed: number;

  constructor(failed: number) {
    super('The store refused to delete some objects.');
    this.failed = failed;
  }
}

type DeleteOptions = {
  batchSize?: number;
  signal?: AbortSignal;
  afterBatch?: () => Promise<void>;
};

// The bucket timeout of CTL-37, beside the caller's own signal when there is one.
function callSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(OUTBOUND_TIMEOUT_MS.bucket);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function checkedBatchSize(batchSize: number | undefined): number {
  const size = batchSize ?? DELETE_BATCH_MAX;
  if (!Number.isInteger(size) || size < 1 || size > DELETE_BATCH_MAX) {
    throw new RangeError('batch size out of range');
  }
  return size;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = 'name' in error ? error.name : null;
  if (name === 'NotFound' || name === 'NoSuchKey') {
    return true;
  }
  const metadata = '$metadata' in error ? error.$metadata : null;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    'httpStatusCode' in metadata &&
    metadata.httpStatusCode === 404
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array | string> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

/** HeadObject; null when the object does not exist (404, NotFound, NoSuchKey). Other errors throw. */
export async function headObject(
  bucket: Bucket,
  key: string,
  signal?: AbortSignal,
): Promise<ObjectHead | null> {
  try {
    const head = await bucket.client.send(
      new HeadObjectCommand({ Bucket: bucket.bucket, Key: key }),
      { abortSignal: callSignal(signal) },
    );
    return { size: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * GetObject into memory; throws ObjectTooLargeError when the body passes `maxBytes`, before
 * reading it when the store states its length and as soon as the bytes read pass it otherwise. A
 * missing object rejects with the SDK's NoSuchKey error.
 */
export async function getObjectBytes(
  bucket: Bucket,
  key: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const object = await bucket.client.send(
    new GetObjectCommand({ Bucket: bucket.bucket, Key: key }),
    { abortSignal: callSignal(signal) },
  );
  const body: unknown = object.Body;
  if (object.ContentLength !== undefined && object.ContentLength > maxBytes) {
    // Not read: close the connection now rather than at the timeout.
    if (body instanceof Readable) {
      body.destroy();
    }
    throw new ObjectTooLargeError();
  }
  if (body === undefined || body === null) {
    return new Uint8Array(0);
  }
  if (!isAsyncIterable(body)) {
    throw new TypeError('The object body is not a stream.');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Leaving the loop early closes the stream.
  for await (const chunk of body) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    total += bytes.byteLength;
    if (total > maxBytes) {
      throw new ObjectTooLargeError();
    }
    chunks.push(bytes);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** PutObject with the given type and optional cache, disposition and length headers. */
export async function putObject(
  bucket: Bucket,
  key: string,
  body: Uint8Array | NodeJS.ReadableStream,
  options: {
    contentType: string;
    cacheControl?: string;
    contentDisposition?: string;
    contentLength?: number;
  },
  signal?: AbortSignal,
): Promise<void> {
  const input: PutObjectCommandInput = {
    Bucket: bucket.bucket,
    Key: key,
    // The SDK takes a Readable; any other stream is wrapped in one.
    Body: body instanceof Uint8Array || body instanceof Readable ? body : new Readable().wrap(body),
    ContentType: options.contentType,
  };
  if (options.cacheControl !== undefined) {
    input.CacheControl = options.cacheControl;
  }
  if (options.contentDisposition !== undefined) {
    input.ContentDisposition = options.contentDisposition;
  }
  if (options.contentLength !== undefined) {
    input.ContentLength = options.contentLength;
  }
  await bucket.client.send(new PutObjectCommand(input), { abortSignal: callSignal(signal) });
}

/** Lists every key under prefix, page by page (ListObjectsV2 with the continuation token). */
export function listKeys(
  bucket: Bucket,
  prefix: string,
  signal?: AbortSignal,
): AsyncIterable<{ key: string; size: number; lastModified: Date }> {
  return listAllObjects(bucket, prefix, signal === undefined ? {} : { signal });
}

/**
 * DeleteObjects in batches of at most `batchSize` (default DELETE_BATCH_MAX) keys, calling
 * `afterBatch` after each; throws BucketDeleteError when a response lists any error, and the
 * signal's reason when it aborts between batches. Returns the number of keys sent.
 */
export async function deleteKeys(
  bucket: Bucket,
  keys: readonly string[],
  options: DeleteOptions = {},
): Promise<number> {
  const batchSize = checkedBatchSize(options.batchSize);
  let sent = 0;
  for (let start = 0; start < keys.length; start += batchSize) {
    options.signal?.throwIfAborted();
    const batch = keys.slice(start, start + batchSize);
    const result = await bucket.client.send(
      new DeleteObjectsCommand({
        Bucket: bucket.bucket,
        Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: true },
      }),
      { abortSignal: callSignal(options.signal) },
    );
    const failed = result.Errors?.length ?? 0;
    if (failed > 0) {
      throw new BucketDeleteError(failed);
    }
    sent += batch.length;
    if (options.afterBatch !== undefined) {
      await options.afterBatch();
    }
  }
  return sent;
}

/**
 * Lists the prefix and deletes every key under it with deleteKeys, one listed batch at a time.
 * Refuses an empty prefix or one not ending in '/' with RangeError before any call, so a bug can
 * never empty a bucket. Returns the number of keys sent.
 */
export async function deletePrefix(
  bucket: Bucket,
  prefix: string,
  options: DeleteOptions = {},
): Promise<number> {
  if (prefix === '' || !prefix.endsWith('/')) {
    throw new RangeError('unsafe prefix');
  }
  const batchSize = checkedBatchSize(options.batchSize);
  let deleted = 0;
  let pending: string[] = [];
  const flush = async (): Promise<void> => {
    deleted += await deleteKeys(bucket, pending, options);
    pending = [];
  };
  for await (const item of listKeys(bucket, prefix, options.signal)) {
    pending.push(item.key);
    if (pending.length >= batchSize) {
      await flush();
    }
  }
  if (pending.length > 0) {
    await flush();
  }
  return deleted;
}
