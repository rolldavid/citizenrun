import { localDateTimeIn, newId } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../client.ts';
import type { Enqueue } from '../queue/enqueue.ts';
import type { MediaAssetWriter } from './assets.ts';
import { ID_CHUNK, chunk } from './chunk.ts';
import { BundleAssetError, copyAssets } from './copy-assets.ts';
import { applyGeometry } from './geometry.ts';
import { evaluateHolds } from './holds.ts';
import { prepareLoad, recordRejection } from './prepare.ts';
import type { PreparedLoad } from './prepare.ts';
import type { BundleReader } from './reader.ts';
import { clearStaging } from './stage.ts';
import { BundleStatsSchema, emptyStats } from './stats.ts';
import type { BundleStats, GateResult } from './stats.ts';
import { isFullFileR0 } from './tables.ts';
import type { FullFileR0 } from './tables.ts';
import { applyUpsert } from './upsert.ts';

// loadBundle of PIPE-loader: the gates (prepareLoad), then the holds, the assets, the one
// upsert transaction, the geometry and the record. J-bundle.load and seed step 020-sample-bundle
// run this same core.

export type LoadOptions = {
  readonly bundleId: string; // the data_bundles row J-bundle.poll inserted as 'loading'
  readonly approved: boolean; // an admin approved a held load: holds are skipped
  readonly now: Date;
  readonly enqueue: Enqueue; // the one enqueue helper
  readonly media: MediaAssetWriter; // PIPE-loader-assets
};
export type LoadResult = {
  readonly status: 'loaded' | 'rejected' | 'held';
  readonly stats: BundleStats;
};

export { revertBundle } from './revert.ts';

/** The zone whose calendar date is "today" for the holds: the last United States zone to change date. */
const HOLD_TODAY_ZONE = 'Pacific/Pago_Pago';

/** J-bundle.poll's insert: on conflict (version) do nothing; returns the new id or null. */
export async function insertLoadingBundle(
  tx: Tx,
  input: { version: string; kind: 'full' },
): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(
    sql`insert into data_bundles (id, version, kind, status)
        values (${newId()}::uuid, ${input.version}, ${input.kind}, 'loading')
        on conflict (version) do nothing
        returning id`,
    'objects',
  );
  return row?.id ?? null;
}

/** Sets status 'rejected' and appends { name: gate, passed: false, detail } to stats.gates (creating the stats object when null). */
export async function markBundleRejected(
  db: Db,
  bundleId: string,
  gate: 'superseded' | 'load_error',
  detail: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ stats: unknown }>(
      sql`select stats from data_bundles where id = ${bundleId}::uuid for update`,
      'objects',
    );
    if (row === undefined) {
      throw new Error('No such bundle.');
    }
    const parsed = row.stats === null ? null : BundleStatsSchema.safeParse(row.stats);
    const stats = parsed?.success === true ? parsed.data : emptyStats();
    const next = BundleStatsSchema.parse({
      ...stats,
      gates: [...stats.gates, { name: gate, passed: false, detail }],
    });
    await tx.execute(
      sql`update data_bundles set status = 'rejected', stats = ${JSON.stringify(next)}::jsonb
          where id = ${bundleId}::uuid`,
    );
  });
}

async function writeStats(
  db: Db | Tx,
  bundleId: string,
  status: 'held' | 'loaded',
  stats: BundleStats,
  loadedAt: Date | null,
): Promise<void> {
  const checked = BundleStatsSchema.parse(stats);
  const loaded =
    loadedAt === null ? sql`` : sql`, loaded_at = ${loadedAt.toISOString()}::timestamptz`;
  await db.execute(
    sql`update data_bundles set status = ${status}, stats = ${JSON.stringify(checked)}::jsonb${loaded}
        where id = ${bundleId}::uuid`,
  );
}

/** The gates of `stats` with the `assets` entry replaced by a failure. */
function withAssetFailure(stats: BundleStats, detail: string): BundleStats {
  const failed: GateResult = { name: 'assets', passed: false, detail };
  const gates = stats.gates.some((gate) => gate.name === 'assets')
    ? stats.gates.map((gate) => (gate.name === 'assets' ? failed : gate))
    : [...stats.gates, failed];
  return { ...stats, gates };
}

