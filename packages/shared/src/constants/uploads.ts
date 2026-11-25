// The upload constants (L-upload-policy). Sizes are binary megabytes.

const MIB = 1024 * 1024;

/** Seconds a signed upload policy stays valid (L-upload-policy, D-248). */
export const UPLOAD_POLICY_TTL_S = 300;

/** Largest photo upload in bytes, on every platform: 8 MiB (L-upload-policy). */
export const PHOTO_MAX_BYTES = 8 * MIB;

/** Largest video upload in bytes from the phone apps: 60 MiB (L-upload-policy). */
export const VIDEO_MAX_BYTES_PHONE = 60 * MIB;

/** Largest video upload in bytes from the web: 250 MiB (L-upload-policy). */
export const VIDEO_MAX_BYTES_WEB = 250 * MIB;

/** The content types a photo upload may declare (L-upload-policy, D-248). */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** The content types a video upload may declare (L-upload-policy, D-248). */
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

export type UploadContentType =
  (typeof PHOTO_CONTENT_TYPES)[number] | (typeof VIDEO_CONTENT_TYPES)[number];

/** The file extension of an upload's object key for each allowed content type (L-object-keys). */
export const UPLOAD_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
} as const satisfies Record<UploadContentType, string>;

/** Avatar upload tickets one user may take in a rolling 24 hours (L-upload-policy). */
export const AVATAR_UPLOADS_PER_DAY = 20;
