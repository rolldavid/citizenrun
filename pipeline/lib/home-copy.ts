import { createHash } from 'node:crypto';
import { BundleManifestSchema, BundlePointerSchema } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { BucketJsonError, bucketKeyParts, bucketKeys, topLevelPrefix } from './bucket.ts';
import type { BucketConfig, DataBucket, ObjectInfo } from './bucket.ts';

/**
 * The source of the home copy: always the compose store's `data` bucket with the public
 * development key, path-style (D-589). A constant of the command, never a variable.
 */
export const HOME_COPY_SOURCE: BucketConfig = Object.freeze({
  bucket: 'data',
  endpoint: 'http://localhost:8333',
  region: 'us-east-1',
  accessKeyId: 'osdev',
  secretAccessKey: 'osdev-secret-key',
  forcePathStyle: true,
});

export type HomeCopyErrorCode =
  'home_copy.bad_target' | 'home_copy.target_differs' | 'home_copy.verify_failed';

/** A stopped home copy. `keys` lists the keys concerned, except those under `raw/`, which are only counted. */
export class HomeCopyError extends Error {
  override readonly name = 'HomeCopyError';
  readonly errorCode: HomeCopyErrorCode;
  readonly keys: readonly string[];
  readonly rawKeys: number;

  constructor(errorCode: HomeCopyErrorCode, keys: readonly string[] = []) {
    const listed = keys.filter((key) => !isRawKey(key));
    super(errorCode);
    this.errorCode = errorCode;
    this.keys = Object.freeze(listed);
    this.rawKeys = keys.length - listed.length;
  }
}

export type PrefixCount = { objects: number; bytes: number };

export type HomeCopyReport = {
  readonly dryRun: boolean;
  /** Objects and bytes copied (or, in a dry run, to be copied) per top-level prefix. */
  readonly copied: Readonly<Record<string, PrefixCount>>;
  readonly skippedPresent: number;
  readonly neverCopied: number;
};

const POINTER_KINDS = ['full', 'filings', 'geometry'] as const;
const AI_LEDGER_WORKER = /^ai-ledger\/\d{4}-(0[1-9]|1[0-2])\/worker\.json$/;
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', 'seaweedfs']);

// `raw/` holds personal data (D-084): its keys are counted, never listed.
const RAW_PREFIX = topLevelPrefix(bucketKeys.rawFilingsPrefix());

function isRawKey(key: string): boolean {
  return topLevelPrefix(key) === RAW_PREFIX;
}

/**
 * The files a local worker wrote and local data that is never registered on staging: they stay
 * in the local home (PIPE-home-copy "Never copied").
 */
export function isNeverCopied(key: string): boolean {
  return (
    key === bucketKeys.loaderInfo() ||
    key.startsWith(bucketKeys.fieldReportsPrefix()) ||
    AI_LEDGER_WORKER.test(key) ||
    key === bucketKeys.fieldReportsProcessed() ||
    key.startsWith(bucketKeys.mlPrefix()) ||
    key.startsWith(bucketKeys.modelsPrefix())
  );
}

/** Refuses a target on the local machine, and a target that is the source itself. */
export function assertRemoteTarget(source: BucketConfig, target: BucketConfig): void {
  let hostname: string;
  try {
    hostname = new URL(target.endpoint).hostname.toLowerCase();
  } catch {
    throw new HomeCopyError('home_copy.bad_target');
  }
  if (LOCAL_HOSTS.has(hostname)) {
    throw new HomeCopyError('home_copy.bad_target');
  }
  if (target.endpoint === source.endpoint && target.bucket === source.bucket) {
    throw new HomeCopyError('home_copy.bad_target');
  }
}

