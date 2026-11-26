// The parent fallback districts of by-district seats with no ward layer (PIPE-expand step 2):
// each stands in through its unit's exact districts, with its fallback rows and its geometry row.
import { BDistrictFallbackSchema, BDistrictSchema } from '@citizenrun/shared';
import type { BDistrict, BDistrictFallback, BGeometry } from '@citizenrun/shared';
import { GeometryInputMissing } from '../shared/geometry-rows.ts';
import type { FallbackPlan } from './offices.ts';
import type { FallbackRowFn } from './party.ts';

/**
 * One district per planned key (the first plan of a key wins): `level` that of the unit's own
 * district when it is exact, else `local`; one fallback row per via key; the geometry row by
 * PIPE-geometry step 9. A via district with no geometry row throws GeometryInputMissing.
 */
export async function fallbackDistricts(input: {
  readonly plans: readonly FallbackPlan[];
  readonly districts: ReadonlyMap<string, BDistrict>;
  readonly geometry: ReadonlyMap<string, BGeometry>;
  readonly fallbackRow: FallbackRowFn;
}): Promise<{
  readonly districts: readonly BDistrict[];
  readonly fallbacks: readonly BDistrictFallback[];
  readonly geometry: readonly BGeometry[];
}> {
  const districts: BDistrict[] = [];
  const fallbacks: BDistrictFallback[] = [];
  const geometry: BGeometry[] = [];
  const seen = new Set<string>();
  for (const plan of input.plans) {
    if (seen.has(plan.key)) {
      continue;
    }
    seen.add(plan.key);
    const own = input.districts.get(plan.ownDistrictKey);
    const level = own !== undefined && own.geometry_quality === 'exact' ? own.level : 'local';
    const via = plan.viaKeys.map((key) => {
      const row = input.geometry.get(key);
      if (row === undefined) {
        throw new GeometryInputMissing(key);
      }
      return row;
    });
    const row = await input.fallbackRow(plan.key, via);
    geometry.push(row);
    districts.push(
      BDistrictSchema.parse({
        source_key: plan.key,
        jurisdiction_key: plan.jurisdictionKey,
        name: plan.name,
        level,
        geometry_quality: 'parent_fallback',
        geom_hash: row.geom_hash,
        population: null,
        population_18: null,
        lean: null,
        lean_basis: null,
        field_meta: {},
      }),
    );
    for (const viaKey of plan.viaKeys) {
      fallbacks.push(
        BDistrictFallbackSchema.parse({
          source_key: `${plan.key}|${viaKey}`,
          district_key: plan.key,
          via_district_key: viaKey,
        }),
      );
    }
  }
  return { districts, fallbacks, geometry };
}
