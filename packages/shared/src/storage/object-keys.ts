// L-object-keys: bucket keys derive from ids only, never from the time.
import { UPLOAD_EXTENSIONS } from '../constants/uploads.ts';
import type { UploadContentType } from '../constants/uploads.ts';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID}$`);
const AVATAR_KEY_PATTERN = new RegExp(`^avatars/${UUID}/(${UUID})/(?:320|1080)\\.jpg$`);
const EXTENSIONS: ReadonlyMap<string, string> = new Map(Object.entries(UPLOAD_EXTENSIONS));

function id(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new RangeError('An object key id must be a lower-case uuid');
  }
  return value;
}

function extensionOf(contentType: string): string {
  const extension = EXTENSIONS.get(contentType);
  if (extension === undefined) {
    throw new RangeError('The content type has no upload extension');
  }
  return extension;
}

/** incoming/<user id>/<upload id>.<ext> for a POST /v1/uploads ticket. */
export function incomingUploadKey(
  userId: string,
  uploadId: string,
  contentType: UploadContentType,
): string {
  return `${incomingUserPrefix(userId)}${id(uploadId)}.${extensionOf(contentType)}`;
}

/** incoming/<user id>/ */
export function incomingUserPrefix(userId: string): string {
  return `incoming/${id(userId)}/`;
}

/** avatars/<user id>/<upload id>/320.jpg and its 1080.jpg sibling. */
export function avatarKeys(userId: string, uploadId: string): { small: string; large: string } {
  const prefix = avatarUploadPrefix(userId, uploadId);
  return { small: `${prefix}320.jpg`, large: `${prefix}1080.jpg` };
}

/** avatars/<user id>/<upload id>/ */
export function avatarUploadPrefix(userId: string, uploadId: string): string {
  return `${avatarUserPrefix(userId)}${id(uploadId)}/`;
}

/** avatars/<user id>/ */
export function avatarUserPrefix(userId: string): string {
  return `avatars/${id(userId)}/`;
}

/** The upload id of an avatars/<user id>/<upload id>/320.jpg or 1080.jpg key; null for any other key. */
export function uploadIdOfAvatarKey(key: string): string | null {
  return AVATAR_KEY_PATTERN.exec(key)?.[1] ?? null;
}

/** exports/<user id>/<export id>.json */
export function exportKey(userId: string, exportId: string): string {
  return `${exportUserPrefix(userId)}${id(exportId)}.json`;
}

/** exports/<user id>/ */
export function exportUserPrefix(userId: string): string {
  return `exports/${id(userId)}/`;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function sha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new RangeError('A civic object key hash must be 64 lower-case hex characters');
  }
  return value;
}

/** civic/photos/<sha256>.jpg, a bundle photo (L-object-keys). */
export function civicPhotoKey(sha256Hex: string): string {
  return `civic/photos/${sha256(sha256Hex)}.jpg`;
}

/** civic/forms/<sha256>.pdf, a bundle form (L-object-keys). */
export function civicFormKey(sha256Hex: string): string {
  return `civic/forms/${sha256(sha256Hex)}.pdf`;
}
