// L-media-url: deterministic read URLs for the media bucket (D-249).
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** The signing window in milliseconds: 12 hours. */
export const MEDIA_URL_WINDOW_MS = 43_200_000; // D-249

/** How long a media URL is valid from its window's start, in seconds: 36 hours. */
export const MEDIA_URL_EXPIRES_S = 129_600; // D-249

/** Presigned GET for an object in the media bucket. Same key and same 12-hour window give the same bytes. */
export function mediaUrl(
  client: S3Client,
  bucket: string,
  key: string,
  now: Date,
): Promise<string> {
  // Signed at the window's start, never a future time, so the phones' image cache keeps working.
  const signingDate = new Date(
    Math.floor(now.getTime() / MEDIA_URL_WINDOW_MS) * MEDIA_URL_WINDOW_MS,
  );
  // No other command parameter: a response-header override would change the URL (D-249).
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: MEDIA_URL_EXPIRES_S,
    signingDate,
  });
}
