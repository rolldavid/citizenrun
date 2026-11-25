import type { S3Client } from '@aws-sdk/client-s3';

export { createS3Client } from './client.ts';
export type { S3BucketConfig } from './client.ts';
export { ensureBucket } from './ensure-bucket.ts';
export { MEDIA_URL_EXPIRES_S, MEDIA_URL_WINDOW_MS, mediaUrl } from './media-url.ts';
export {
  avatarKeys,
  avatarUploadPrefix,
  avatarUserPrefix,
  exportKey,
  exportUserPrefix,
  incomingUploadKey,
  incomingUserPrefix,
  uploadIdOfAvatarKey,
} from './object-keys.ts';

/** A client and the bucket it serves, as a service's dependencies hold them. */
export type BucketHandle = { client: S3Client; bucket: string };
