import type { S3Client } from '@aws-sdk/client-s3';
import { createLogger } from '@citizenrun/shared';
import { createS3Client, ensureBucket } from '@citizenrun/shared/storage';
import { inject } from 'vitest';
import { createDataBucket } from '../lib/bucket.ts';
import type { BucketConfig, DataBucket } from '../lib/bucket.ts';
import { emptyBucket, storageSettings } from './settings.ts';

// The per-file setup of the pipeline's storage-only harness. Every value here is per test file:
// Vitest gives each file its own module graph.

export type TestBucketName = 'data' | 'target';

const NAMES: readonly TestBucketName[] = ['data', 'target'];

let client: S3Client | null = null;
const buckets = new Map<TestBucketName, { bucket: DataBucket; config: BucketConfig }>();
// Kept in the worker process's environment, so the files that share a slot never repeat a number.
const RUN_COUNT = 'VITEST_PIPELINE_RUN_COUNT';

function harnessRunId(): string {
  const provided: unknown = inject('pipelineStorage');
  if (
    typeof provided !== 'object' ||
    provided === null ||
    !('runId' in provided) ||
    typeof provided.runId !== 'string'
  ) {
    throw new Error('The pipeline storage harness is not set up for this test project.');
  }
  return provided.runId;
}

function workerSlot(): string {
  const slot = process.env.VITEST_POOL_ID;
  if (slot === undefined || !/^[0-9]+$/.test(slot)) {
    throw new Error('VITEST_POOL_ID is not set to a slot number.');
  }
  return slot;
}

function s3(): S3Client {
  client ??= createS3Client(storageSettings());
  return client;
}

/** This worker's bucket `t-<R>-<slot>-<name>`, created on first use, with a quiet logger. */
export async function getTestBucket(
  name: TestBucketName,
): Promise<{ bucket: DataBucket; config: BucketConfig }> {
  const known = buckets.get(name);
  if (known !== undefined) {
    return known;
  }
  const settings = storageSettings();
  const config: BucketConfig = {
    bucket: `t-${harnessRunId()}-${workerSlot()}-${name}`,
    endpoint: settings.endpoint,
    region: settings.region,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    forcePathStyle: true,
  };
  await ensureBucket(s3(), config.bucket);
  const bucket = createDataBucket(config, {
    dryRun: false,
    log: createLogger({ service: 'pipeline', level: 'error', sink: () => undefined }),
  });
  const handle = { bucket, config };
  buckets.set(name, handle);
  return handle;
}

/** Empties this worker's buckets, including one an earlier file on the worker wrote into. */
export async function resetStorage(): Promise<void> {
  for (const name of NAMES) {
    const { config } = await getTestBucket(name);
    await emptyBucket(s3(), config.bucket);
  }
}

/**
 * `t-<R>-<slot>-<n>`, n counting up from 1 within the slot: the run id a test passes to code
 * that names a scratch database, so two files or two runs never share one.
 */
export function testRunId(): string {
  const next = Number(process.env[RUN_COUNT] ?? '0') + 1;
  process.env[RUN_COUNT] = String(next);
  return `t-${harnessRunId()}-${workerSlot()}-${String(next)}`;
}
