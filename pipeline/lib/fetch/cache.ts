import { createHash } from 'node:crypto';
import { bucketKeys } from '../bucket.ts';
import type { DataBucket } from '../bucket.ts';

const EXTENSIONS: Readonly<Record<string, string>> = {
  'text/html': 'html',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'text/plain': 'txt',
};

/** The raw cache's file extension for a response's content type; parameters are ignored. */
export function extForContentType(contentType: string | null): string {
  if (contentType === null) {
    return 'bin';
  }
  const type = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return EXTENSIONS[type] ?? 'bin';
}

/**
 * Stores a body at `cache/raw/<sha256>.<ext>` unless it is already there (D-331).
 * `cached` is true when it was.
 */
export async function storeRawBody(
  bucket: DataBucket,
  body: Uint8Array,
  contentType: string | null,
): Promise<{ key: string; sha256: string; cached: boolean }> {
  const sha256 = createHash('sha256').update(body).digest('hex');
  const key = bucketKeys.rawCache(sha256, extForContentType(contentType));
  if ((await bucket.head(key)) !== null) {
    return { key, sha256, cached: true };
  }
  await bucket.putBytes(key, body, contentType ?? 'application/octet-stream');
  return { key, sha256, cached: false };
}
