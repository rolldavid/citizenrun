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
