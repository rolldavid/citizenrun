import { lookupDistrictsAtPoint } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import { boundaryLayerOf, tigerDistrictKey } from '@citizenrun/shared';
import type { Level, TigerLayer } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { CensusMatch } from '../geo/census.ts';

/** One district a location resolved to, with what the location step reads of it. */
export type ResolvedDistrict = {
  id: string;
  sourceKey: string;
  level: Level;
  geometryQuality: 'exact' | 'parent_fallback' | 'county_approx';
  state: string;
  approximate: boolean;
};

type FactRow = {
  id: string;
  source_key: string;
  level: Level;
  geometry_quality: ResolvedDistrict['geometryQuality'];
  state: string;
};

function toResolved(row: FactRow, approximate: boolean): ResolvedDistrict {
  return {
    id: row.id,
    sourceKey: row.source_key,
    level: row.level,
    geometryQuality: row.geometry_quality,
    state: row.state,
    approximate,
  };
}

// The approximate districts that stand in through the given exact ones (L-point-lookup's second branch).
async function approximateFor(db: Db | Tx, exactIds: readonly string[]): Promise<FactRow[]> {
  if (exactIds.length === 0) {
    return [];
  }
  // index: district_fallbacks_via
  return db.execute<FactRow>(
    sql`select distinct d.id, d.source_key, d.level, d.geometry_quality, j.state
        from district_fallbacks f
        join districts d on d.id = f.district_id
        join jurisdictions j on j.id = d.jurisdiction_id
        where f.via_district_id = any(${sql.param([...exactIds])}::uuid[])
          and d.retired_at is null
        order by d.id`,
    'objects',
  );
}

/**
 * The districts at a point; with a Census match, its GEOID districts replace the lookup's district
 * of each layer it names (D-210, D-211). Returns the layers that disagreed (tokens only). Logs
 * nothing: the caller logs the disagreements.
 */
export async function resolveDistricts(
  db: Db | Tx,
  input: { point: { lat: number; lng: number }; census: CensusMatch | null },
): Promise<{ districts: ResolvedDistrict[]; disagreements: TigerLayer[] }> {
  const { point, census } = input;
  const rows = await lookupDistrictsAtPoint(db, { lng: point.lng, lat: point.lat });
  const lookupIds = rows.map((row) => row.id);
  const layers = census?.layers ?? [];
  const geoidKeys = layers.map((layer) => tigerDistrictKey(layer.token, layer.geoid));
  if (lookupIds.length === 0 && geoidKeys.length === 0) {
    return { districts: [], disagreements: [] };
  }
  // index: districts_pkey, districts_source_key_key
  const facts = await db.execute<FactRow>(
    sql`select d.id, d.source_key, d.level, d.geometry_quality, j.state
        from districts d
        join jurisdictions j on j.id = d.jurisdiction_id
        where d.id = any(${sql.param(lookupIds)}::uuid[])
           or (d.source_key = any(${sql.param(geoidKeys)}::text[]) and d.retired_at is null)`,
    'objects',
  );
  const byId = new Map(facts.map((row) => [row.id, row]));
  const bySourceKey = new Map(facts.map((row) => [row.source_key, row]));

  // The lookup's rows, exact ones first, as they came.
  const lookupExact: FactRow[] = [];
  const lookupApproximate: FactRow[] = [];
  for (const row of rows) {
    const fact = byId.get(row.id);
    if (fact !== undefined) {
      (row.approximate ? lookupApproximate : lookupExact).push(fact);
    }
  }
  if (census === null) {
    return {
      districts: [
        ...lookupExact.map((row) => toResolved(row, false)),
        ...lookupApproximate.map((row) => toResolved(row, true)),
      ],
      disagreements: [],
    };
  }

  let exact = lookupExact;
  const disagreements: TigerLayer[] = [];
  for (const layer of layers) {
    const geoidRow = bySourceKey.get(tigerDistrictKey(layer.token, layer.geoid));
    if (geoidRow === undefined) {
      // No such district, or a retired one: the lookup's district of the layer stays.
      continue;
    }
    const boundary = `tiger:${layer.token}`;
    const removed = exact.filter((row) => boundaryLayerOf(row.source_key) === boundary);
    if (removed.length === 1 && removed[0]?.id === geoidRow.id) {
      continue;
    }
    disagreements.push(layer.token);
    exact = [...exact.filter((row) => boundaryLayerOf(row.source_key) !== boundary), geoidRow];
  }

  const lookupExactIds = new Set(lookupExact.map((row) => row.id));
  const replaced =
    exact.length !== lookupExact.length || exact.some((row) => !lookupExactIds.has(row.id));
  const approximate = replaced
    ? await approximateFor(
        db,
        exact.map((row) => row.id),
      )
    : lookupApproximate;
  return {
    districts: [
      ...exact.map((row) => toResolved(row, false)),
      ...approximate.map((row) => toResolved(row, true)),
    ],
    disagreements,
  };
}
