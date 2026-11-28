import { fileURLToPath } from 'node:url';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import type { Db } from '../../client.ts';
import { createMediaAssetWriter } from '../../bundle/assets.ts';
import type { MediaObjectStore } from '../../bundle/assets.ts';
import { insertLoadingBundle, loadBundle } from '../../bundle/load.ts';
import type { LoadResult } from '../../bundle/load.ts';
import { diskReader } from '../../bundle/reader.ts';
import { firstFailedGate } from '../../bundle/stats.ts';
import type { SeedContext, SeedStep } from '../index.ts';
import { SeedError } from '../step.ts';

// Seed step 020-sample-bundle: the committed two-state sample loaded through the loader that
// J-bundle.load runs, with approved: true. The loader opens its own
// transactions, so this step gets the runner's connection and no surrounding transaction.

/** The committed sample's full manifest (B-sample). */
export const SAMPLE_MANIFEST_PATH: string = fileURLToPath(
  new URL('../sample-bundle/full/manifest.json', import.meta.url),
);

/** The root manifest's path as the loader reads it: relative to the reader's folder. */
const ROOT_MANIFEST = 'manifest.json';

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
    return true;
  }
  const metadata: unknown = '$metadata' in error ? error.$metadata : null;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    'httpStatusCode' in metadata &&
    metadata.httpStatusCode === 404
  );
}

/** The seed's media bucket as the load core's MediaObjectStore: HeadObject, GetObject, PutObject. */
export function seedMediaStore(media: SeedContext['media']): MediaObjectStore {
  const { client, bucket } = media;
  return {
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (isMissing(error)) {
          return false;
        }
        throw error;
      }
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (result.Body === undefined) {
        throw new SeedError('A media object has no body.');
      }
      return result.Body.transformToByteArray();
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
  };
}

/**
 * Loads the sample whose full manifest is at `manifestPath`. A version already `loaded` returns
 * 'already_loaded' and writes nothing; a row in any other status is set back to `loading`; no
 * row gets one from insertLoadingBundle. A rejected load throws SeedError naming the first
 * failed gate.
 */
export async function loadSampleBundle(
  db: Db,
  ctx: SeedContext,
  manifestPath: string = SAMPLE_MANIFEST_PATH,
): Promise<LoadResult | 'already_loaded'> {
  const reader = diskReader(manifestPath);
  const manifest = await reader.readManifest(ROOT_MANIFEST);
  if (!manifest.version.startsWith('sample-')) {
    throw new SeedError('the sample manifest is not a sample-version');
  }
  const bundleId = await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ id: string; status: string }>(
      sql`select id, status from data_bundles where version = ${manifest.version} for update`,
      'objects',
    );
    if (row?.status === 'loaded') {
      return null;
    }
    if (row !== undefined) {
      await tx.execute(sql`update data_bundles set status = 'loading' where id = ${row.id}::uuid`);
      return row.id;
    }
    const inserted = await insertLoadingBundle(tx, { version: manifest.version, kind: 'full' });
    if (inserted === null) {
      throw new SeedError('the sample bundle row could not be inserted');
    }
    return inserted;
  });
  if (bundleId === null) {
    ctx.log.info('seed.sample', { version: manifest.version, status: 'already_loaded' });
    return 'already_loaded';
  }
  const result = await loadBundle(db, reader, ROOT_MANIFEST, {
    bundleId,
    approved: true,
    now: ctx.anchor,
    enqueue: ctx.enqueue,
    media: createMediaAssetWriter(seedMediaStore(ctx.media)),
  });
  const counts: Record<string, number> = {};
  for (const [table, count] of Object.entries(result.stats.counts)) {
    counts[table] = count.rows;
  }
  ctx.log.info('seed.sample', { version: manifest.version, status: result.status, counts });
  if (result.status === 'rejected') {
    const gate = firstFailedGate(result.stats)?.name ?? 'unknown';
    throw new SeedError(`sample bundle rejected at gate ${gate}`);
  }
  if (result.status !== 'loaded') {
    throw new SeedError(`sample bundle ended ${result.status}`);
  }
  return result;
}

export const step: SeedStep = {
  name: '020-sample-bundle',
  ownTransactions: true,
  run: (db, ctx) => loadSampleBundle(db, ctx).then(() => undefined),
};
