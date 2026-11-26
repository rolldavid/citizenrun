import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EXPORT_LINK_TTL_S } from '@citizenrun/shared';
import { createS3Client } from '@citizenrun/shared/storage';
import type { BucketHandle } from '@citizenrun/shared/storage';
import type { ApiEnv } from '../env.ts';

/** The `media` bucket and its client (D-248). Opens no connection itself. */
export function createMediaBucket(env: ApiEnv): BucketHandle {
  return {
    client: createS3Client({
      endpoint: env.MEDIA_ENDPOINT,
      region: env.MEDIA_REGION,
      accessKeyId: env.MEDIA_ACCESS_KEY_ID,
      secretAccessKey: env.MEDIA_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    }),
    bucket: env.MEDIA_BUCKET,
  };
}

/**
 * A presigned GET valid EXPORT_LINK_TTL_S (300) seconds for one export file, downloaded as
 * export-<YYYY-MM-DD of readyAt>.json. Never mediaUrl: this link is short and unique.
 */
export async function exportDownloadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  readyAt: Date,
  now: Date,
): Promise<string> {
  // The UTC calendar date of readyAt.
  const date = readyAt.toISOString().slice(0, 10);
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: 'application/json',
      ResponseContentDisposition: `attachment; filename="export-${date}.json"`,
    }),
    // Signed at `now`, never the machine clock, so the 300 seconds count from the request.
    { expiresIn: EXPORT_LINK_TTL_S, signingDate: now },
  );
}
