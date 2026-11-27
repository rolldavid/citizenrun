import type { BundleManifest } from '@citizenrun/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { dataBundles } from '../schema/bundles.ts';
import type { MediaAssetWriter } from './assets.ts';
import { BundleGeometryManifestError, BundleManifestTooLargeError } from './errors.ts';
import {
  assetsGate,
  checkCompatibility,
  checkPipelineChecks,
  geometryGate,
  personalDataGate,
  sqlGates,
  stagingGates,
} from './gates.ts';
import type { AssetRef } from './gates.ts';
import type { BundleReader } from './reader.ts';
import { clearStaging, stageFullFiles, stageGeometry } from './stage.ts';
import type { StageReport } from './stage.ts';
import { BundleStatsSchema, emptyStats, initialStats } from './stats.ts';
import type { BundleStats, GateResult } from './stats.ts';
import type { FullFileR0 } from './tables.ts';

// The first half of PIPE-loader: read the manifest, stage, and evaluate every gate before any live
// table, media object or user row is written (CTL-30, D-504).

export type PreparedLoad = {
  readonly bundleId: string;
  readonly manifest: BundleManifest;
  readonly geometry: { readonly staged: boolean; readonly states: readonly string[] };
  readonly rows: Readonly<Partial<Record<FullFileR0 | 'zip_centroids', number>>>;
  readonly gates: readonly GateResult[]; // every gate evaluated, all passed
  readonly assets: readonly AssetRef[];
  readonly stats: BundleStats; // initialStats with counts.rows and gates filled
};

export type PrepareOutcome =
  | { readonly ok: true; readonly prepared: PreparedLoad }
  | { readonly ok: false; readonly stats: BundleStats };

function isInvalidManifest(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    error instanceof BundleManifestTooLargeError ||
    (error instanceof Error && error.name === 'ZodError')
  );
}

function withCounts(
  stats: BundleStats,
  report: StageReport,
  gates: readonly GateResult[],
): BundleStats {
  const counts: BundleStats['counts'] = {};
  for (const [file, rows] of Object.entries(report.rows)) {
    counts[file] = { rows, inserted: 0, updated: 0, retired: 0 };
  }
  return { ...stats, counts, gates: [...gates] };
}

/** Sets the bundle's row to `rejected` with its stats. Nothing else is written (D-504). */
export async function recordRejection(db: Db, bundleId: string, stats: BundleStats): Promise<void> {
  const checked = BundleStatsSchema.parse(stats);
  await db
    .update(dataBundles)
    .set({ status: 'rejected', stats: checked })
    .where(eq(dataBundles.id, bundleId));
}

async function reject(db: Db, bundleId: string, stats: BundleStats): Promise<PrepareOutcome> {
  await recordRejection(db, bundleId, stats);
  await clearStaging(db);
  return { ok: false, stats };
}

async function previousGeometryVersion(db: Db): Promise<string | null> {
  // index: data_bundles_loaded
  const [row] = await db.execute<{ version: string | null }>(
    sql`select stats ->> 'geometry_version' as version from data_bundles
        where kind = 'full' and status = 'loaded'
        order by loaded_at desc
        limit 1`,
    'objects',
  );
  return row?.version ?? null;
}

/**
 * Reads the manifest at `manifestPath` (relative to the reader's root manifest folder, so
 * 'manifest.json' for the root manifest itself), stages the bundle and evaluates every gate in
 * GATE_ORDER, stopping at the first failing step. A failure records the bundle as `rejected` and
 * clears staging; success leaves the staged rows for the upsert.
 */
export async function prepareLoad(
  db: Db,
  reader: BundleReader,
  manifestPath: string,
  opts: { readonly bundleId: string; readonly media: MediaAssetWriter },
): Promise<PrepareOutcome> {
  const { bundleId, media } = opts;
  let manifest: BundleManifest;
  try {
    manifest = await reader.readManifest(manifestPath);
  } catch (error) {
    if (!isInvalidManifest(error)) {
      throw error;
    }
    const gates = [{ name: 'schema_compatible', passed: false, detail: 'manifest invalid' }];
    return reject(db, bundleId, { ...emptyStats(), gates });
  }
  const base = initialStats(manifest);
  const gates: GateResult[] = [checkCompatibility(manifest, 'full')];
  if (gates[0]?.passed === true) {
    gates.push(checkPipelineChecks(manifest));
  }
  if (gates.some((result) => !result.passed)) {
    return reject(db, bundleId, { ...base, gates });
  }

  await clearStaging(db);
  const previous = await previousGeometryVersion(db);
  const report = await stageFullFiles(db, reader, manifest, bundleId);
  let geometry: { staged: boolean; states: string[] };
  try {
    geometry = await stageGeometry(
      db,
      reader,
      { bundleId, manifest, previousGeometryVersion: previous },
      report,
    );
  } catch (error) {
    if (!(error instanceof BundleGeometryManifestError)) {
      throw error;
    }
    gates[0] = error.gate;
    return reject(db, bundleId, withCounts(base, report, gates));
  }

  gates.push(...stagingGates(report));
  if (gates.some((result) => !result.passed)) {
    // Later gates would run on untrusted rows.
    return reject(db, bundleId, withCounts(base, report, gates));
  }
  const files = manifest.files.map((file) => file.name);
  // Freshly staged rows have no planner statistics; without them the reference gates' anti-joins
  // over staging run as nested loops that scan a staged file once per row of another.
  await db.execute(sql`analyze staging.bundle_rows, staging.district_geometry`);
  gates.push(...(await sqlGates(db, bundleId, files, report)));
  gates.push(personalDataGate(report));
  gates.push(await geometryGate(db, bundleId));
  const assets = await assetsGate(db, reader, manifest, bundleId, media);
  gates.push(assets.gate);

  const stats = withCounts(base, report, gates);
  if (gates.some((result) => !result.passed)) {
    return reject(db, bundleId, stats);
  }
  return {
    ok: true,
    prepared: {
      bundleId,
      manifest,
      geometry,
      rows: report.rows,
      gates,
      assets: assets.assets,
      stats,
    },
  };
}
