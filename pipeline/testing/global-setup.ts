import { randomBytes } from 'node:crypto';
import { DeleteBucketCommand, ListBucketsCommand } from '@aws-sdk/client-s3';
import { createS3Client } from '@citizenrun/shared/storage';
import type { TestProject } from 'vitest/node';
import { emptyBucket, storageSettings } from './settings.ts';

let runId: string | null = null;

/**
 * Global setup of the pipeline's storage-only harness: refuses any store but the local one,
 * chooses the run id `R` and provides it to the workers. It creates no database.
 */
export function setup(project: TestProject): void {
  storageSettings();
  runId = randomBytes(3).toString('hex');
  project.provide('pipelineStorage', { runId });
}

/** Deletes every bucket of this run, `t-<R>-*`. */
export async function teardown(): Promise<void> {
  if (runId === null) {
    return;
  }
  const prefix = `t-${runId}-`;
  runId = null;
  const client = createS3Client(storageSettings());
  try {
    const listed = await client.send(new ListBucketsCommand({}));
    for (const bucket of listed.Buckets ?? []) {
      if (bucket.Name?.startsWith(prefix) === true) {
        await emptyBucket(client, bucket.Name);
        await client.send(new DeleteBucketCommand({ Bucket: bucket.Name }));
      }
    }
  } finally {
    client.destroy();
  }
}