async function listAll(bucket: DataBucket): Promise<ObjectInfo[]> {
  const all: ObjectInfo[] = [];
  for await (const info of bucket.list('')) {
    all.push(info);
  }
  return all;
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function addCount(counts: Record<string, PrefixCount>, key: string, bytes: number): void {
  const prefix = topLevelPrefix(key);
  const current = counts[prefix] ?? { objects: 0, bytes: 0 };
  counts[prefix] = { objects: current.objects + 1, bytes: current.bytes + bytes };
}

async function sha256Of(bucket: DataBucket, key: string): Promise<string | null> {
  const found = await bucket.getStream(key);
  if (found === null) {
    return null;
  }
  const hash = createHash('sha256');
  for await (const chunk of found.body as AsyncIterable<Buffer>) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function verify(
  target: DataBucket,
  copied: readonly ObjectInfo[],
): Promise<readonly string[]> {
  const failed: string[] = [];
  const sizes = new Map<string, number>();
  for (const info of await listAll(target)) {
    sizes.set(info.key, info.size);
  }
  const pointerKeys = new Set(POINTER_KINDS.map((kind) => bucketKeys.pointer(kind)));
  for (const info of copied) {
    if (sizes.get(info.key) !== info.size) {
      failed.push(info.key);
      continue;
    }
    const version = bucketKeyParts.bundleManifest(info.key);
    if (version !== null) {
      try {
        const manifest = await target.getJson(info.key, BundleManifestSchema);
        if (manifest === null) {
          failed.push(info.key);
          continue;
        }
        for (const file of manifest.files) {
          const fileKey = bucketKeys.bundleFile(version, file.path);
          if ((await sha256Of(target, fileKey)) !== file.sha256) {
            failed.push(fileKey);
          }
        }
      } catch (error) {
        if (!(error instanceof BucketJsonError)) {
          throw error;
        }
        failed.push(info.key);
      }
    }
    if (pointerKeys.has(info.key)) {
      try {
        if ((await target.getJson(info.key, BundlePointerSchema)) === null) {
          failed.push(info.key);
        }
      } catch (error) {
        if (!(error instanceof BucketJsonError)) {
          throw error;
        }
        failed.push(info.key);
      }
    }
  }
  return failed;
}

/**
 * Copies the local home to staging's bucket (PIPE-home-copy): (1) lists both; (2) stops before any
 * write when a key to be copied is in the target at another length; (3) copies every object the
 * target lacks, everything outside `bundles/index/` first in byte order of key, then the pointers;
 * (4) verifies lengths, the hashes of every copied manifest's files and every copied pointer.
 * A dry run runs steps 1 and 2 and reports the counts of step 3. Logs keys only for a failure, and
 * never a key under `raw/`.
 */
export async function homeCopy(
  source: DataBucket,
  target: DataBucket,
  opts: { dryRun: boolean; log: Logger },
): Promise<HomeCopyReport> {
  const sourceObjects = await listAll(source);
  const targetSizes = new Map<string, number>();
  for (const info of await listAll(target)) {
    targetSizes.set(info.key, info.size);
  }

  let neverCopied = 0;
  const candidates: ObjectInfo[] = [];
  for (const info of sourceObjects) {
    if (isNeverCopied(info.key)) {
      neverCopied += 1;
    } else {
      candidates.push(info);
    }
  }

  const differs = candidates
    .filter((info) => {
      const size = targetSizes.get(info.key);
      return size !== undefined && size !== info.size;
    })
    .map((info) => info.key);
  if (differs.length > 0) {
    const error = new HomeCopyError('home_copy.target_differs', differs);
    opts.log.error('home_copy.target_differs', {
      keys: error.keys,
      rawKeys: error.rawKeys,
    });
    throw error;
  }

  const missing = candidates.filter((info) => !targetSizes.has(info.key));
  const skippedPresent = candidates.length - missing.length;
  const indexPrefix = bucketKeys.bundlesIndexPrefix();
  const ordered = [
    ...missing
      .filter((info) => !info.key.startsWith(indexPrefix))
      .sort((a, b) => byteOrder(a.key, b.key)),
    ...missing
      .filter((info) => info.key.startsWith(indexPrefix))
      .sort((a, b) => byteOrder(a.key, b.key)),
  ];

  const copied: Record<string, PrefixCount> = {};
  for (const info of ordered) {
    addCount(copied, info.key, info.size);
  }
  if (opts.dryRun) {
    const report: HomeCopyReport = { dryRun: true, copied, skippedPresent, neverCopied };
    opts.log.info('home_copy.done', { ...report });
    return report;
  }

  for (const info of ordered) {
    await target.copyFrom(source, info.key);
  }

  const failed = await verify(target, ordered);
  if (failed.length > 0) {
    const error = new HomeCopyError('home_copy.verify_failed', failed);
    opts.log.error('home_copy.verify_failed', { keys: error.keys, rawKeys: error.rawKeys });
    throw error;
  }

  const report: HomeCopyReport = { dryRun: false, copied, skippedPresent, neverCopied };
  opts.log.info('home_copy.done', { ...report });
  return report;
}
