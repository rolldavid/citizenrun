import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { S3BucketConfig } from '@citizenrun/shared/storage';
import { PipelineEnvSchema } from '../env.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The storage harness's run id `R`: test buckets are named `t-<R>-<slot>-<name>`. */
    pipelineStorage: { runId: string };
    /** PIPELINE_SCRATCH_URL as the main process read it (D-869), or null for the default server. */
    pipelineScratch: { url: string | null };
  }
}

const DEFAULT_S3_ENDPOINT = 'http://localhost:8333';
const DEFAULT_S3_ACCESS_KEY_ID = 'osdev';
const DEFAULT_S3_SECRET_ACCESS_KEY = 'osdev-secret-key';
const S3_REGION = 'us-east-1';
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  'seaweedfs',
  'host.docker.internal',
]);

/** A test store the harness refuses: anything but the local one. */
export class StorageHarnessRefusedError extends Error {
  override readonly name = 'StorageHarnessRefusedError';
}

function setting(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** The test store from the TEST_S3_* settings, refused unless its host is a local one. */
export function storageSettings(): S3BucketConfig {
  const endpoint = setting('TEST_S3_ENDPOINT') ?? DEFAULT_S3_ENDPOINT;
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    throw new StorageHarnessRefusedError('TEST_S3_ENDPOINT does not parse.');
  }
  if (!ALLOWED_HOSTS.has(hostname)) {
    throw new StorageHarnessRefusedError(
      'The test store host must be localhost, 127.0.0.1, seaweedfs or host.docker.internal.',
    );
  }
  return {
    endpoint,
    region: S3_REGION,
    accessKeyId: setting('TEST_S3_ACCESS_KEY_ID') ?? DEFAULT_S3_ACCESS_KEY_ID,
    secretAccessKey: setting('TEST_S3_SECRET_ACCESS_KEY') ?? DEFAULT_S3_SECRET_ACCESS_KEY,
    forcePathStyle: true,
  };
}

/**
 * PIPELINE_SCRATCH_URL for the block-sum tests, or null for the pipeline's default server. Read in
 * the global setup: the workers' environment keeps only the allow-listed names (vitest.env.ts).
 */
export function scratchUrlSetting(): string | null {
  const value = setting('PIPELINE_SCRATCH_URL');
  if (value === undefined) {
    return null;
  }
  if (!PipelineEnvSchema.shape.PIPELINE_SCRATCH_URL.safeParse(value).success) {
    throw new Error('PIPELINE_SCRATCH_URL is not a postgres URL.');
  }
  return value;
}

/** Deletes every object in `bucket`. */
export async function emptyBucket(client: S3Client, bucket: string): Promise<void> {
  for (;;) {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    const keys = (page.Contents ?? []).flatMap((item) =>
      item.Key === undefined ? [] : [{ Key: item.Key }],
    );
    if (keys.length === 0) {
      return;
    }
    await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
    );
  }
}
