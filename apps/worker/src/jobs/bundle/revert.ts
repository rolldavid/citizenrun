import { revertBundle } from '@citizenrun/db/bundle';
import { sql } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import { deferForCivicLock, withCivicLock } from '../../lib/civic-lock.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import { PermanentJobError } from '../types.ts';
import type { JobDefinition } from '../types.ts';

// J-bundle.revert: undoes a loaded bundle and every later load of its kind, newest first.
// Geometry is not reverted. The admin who asked is in admin_actions, never in a log line.

export const REVERTABLE_LOADS = 7; // PIPE-loader-hold-revert

type BundleRow = { id: string; kind: string; status: string; version: string };

/** True when the bundle is among the REVERTABLE_LOADS newest loads of its kind, sample- versions left out (D-458). */
async function isRevertable(ctx: JobContext, row: BundleRow): Promise<boolean> {
  if (row.status !== 'loaded' || row.version.startsWith('sample-')) {
    return false;
  }
  // index: data_bundles_loaded
  const newest = await ctx.db.execute<{ id: string }>(
    sql`select id from data_bundles
        where kind = ${row.kind} and status = 'loaded' and version not like 'sample-%'
        order by loaded_at desc
        limit ${REVERTABLE_LOADS}`,
    'objects',
  );
  return newest.some((loaded) => loaded.id === row.id);
}

/** Reverts every loaded bundle of the kind created after this one, newest first, then this one; returns the count. */
async function revertFrom(ctx: JobContext, row: BundleRow): Promise<number> {
  const later = await ctx.db.execute<{ id: string }>(
    sql`select id from data_bundles
        where kind = ${row.kind} and status = 'loaded' and version not like 'sample-%'
          and created_at > (select created_at from data_bundles where id = ${row.id}::uuid)
        order by created_at desc`,
    'objects',
  );
  // Each revert is its own transaction inside the core; a retry skips the ones already reverted.
  for (const bundle of later) {
    await revertBundle(ctx.db, bundle.id, ctx.now());
  }
  await revertBundle(ctx.db, row.id, ctx.now());
  return later.length + 1;
}

export const bundleRevert: JobDefinition<'bundle.revert'> = {
  name: 'bundle.revert',
  queue: QUEUE_OPTIONS['bundle.revert'].queue,
  work: QUEUE_OPTIONS['bundle.revert'].work,
  async handle(payload, ctx) {
    const [row] = await ctx.db.execute<BundleRow>(
      sql`select id, kind, status, version from data_bundles where id = ${payload.bundleId}::uuid`,
      'objects',
    );
    if (row?.status === 'reverted') {
      ctx.log.info('bundle.revert.skipped', { bundleId: row.id, status: row.status });
      return;
    }
    if (row === undefined || !(await isRevertable(ctx, row))) {
      throw new PermanentJobError('not revertable');
    }
    const locked = await withCivicLock(ctx.db, () => revertFrom(ctx, row));
    if (!locked.ran) {
      await deferForCivicLock(ctx, 'bundle.revert', payload);
      return;
    }
    // Every office's issues are rebuilt from the restored powers; score.offices joins in milestone 3.
    await ctx.enqueue('score.issues', { scope: 'all' });
    ctx.log.info('bundle.reverted', { bundleId: row.id, count: locked.value });
  },
};
