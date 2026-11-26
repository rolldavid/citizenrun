import type { Logger } from '@citizenrun/shared';
import { z } from 'zod';
import { bucketKeyParts, bucketKeys } from './bucket.ts';
import type { DataBucket, ObjectInfo } from './bucket.ts';
import { readNdjsonGz } from './ndjson.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Raw snapshots and unreferenced cache objects are kept 400 days (D-327). */
const KEEP_DAYS = 400;
const KEEP_EDITIONS = 2;
const AI_BATCH_DAYS = 60;
const AI_LEDGER_MONTHS = 24;

export type HousekeepingReport = {
  readonly dryRun: boolean;
  readonly rawFilings: number;
  readonly cache: number;
  readonly datasets: number;
  readonly aiBatches: number;
  readonly aiLedger: number;
};

/** A delete that would reach a prefix housekeeping never touches. */
export class HousekeepingGuardError extends Error {
  override readonly name = 'HousekeepingGuardError';

  constructor() {
    super('housekeeping refused to delete under bundles/, assets/, reports/ or field-reports/');
  }
}

// The worker's retention owns bundles and field-report exports, assets are never deleted and no
// job prunes reports/ (PIPE-housekeeping, D-142, D-497).
const PROTECTED_PREFIXES: readonly string[] = [
  bucketKeys.bundlesPrefix(),
  bucketKeys.assetsPrefix(),
  bucketKeys.reportsPrefix(),
  bucketKeys.fieldReportsPrefix(),
];

const PageIndexRowSchema = z.looseObject({
  raw_sha256: z.string().nullable().optional(),
  text_sha256: z.string().nullable().optional(),
});

async function listAll(bucket: DataBucket, prefix: string): Promise<ObjectInfo[]> {
  const all: ObjectInfo[] = [];
  for await (const info of bucket.list(prefix)) {
    all.push(info);
  }
  return all;
}

function utcDay(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** The `yyyy-mm` of the month `months` before the UTC month of `now`. */
function monthBefore(now: Date, months: number): string {
  const index = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

// The open marker of a batch, when its id is one a key builder accepts.
function openKeyOf(id: string): string[] {
  try {
    return [bucketKeys.aiBatchOpen(id)];
  } catch {
    return [];
  }
}

async function referencedHashes(bucket: DataBucket): Promise<ReadonlySet<string>> {
  const referenced = new Set<string>();
  for (const info of await listAll(bucket, bucketKeys.pagesPrefix())) {
    if (!info.key.endsWith('.ndjson.gz')) {
      continue;
    }
    const found = await bucket.getStream(info.key);
    if (found === null) {
      continue;
    }
    for await (const row of readNdjsonGz(found.body, PageIndexRowSchema)) {
      if (typeof row.raw_sha256 === 'string') referenced.add(row.raw_sha256);
      if (typeof row.text_sha256 === 'string') referenced.add(row.text_sha256);
    }
  }
  return referenced;
}

/**
 * Deletes what has outlived its retention (PIPE-housekeeping): `raw/filings/` objects whose key
 * date is more than 400 days before today (the key's date, never LastModified, since the home
 * copy rewrites LastModified); `cache/raw/` and `cache/text/` objects older than 400 days that no
 * page index references; dataset editions beyond the two greatest; AI batches whose manifest is
 * more than 60 days old; AI ledger months before the month 24 months back. Never a key under
 * `bundles/`, `assets/`, `reports/` or `field-reports/`. A dry-run bucket deletes nothing.
 */
export async function housekeeping(
  bucket: DataBucket,
  now: Date,
  log: Logger,
): Promise<HousekeepingReport> {
  const today = utcDay(now.toISOString().slice(0, 10));

  const rawFilings = (await listAll(bucket, bucketKeys.rawFilingsPrefix()))
    .filter((info) => {
      const parts = bucketKeyParts.rawFilings(info.key);
      return parts !== null && (today - utcDay(parts.date)) / DAY_MS > KEEP_DAYS;
    })
    .map((info) => info.key);

  const cacheObjects = [
    ...(await listAll(bucket, bucketKeys.rawCachePrefix())),
    ...(await listAll(bucket, bucketKeys.textCachePrefix())),
  ];
  const oldCache = cacheObjects.filter(
    (info) => now.getTime() - info.lastModified.getTime() > KEEP_DAYS * DAY_MS,
  );
  const referenced = oldCache.length > 0 ? await referencedHashes(bucket) : new Set<string>();
  const cache = oldCache
    .filter((info) => {
      const hash = bucketKeyParts.cacheHash(info.key);
      return hash !== null && !referenced.has(hash);
    })
    .map((info) => info.key);

  const editions = new Map<string, Map<string, string[]>>();
  for (const info of await listAll(bucket, bucketKeys.datasetsRoot())) {
    const parts = bucketKeyParts.dataset(info.key);
    if (parts === null) {
      continue;
    }
    const byEdition = editions.get(parts.id) ?? new Map<string, string[]>();
    editions.set(parts.id, byEdition);
    const keys = byEdition.get(parts.edition) ?? [];
    byEdition.set(parts.edition, keys);
    keys.push(info.key);
  }
  const datasets: string[] = [];
  for (const byEdition of editions.values()) {
    const names = [...byEdition.keys()].sort(byteOrder);
    for (const edition of names.slice(0, Math.max(0, names.length - KEEP_EDITIONS))) {
      datasets.push(...(byEdition.get(edition) ?? []));
    }
  }

  const batchObjects = await listAll(bucket, bucketKeys.aiBatchesPrefix());
  const oldBatches = new Set(
    batchObjects
      .filter((info) => {
        const id = bucketKeyParts.aiBatchManifest(info.key);
        return id !== null && now.getTime() - info.lastModified.getTime() > AI_BATCH_DAYS * DAY_MS;
      })
      .map((info) => bucketKeyParts.aiBatchManifest(info.key) ?? ''),
  );
  const batchPrefixes = [...oldBatches].map((id) => `${bucketKeys.aiBatchesPrefix()}${id}/`);
  const openKeys = new Set([...oldBatches].flatMap((id) => openKeyOf(id)));
  const aiBatches = batchObjects
    .filter(
      (info) =>
        openKeys.has(info.key) || batchPrefixes.some((prefix) => info.key.startsWith(prefix)),
    )
    .map((info) => info.key);

  const cutoffMonth = monthBefore(now, AI_LEDGER_MONTHS);
  const aiLedger = (await listAll(bucket, bucketKeys.aiLedgerPrefix()))
    .filter((info) => {
      const month = bucketKeyParts.aiLedgerMonth(info.key);
      return month !== null && month < cutoffMonth;
    })
    .map((info) => info.key);

  const doomed = [...rawFilings, ...cache, ...datasets, ...aiBatches, ...aiLedger];
  if (doomed.some((key) => PROTECTED_PREFIXES.some((prefix) => key.startsWith(prefix)))) {
    throw new HousekeepingGuardError();
  }
  await bucket.delete(doomed);

  const report: HousekeepingReport = {
    dryRun: bucket.dryRun,
    rawFilings: rawFilings.length,
    cache: cache.length,
    datasets: datasets.length,
    aiBatches: aiBatches.length,
    aiLedger: aiLedger.length,
  };
  log.info('housekeeping.done', { ...report });
  return report;
}
