import { readFileSync } from 'node:fs';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import type { CORSRule, S3Client } from '@aws-sdk/client-s3';
import { createS3Client, ensureBucket } from '@citizenrun/shared/storage';
import type { BucketHandle } from '@citizenrun/shared/storage';
import { z } from 'zod';
import { bucketName } from './names.ts';
import type { BucketKind } from './names.ts';
import { emptyBucket, harnessSettings } from './settings.ts';
import { harnessContext, workerSlot } from './worker.ts';

const CORS_FILE = new URL('../../../../docker/seaweedfs/cors.json', import.meta.url);

const CorsFileSchema = z.object({
  CORSRules: z
    .array(
      z.object({
        AllowedOrigins: z.array(z.string().max(200)).max(20),
        AllowedMethods: z.array(z.string().max(10)).max(10),
        AllowedHeaders: z.array(z.string().max(200)).max(20),
        ExposeHeaders: z.array(z.string().max(200)).max(20),
        MaxAgeSeconds: z.number().int().min(0).max(86_400),
      }),
    )
    .max(10),
});

// Per test file: Vitest gives every file its own module graph.
let client: S3Client | null = null;
const buckets = new Map<BucketKind, BucketHandle>();

/** The CORS rules of the local store's media bucket, from `docker/seaweedfs/cors.json`. */
export function localCorsRules(): CORSRule[] {
  return CorsFileSchema.parse(JSON.parse(readFileSync(CORS_FILE, 'utf8'))).CORSRules;
}

function s3(): S3Client {
  client ??= createS3Client(harnessSettings().s3);
  return client;
}

/** This worker's bucket of `kind`, `t-<runId>-<slot>-<kind>`, created with the local CORS rules on first use. */
export async function getTestBucket(kind: BucketKind): Promise<BucketHandle> {
  const known = buckets.get(kind);
  if (known !== undefined) {
    return known;
  }
  const handle: BucketHandle = {
    client: s3(),
    bucket: bucketName(harnessContext().runId, workerSlot(), kind),
  };
  await ensureBucket(handle.client, handle.bucket, { cors: { CORSRules: localCorsRules() } });
  buckets.set(kind, handle);
  return handle;
}

/** Deletes every object in the buckets this file has used. */
export async function resetStorage(): Promise<void> {
  for (const handle of buckets.values()) {
    await emptyBucket(handle.client, handle.bucket);
  }
}

/** Writes `bytes` under `key` in this worker's bucket of `kind`. */
export async function putTestObject(
  kind: BucketKind,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { client: s3Client, bucket } = await getTestBucket(kind);
  await s3Client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }),
  );
}

function isMissingKey(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
    return true;
  }
  const metadata: unknown = '$metadata' in error ? error.$metadata : null;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    'httpStatusCode' in metadata &&
    metadata.httpStatusCode === 404
  );
}

/** The bytes under `key` in this worker's bucket of `kind`, or null when there is no such object. */
export async function getTestObject(kind: BucketKind, key: string): Promise<Uint8Array | null> {
  const { client: s3Client, bucket } = await getTestBucket(kind);
  try {
    const result = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (result.Body === undefined) {
      return new Uint8Array();
    }
    return await result.Body.transformToByteArray();
  } catch (error) {
    if (isMissingKey(error)) {
      return null;
    }
    throw error;
  }
}

/** Every key under `prefix` in this worker's bucket of `kind`, sorted. */
export async function listTestKeys(kind: BucketKind, prefix: string): Promise<string[]> {
  const { client: s3Client, bucket } = await getTestBucket(kind);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ...(token === undefined ? {} : { ContinuationToken: token }),
      }),
    );
    for (const item of page.Contents ?? []) {
      if (item.Key !== undefined) {
        keys.push(item.Key);
      }
    }
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  return keys.sort();
}

/** Releases this file's store client. */
export function closeStorage(): void {
  client?.destroy();
  client = null;
  buckets.clear();
}
