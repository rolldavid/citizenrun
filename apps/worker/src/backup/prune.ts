import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';

export const DUMP_KEY_PATTERN = /^pg\/\d{4}\/\d{2}\/(\d{8}T\d{6}Z)\.(dump\.enc|json)$/;
export const REPLAY_KEY_PATTERN = /^replay\/[a-z]+\/(\d{4}-\d{2}-\d{2})\/[^/]+\.json$/;

const DAY_MS = 24 * 60 * 60 * 1000;

async function listKeys(s3: S3Client, bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ...(token === undefined ? {} : { ContinuationToken: token }),
      }),
    );
    for (const item of page.Contents ?? []) {
      if (item.Key !== undefined) {
        keys.push(item.Key);
      }
    }
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  return keys;
}

// The keys under pg/ that follow the dump layout, grouped by stamp. Any other key is left out.
async function dumpStamps(s3: S3Client, bucket: string): Promise<Map<string, string[]>> {
  const stamps = new Map<string, string[]>();
  for (const key of await listKeys(s3, bucket, 'pg/')) {
    const stamp = DUMP_KEY_PATTERN.exec(key)?.[1];
    if (stamp !== undefined) {
      const keys = stamps.get(stamp) ?? [];
      keys.push(key);
      stamps.set(stamp, keys);
    }
  }
  return stamps;
}

/**
 * Keeps the newest `keep` dump stamps under `pg/` and deletes every object of the older ones, one
 * DeleteObject per key; returns the deleted stamps, oldest first. A key that does not follow the
 * dump layout is never deleted. `keep` below 1 throws before any call (D-028).
 */
export async function pruneDumps(s3: S3Client, bucket: string, keep: number): Promise<string[]> {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new RangeError('keep must be at least 1');
  }
  const stamps = await dumpStamps(s3, bucket);
  // The fixed-width stamp sorts as text.
  const newestFirst = [...stamps.keys()].sort().reverse();
  const deleted: string[] = [];
  for (const stamp of newestFirst.slice(keep)) {
    for (const key of stamps.get(stamp) ?? []) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    }
    deleted.push(stamp);
  }
  return deleted.sort();
}

/** The number of distinct dump stamps under `pg/`. */
export async function countDumpStamps(s3: S3Client, bucket: string): Promise<number> {
  return (await dumpStamps(s3, bucket)).size;
}

/**
 * Deletes each `replay/` entry dated more than `keepDays` days before the UTC date of `now`
 * (OPS-replay-log); an entry exactly `keepDays` old is kept, and a key that does not follow the
 * replay layout is never deleted. Returns the number deleted.
 */
export async function pruneReplay(
  s3: S3Client,
  bucket: string,
  now: Date,
  keepDays: number,
): Promise<number> {
  if (!Number.isInteger(keepDays) || keepDays < 0) {
    throw new RangeError('keepDays must be a non-negative integer');
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cutoff = new Date(today - keepDays * DAY_MS).toISOString().slice(0, 10);
  let deleted = 0;
  for (const key of await listKeys(s3, bucket, 'replay/')) {
    const date = REPLAY_KEY_PATTERN.exec(key)?.[1];
    if (date !== undefined && date < cutoff) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deleted += 1;
    }
  }
  return deleted;
}
