import {
  bucketReader,
  createMediaAssetWriter,
  firstFailedGate,
  loadBundle,
  markBundleRejected,
} from '@citizenrun/db/bundle';
import type { LoadResult } from '@citizenrun/db/bundle';
import type { JobPayload } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import { deferForCivicLock, withCivicLock } from '../../lib/civic-lock.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import { PermanentJobError, errorClassOf } from '../types.ts';
import type { JobDefinition } from '../types.ts';
import { dataBucketClient, mediaObjectStore, touchingReader } from './io.ts';

// J-bundle.load: the job around the load core (PIPE-loader). It settles the row, takes the civic
// lock, rejects a superseded bundle, runs the core and sends the one alert of its outcome (D-490).

/** Milliseconds between two heartbeats while the core runs: one upsert statement can outlast the 60-second heartbeat. */
export const HEARTBEAT_TOUCH_MS = 30_000;

const ALERT_WINDOW_SECONDS = 86_400; // J-ops.alert: bundle_rejected, bundle_held

/** The root manifest, relative to the folder bucketReader resolves against. */
const ROOT_MANIFEST = 'manifest.json';

type BundleRow = { id: string; version: string; kind: string; status: string };
type Payload = JobPayload<'bundle.load'>;

/** The greatest version of the row's kind that is loaded and newer than the row, sample- versions left out (D-458). */
async function newerLoaded(ctx: JobContext, row: BundleRow): Promise<string | null> {
  // index: data_bundles_version_key
  const [found] = await ctx.db.execute<{ version: string }>(
    sql`select version from data_bundles
        where kind = ${row.kind} and status = 'loaded' and version > ${row.version}
          and version not like 'sample-%'
        order by version desc
        limit 1`,
    'objects',
  );
  return found?.version ?? null;
}

/** Rejects the row with gate `superseded` when a newer bundle of its kind is loaded; true when it did. */
async function supersede(ctx: JobContext, row: BundleRow): Promise<boolean> {
  const newer = await newerLoaded(ctx, row);
  if (newer === null) {
    return false;
  }
  await markBundleRejected(ctx.db, row.id, 'superseded', newer);
  ctx.log.info('bundle.superseded', { bundleId: row.id, supersededBy: newer });
  return true;
}

async function alertRejected(ctx: JobContext, row: BundleRow, gate: string | null): Promise<void> {
  // A throttled send returns null; that is success.
  await ctx.enqueue(
    'ops.alert',
    { kind: 'bundle_rejected', values: { bundleId: row.id, version: row.version, gate } },
    { throttle: { seconds: ALERT_WINDOW_SECONDS, key: `bundle_rejected:${row.id}` } },
  );
  ctx.log.warn('bundle.rejected', { bundleId: row.id, gate });
}

/** Runs the core with a heartbeat; on the last attempt a failure ends the row `rejected` with `load_error`. */
async function runCore(ctx: JobContext, row: BundleRow, payload: Payload): Promise<LoadResult> {
  const manifestKey = `bundles/${row.version}/manifest.json`;
  const reader = touchingReader(bucketReader(dataBucketClient(ctx.storage.data), manifestKey), () =>
    ctx.touch(),
  );
  const timer = setInterval(() => {
    // A failed heartbeat is not this job's failure; pg-boss decides when a job has gone quiet.
    ctx.touch().catch(() => undefined);
  }, HEARTBEAT_TOUCH_MS);
  try {
    return await loadBundle(ctx.db, reader, ROOT_MANIFEST, {
      bundleId: row.id,
      approved: payload.mode === 'approved',
      now: ctx.now(),
      enqueue: ctx.enqueue,
      media: createMediaAssetWriter(mediaObjectStore(ctx.storage.media)),
    });
  } catch (error) {
    if (ctx.job.isFinalAttempt) {
      // The class name only: a zod or SQL message can carry bundle content.
      await markBundleRejected(ctx.db, row.id, 'load_error', errorClassOf(error));
      await alertRejected(ctx, row, 'load_error');
    }
    throw error;
  } finally {
    clearInterval(timer);
  }
}

async function loadUnderLock(ctx: JobContext, row: BundleRow, payload: Payload): Promise<void> {
  // Supersession of a new or approved load; a reload was checked at the settle step.
  if (payload.mode !== 'reload' && (await supersede(ctx, row))) {
    return;
  }
  const result = await runCore(ctx, row, payload);
  switch (result.status) {
    case 'rejected':
      await alertRejected(ctx, row, firstFailedGate(result.stats)?.name ?? null);
      return;
    case 'held':
      await ctx.enqueue(
        'ops.alert',
        { kind: 'bundle_held', values: { bundleId: row.id, version: row.version } },
        { throttle: { seconds: ALERT_WINDOW_SECONDS, key: `bundle_held:${row.id}` } },
      );
      ctx.log.warn('bundle.held', { bundleId: row.id, holds: result.stats.holds });
      return;
    case 'loaded': {
      // The follow-on jobs were sent by the core in its record transaction.
      const counts: Record<string, { inserted: number; updated: number; retired: number }> = {};
      for (const [table, count] of Object.entries(result.stats.counts)) {
        counts[table] = {
          inserted: count.inserted,
          updated: count.updated,
          retired: count.retired,
        };
      }
      ctx.log.info('bundle.loaded', { bundleId: row.id, counts });
      return;
    }
  }
}

export const bundleLoad: JobDefinition<'bundle.load'> = {
  name: 'bundle.load',
  queue: QUEUE_OPTIONS['bundle.load'].queue,
  work: QUEUE_OPTIONS['bundle.load'].work,
  async handle(payload, ctx) {
    // Settle: every mode acts only on a `loading` row.
    const [row] = await ctx.db.execute<BundleRow>(
      sql`select id, version, kind, status from data_bundles where id = ${payload.bundleId}::uuid`,
      'objects',
    );
    if (row === undefined) {
      throw new PermanentJobError('bundle not found');
    }
    if (row.status !== 'loading') {
      ctx.log.info('bundle.load.skipped', { bundleId: row.id, status: row.status });
      return;
    }
    if (payload.mode === 'reload' && (await supersede(ctx, row))) {
      return;
    }
    const locked = await withCivicLock(ctx.db, () => loadUnderLock(ctx, row, payload));
    if (!locked.ran) {
      await deferForCivicLock(ctx, 'bundle.load', payload);
    }
  },
};
