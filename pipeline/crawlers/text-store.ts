// PIPE-text-extract step 3: the extracted text, stored by its hash under `cache/text/` (D-285, D-286).
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { bucketKeys } from '../lib/bucket.ts';
import type { DataBucket } from '../lib/bucket.ts';

/** Lower-case hex SHA-256 of the text's UTF-8 bytes. */
export function textSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Writes `cache/text/<sha>.txt.gz` unless it exists, and returns the text's hash. */
export async function storeText(bucket: DataBucket, text: string): Promise<string> {
  const sha = textSha256(text);
  const key = bucketKeys.textCache(sha);
  if ((await bucket.head(key)) === null) {
    await bucket.putBytes(
      key,
      new Uint8Array(gzipSync(Buffer.from(text, 'utf8'))),
      'application/gzip',
    );
  }
  return sha;
}
