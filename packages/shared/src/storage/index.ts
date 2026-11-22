import type { S3Client } from '@aws-sdk/client-s3';

export { createS3Client } from './client.ts';
export type { S3BucketConfig } from './client.ts';
export { ensureBucket } from './ensure-bucket.ts';

/** A client and the bucket it serves, as a service's dependencies hold them. */
export type BucketHandle = { client: S3Client; bucket: string };
