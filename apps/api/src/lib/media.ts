import type { S3Client } from '@aws-sdk/client-s3';
import type { Media } from '@citizenrun/shared';
import { mediaUrl } from '@citizenrun/shared/storage';

/** The bucket a mapper signs with: the media bucket's client and name, from `deps.storage.media`. */
export type MediaBucket = { client: S3Client; bucket: string };

// Avatars are centre-cropped to 320 by 320 (Media).
const AVATAR_SIZE = 320;

/** users.avatar_key, never avatar_pending_key, in the avatar form of Media; null for a null key. */
export async function toAvatarMedia(
  avatarKey: string | null,
  media: MediaBucket,
  now: Date,
): Promise<Media | null> {
  if (avatarKey === null) {
    return null;
  }
  return {
    kind: 'image',
    key: avatarKey,
    url: await mediaUrl(media.client, media.bucket, avatarKey, now),
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    blurhash: null,
    thumb: null,
    poster: null,
    durationMs: null,
  };
}

/** people.photo_key with photo_width and photo_height; blurhash, thumb, poster and durationMs null; null for a null key. */
export async function toPersonPhoto(
  row: { photoKey: string | null; photoWidth: number | null; photoHeight: number | null },
  media: MediaBucket,
  now: Date,
): Promise<Media | null> {
  if (row.photoKey === null) {
    return null;
  }
  // Civic photos store no blurhash and no variants (PC-19).
  return {
    kind: 'image',
    key: row.photoKey,
    url: await mediaUrl(media.client, media.bucket, row.photoKey, now),
    width: row.photoWidth,
    height: row.photoHeight,
    blurhash: null,
    thumb: null,
    poster: null,
    durationMs: null,
  };
}
