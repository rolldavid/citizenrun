import type { BundleManifest } from '@citizenrun/shared';
import { z } from 'zod';

// data_bundles.stats (T-data_bundles, D-458). Not strict: a key added later still parses.

export const GateResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string().max(2000).nullable(),
});
export type GateResult = z.infer<typeof GateResultSchema>;

export const BundleStatsSchema = z.object({
  schema_version: z.number().int().nullable(),
  geometry_version: z.string().nullable(),
  counts: z.record(
    z.string(),
    z.object({
      rows: z.number().int(),
      inserted: z.number().int(),
      updated: z.number().int(),
      retired: z.number().int(),
    }),
  ),
  gates: z.array(GateResultSchema),
  holds: z.array(z.string()),
  datasets: z.record(z.string(), z.object({ edition: z.string(), downloaded_on: z.string() })),
  two_source_fields: z.number().int().nullable(),
  notices: z
    .object({ deadline_changed: z.number().int(), new_candidacies: z.number().int() })
    .nullable(),
  matched_at: z.string().nullable(),
  match: z
    .object({
      known: z.number().int(),
      matched: z.number().int(),
      created: z.number().int(),
      queued: z.number().int(),
      gone: z.number().int(),
      results_closed: z.number().int(),
    })
    .nullable(),
});
export type BundleStats = z.infer<typeof BundleStatsSchema>;

/** The stats of a load whose manifest could not be read: every key written, nothing known. */
export function emptyStats(): BundleStats {
  return {
    schema_version: null,
    geometry_version: null,
    counts: {},
    gates: [],
    holds: [],
    datasets: {},
    two_source_fields: null,
    notices: { deadline_changed: 0, new_candidacies: 0 },
    matched_at: null,
    match: null,
  };
}

/** schema_version, geometry_version, datasets (edition and downloaded_on only) and two_source_fields from the manifest; counts {}, gates [], holds [],
 *  notices { deadline_changed: 0, new_candidacies: 0 }, matched_at null, match null. */
export function initialStats(manifest: BundleManifest): BundleStats {
  const datasets: BundleStats['datasets'] = {};
  for (const [name, dataset] of Object.entries(manifest.datasets)) {
    datasets[name] = { edition: dataset.edition, downloaded_on: dataset.downloaded_on };
  }
  return {
    ...emptyStats(),
    schema_version: manifest.schema_version,
    geometry_version: manifest.geometry_version,
    datasets,
    two_source_fields: manifest.two_source_fields,
  };
}

/** The first gate of `stats.gates` that failed, or null. */
export function firstFailedGate(stats: BundleStats): GateResult | null {
  return stats.gates.find((gate) => !gate.passed) ?? null;
}
