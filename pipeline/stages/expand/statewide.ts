// Statewide offices and county unions (PIPE-expand steps 4 and 5): each statewide entry expanded
// for the state itself, and one exact district per county set an office stands on
// (PIPE-geometry step 10).
import { BDistrictSchema } from '@citizenrun/shared';
import type { BDistrict, BGeometry, FieldMetaRow } from '@citizenrun/shared';
import type { TemplateOutput } from '../../templates/output.ts';
import { citedMeta } from '../../templates/output.ts';
import type { StateTemplate } from '../../templates/schema.ts';
import { GeometryInputMissing } from '../shared/geometry-rows.ts';
import { appliesTo, entryOffices } from './offices.ts';
import type { DraftOffice, EntryTarget, FallbackPlan, OfficeContext } from './offices.ts';
import { unionPopulation } from './population.ts';
import type { BlockSumInput } from './population.ts';
import { templateOfficeEntries } from '../../templates/validate.ts';

export type UnionRowFn = (
  key: string,
  counties: readonly BGeometry[],
  stateFips: string,
) => Promise<BGeometry>;

/** The ids of the county sets some office entry stands on, in set order. */
export function referencedCountySets(template: StateTemplate): readonly string[] {
  const named = new Set<string>();
  for (const { entry } of templateOfficeEntries(template)) {
    if (entry.district !== null) {
      named.add(entry.district.county_union);
    }
  }
  return template.county_sets.filter((set) => named.has(set.id)).map((set) => set.id);
}

/**
 * One `county_union:<ST>:<id>` district per referenced county set, with its block-sum population
 * and its geometry row dissolved from the counties' stage 1 rows. A county with no row throws
 * GeometryInputMissing.
 */
export async function countyUnionDistricts(input: {
  readonly template: StateTemplate;
  readonly out: TemplateOutput;
  readonly state: string;
  readonly stateFips: string;
  readonly blockSums: BlockSumInput | null;
  readonly geometry: ReadonlyMap<string, BGeometry>;
  readonly unionRow: UnionRowFn;
}): Promise<{
  readonly districts: readonly BDistrict[];
  readonly geometry: readonly BGeometry[];
  readonly unknownPopulation: number;
}> {
  const referenced = new Set(referencedCountySets(input.template));
  const districts: BDistrict[] = [];
  const geometry: BGeometry[] = [];
  let unknownPopulation = 0;
  for (const [i, set] of input.template.county_sets.entries()) {
    if (!referenced.has(set.id)) {
      continue;
    }
    const key = `county_union:${input.state}:${set.id}`;
    const counties = [...new Set(set.counties)].map((geoid) => {
      const countyKey = `tiger:county:${geoid}`;
      const row = input.geometry.get(countyKey);
      if (row === undefined) {
        throw new GeometryInputMissing(countyKey);
      }
      return row;
    });
    const row = await input.unionRow(key, counties, input.stateFips);
    const population = unionPopulation(set.counties, input.blockSums);
    if (population.population === null) {
      unknownPopulation += 1;
    }
    const fieldMeta: Record<string, FieldMetaRow> = {
      name: citedMeta(input.out, `county_sets.${String(i)}`, set),
    };
    if (population.field_meta !== null) {
      fieldMeta['population'] = population.field_meta.population;
      fieldMeta['population_18'] = population.field_meta.population_18;
    }
    districts.push(
      BDistrictSchema.parse({
        source_key: key,
        jurisdiction_key: `state:${input.state}`,
        name: set.name,
        level: 'county',
        geometry_quality: 'exact',
        geom_hash: row.geom_hash,
        population: population.population,
        population_18: population.population_18,
        lean: null,
        lean_basis: null,
        field_meta: fieldMeta,
      }),
    );
    geometry.push(row);
  }
  return { districts, geometry, unknownPopulation };
}

/** The offices of the template's statewide block, in the state's own jurisdiction and district. */
export function statewideOffices(input: {
  readonly template: StateTemplate;
  readonly ctx: OfficeContext;
  readonly stateFips: string;
  readonly stateName: string;
  readonly statePopulation: number | null;
}): {
  readonly drafts: readonly DraftOffice[];
  readonly fallbacks: readonly FallbackPlan[];
  readonly staggerUnmapped: number;
} {
  const stateDistrict = `tiger:state:${input.stateFips}`;
  const target: EntryTarget = {
    jurisdictionKey: `state:${input.ctx.state}`,
    jurisdictionName: input.stateName,
    jurisdictionKind: 'state',
    ownDistrictKey: stateDistrict,
    exactViaKeys: [stateDistrict],
    placeGeoid: null,
    countyGeoid: null,
    population: input.statePopulation,
    party: null,
    statewide: true,
  };
  const drafts: DraftOffice[] = [];
  const fallbacks: FallbackPlan[] = [];
  let staggerUnmapped = 0;
  input.template.statewide.forEach((entry, i) => {
    const path = `statewide.${String(i)}`;
    if (!appliesTo(entry, path, input.stateName, input.statePopulation)) {
      return;
    }
    const made = entryOffices(input.template, entry, path, target, input.ctx);
    drafts.push(...made.drafts);
    fallbacks.push(...made.fallbacks);
    staggerUnmapped += made.staggerUnmapped;
  });
  return { drafts, fallbacks, staggerUnmapped };
}