/** stats.counts from the staged rows and this bundle's bundle_changes by op. */
async function countChanges(tx: Tx, prepared: PreparedLoad): Promise<BundleStats['counts']> {
  const counts: BundleStats['counts'] = {};
  for (const [file, rows] of Object.entries(prepared.rows)) {
    counts[file] = { rows, inserted: 0, updated: 0, retired: 0 };
  }
  // index: bundle_changes_bundle
  const rows = await tx.execute<{ table_name: string; op: string; n: number }>(
    sql`select table_name, op, count(*)::int as n from bundle_changes
        where bundle_id = ${prepared.bundleId}::uuid
        group by table_name, op`,
    'objects',
  );
  for (const row of rows) {
    const entry = (counts[row.table_name] ??= { rows: 0, inserted: 0, updated: 0, retired: 0 });
    if (row.op === 'insert') {
      entry.inserted += row.n;
    } else if (row.op === 'update') {
      entry.updated += row.n;
    } else if (row.op === 'retire') {
      entry.retired += row.n;
    }
  }
  return counts;
}

/** The record of PIPE-loader, in one transaction: the score.issues jobs, the stats and status, the staged rows dropped. */
async function record(db: Db, prepared: PreparedLoad, opts: LoadOptions): Promise<BundleStats> {
  return db.transaction(async (tx) => {
    // index: bundle_changes_bundle
    const changed = await tx.execute<{ id: string }>(
      sql`select distinct (row_key ->> 'office_id')::uuid as id from bundle_changes
          where bundle_id = ${prepared.bundleId}::uuid and table_name = 'office_powers'
          order by 1`,
      'objects',
    );
    for (const officeIds of chunk(
      changed.map((row) => row.id),
      ID_CHUNK,
    )) {
      // offices whose powers changed get their office_issues rebuilt.
      await opts.enqueue('score.issues', { scope: 'offices', officeIds }, { tx });
    }
    const stats: BundleStats = { ...prepared.stats, counts: await countChanges(tx, prepared) };
    await writeStats(tx, prepared.bundleId, 'loaded', stats, opts.now);
    // index: bundle_rows pkey (bundle_id prefix)
    await tx.execute(
      sql`delete from staging.bundle_rows where bundle_id = ${prepared.bundleId}::uuid`,
    );
    return stats;
  });
}

/**
 * Loads the bundle whose manifest is at `manifestPath` (relative to the reader's root) into the
 * live tables under `opts.bundleId`, which J-bundle.poll inserted as `loading`. Returns
 * `rejected` when a gate fails, `held` when a hold is crossed (unless approved), else `loaded`.
 * A failure inside the upsert rolls it back and propagates, leaving the row `loading`.
 */
export async function loadBundle(
  db: Db,
  reader: BundleReader,
  manifestPath: string,
  opts: LoadOptions,
): Promise<LoadResult> {
  const { bundleId } = opts;
  const outcome = await prepareLoad(db, reader, manifestPath, { bundleId, media: opts.media });
  if (!outcome.ok) {
    return { status: 'rejected', stats: outcome.stats };
  }
  const { prepared } = outcome;
  // Freshly staged rows have no planner statistics; without them the hold and upsert joins over
  // staging fall back to nested loops that scan the staged file once per row.
  await db.execute(sql`analyze staging.bundle_rows, staging.district_geometry`);

  if (!opts.approved) {
    const today = localDateTimeIn(HOLD_TODAY_ZONE, opts.now).date;
    const { holds } = await evaluateHolds(db, bundleId, today);
    if (holds.length > 0) {
      // Nothing is notified here: J-bundle.load sends the one bundle_held alert.
      const stats: BundleStats = { ...prepared.stats, holds };
      await writeStats(db, bundleId, 'held', stats, null);
      await clearStaging(db);
      return { status: 'held', stats };
    }
  }

  let photos;
  try {
    photos = await copyAssets(db, reader, prepared.assets, opts.media);
  } catch (error) {
    if (!(error instanceof BundleAssetError)) {
      throw error;
    }
    const stats = withAssetFailure(prepared.stats, error.message);
    await recordRejection(db, bundleId, stats);
    await clearStaging(db);
    return { status: 'rejected', stats };
  }

  const files = new Set<FullFileR0>(
    prepared.manifest.files.map((file) => file.name).filter(isFullFileR0),
  );
  await db.transaction(async (tx) => {
    await applyUpsert(tx, { bundleId, now: opts.now, files, photos });
  });

  await applyGeometry(db, bundleId, prepared.geometry.states, prepared.geometry.staged);

  const stats = await record(db, prepared, opts);
  return { status: 'loaded', stats };
}
