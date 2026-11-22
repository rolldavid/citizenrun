import { S3Client } from '@aws-sdk/client-s3';

export type S3BucketConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/**
 * An S3 client for one bucket endpoint (D-248): virtual-hosted style unless `forcePathStyle` (the
 * local store), and checksums only when an operation requires them, so presigned URLs stay plain.
 */
export function createS3Client(config: S3BucketConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: config.forcePathStyle,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
