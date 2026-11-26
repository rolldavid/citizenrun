// Stage 4 (PIPE-expand): reads the state's template output, stage 1's units and districts, stage
// 2's office references, the slug registry and the block table, and writes the offices and
// elections the template gives (expandState).
import { rulesFor } from '@citizenrun/rules';
import type { StateRules } from '@citizenrun/rules';
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BGeometrySchema,
  BJurisdictionSchema,
} from '@citizenrun/shared';
import type { BDistrict } from '@citizenrun/shared';
import type { z } from 'zod';
import { bucketKeys } from '../lib/bucket.ts';
import { readNdjsonGz } from '../lib/ndjson.ts';
import { readStageMeta } from '../lib/runner.ts';
import type { RunContext, StageMeta, StageModule, StageResult } from '../lib/runner.ts';
import { assignSlugs, loadSlugRegistry } from '../lib/slug.ts';
import type { SlugRegistry } from '../lib/slug.ts';
import { loadTimezoneRegister, zoneForCounty } from '../lib/timezones.ts';
import { LISTING_DATASET, readParsedListing } from '../sources/census-gus.ts';
import type { ParsedListingRow } from '../sources/census-gus.ts';
import { BlockTableRowSchema, PL_DATASET } from '../sources/pl94171.ts';
import { readTemplateOutput } from '../templates/output.ts';
import type { StateTemplate } from '../templates/schema.ts';
import { expandCheck, expandState } from './expand/expand-state.ts';
import type { ExpandOutput } from './expand/expand-state.ts';
import { countyBlockSums } from './expand/population.ts';
import type { BlockSumInput } from './expand/population.ts';
import { referencedCountySets } from './expand/statewide.ts';
import { planUnits } from './expand/units.ts';
import { fallbackRow, unionRow } from './shared/geometry-rows.ts';
import { OFFICE_REFS_FILE, OfficeRefRowSchema } from './shared/office-ref.ts';
import { loadRelevanceDefaults } from './shared/reference.ts';
import { repoRoot } from './shared/repo.ts';
import { rulesFixtureInfo } from './shared/rules-fixtures.ts';
import { listStageStates, loadStageRows } from './shared/stage-io.ts';

/** The names given to `writeRows` for each of stage 4's files. */
export const S04_FILES = {
  offices: 'offices',
  officePowers: 'office_powers',
  elections: 'elections',
  jurisdictions: 'jurisdictions',
  districts: 'districts',
  districtFallbacks: 'district_fallbacks',
  geometry: 'geometry',
  officeRefs: OFFICE_REFS_FILE,
} as const;

export const S04_BLOCKING_CHECKS = ['slug_unique', 'template_pattern'] as const;

/** An input stage 4 needs and the bucket does not hold; names the input, never a value. */
export class ExpandInputMissing extends Error {
  override readonly name = 'ExpandInputMissing';

  constructor(state: string, input: string) {
    super(`stage 4 for ${state} has no ${input}`);
  }
}

export type S04Deps = { readonly rulesFor: (state: string) => StateRules | null };

/**
 * The slug assigner of a run: the registry's assignment (PIPE-slugs), leaving out any identity whose
 * slug the registry holds for another identity, so that office fails `slug_unique`.
 */
export function registrySlugAssigner(
  registry: SlugRegistry,
): (requests: readonly { identity: string; base: string }[]) => ReadonlyMap<string, string> {
  const holders = new Map<string, Set<string>>();
  for (const [identity, slug] of registry) {
    const set = holders.get(slug) ?? new Set<string>();
    set.add(identity);
    holders.set(slug, set);
  }
  return (requests) => {
    const { assigned } = assignSlugs(registry, requests);
    const kept = new Map<string, string>();
    for (const [identity, slug] of assigned) {
      const held = holders.get(slug);
      if (held !== undefined && [...held].some((other) => other !== identity)) {
        continue;
      }
      kept.set(identity, slug);
    }
    return kept;
  };
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/**
 * The block sums of the counties the referenced county sets list, from stage 1's block table, with
 * the proof stage 1 gives its own block sums; null when the table, its edition or that proof is
 * missing.
 */
async function blockSumsFor(
  ctx: RunContext,
  state: string,
  template: StateTemplate,
  meta: StageMeta,
  districts: readonly BDistrict[],
): Promise<BlockSumInput | null> {
  const ids = new Set(referencedCountySets(template));
  const counties = new Set(
    template.county_sets.filter((set) => ids.has(set.id)).flatMap((set) => set.counties),
  );
  const edition = meta.datasets[PL_DATASET]?.edition;
  if (edition === undefined) {
    return null;
  }
  const proofDistrict = [...districts]
    .sort((a, b) => byteOrder(a.source_key, b.source_key))
    .find(
      (d) =>
        d.field_meta['population']?.population_source === 'pl94171-block-sum' &&
        d.field_meta['population'].source_url !== null,
    );
  const proof = proofDistrict?.field_meta['population'];
  if (proof?.source_url === null || proof?.source_url === undefined) {
    return null;
  }
  const found = await ctx.bucket.getStream(
    bucketKeys.dataset(PL_DATASET, edition, `blocks-${state}.ndjson.gz`),
  );
  if (found === null) {
    return null;
  }
  const kept: { geoid: string; p1: number; p3: number }[] = [];
  for await (const row of readNdjsonGz(found.body, BlockTableRowSchema)) {
    if (counties.has(row.geoid.slice(0, 5))) {
      kept.push({ geoid: row.geoid, p1: row.p1, p3: row.p3 });
    }
  }
  return {
    byCounty: countyBlockSums(kept, counties),
    proof: { source_url: proof.source_url, checked_at: proof.checked_at },
  };
}

async function required<T>(state: string, input: string, rows: Promise<T | null>): Promise<T> {
  const value = await rows;
  if (value === null) {
    throw new ExpandInputMissing(state, input);
  }
  return value;
}

async function writeOutput(
  opts: Parameters<StageModule['run']>[2],
  output: ExpandOutput,
): Promise<StageResult['files']> {
  return [
    await opts.out.writeRows(S04_FILES.offices, output.offices),
    await opts.out.writeRows(S04_FILES.officePowers, output.officePowers),
    await opts.out.writeRows(S04_FILES.elections, output.elections),
    await opts.out.writeRows(S04_FILES.jurisdictions, output.jurisdictions),
    await opts.out.writeRows(S04_FILES.districts, output.districts),
    await opts.out.writeRows(S04_FILES.districtFallbacks, output.districtFallbacks),
    await opts.out.writeRows(S04_FILES.geometry, output.geometry),
    await opts.out.writeRows(S04_FILES.officeRefs, output.officeRefs),
  ];
}

/** Stage 4 with the rules modules `deps.rulesFor` gives. */
export function makeS04Expand(deps: S04Deps): StageModule {
  return {
    id: 's04-expand',
    milestone: 2,
    blockingChecks: [...S04_BLOCKING_CHECKS],
    states(ctx) {
      return listStageStates(ctx, 's03-templates');
    },
    async run(ctx, state, opts): Promise<StageResult> {
      const template = await required(state, 'template output', readTemplateOutput(ctx, state));
      const meta = await required(
        state,
        'stage 1 output',
        readStageMeta(ctx.bucket, 's01-base', state),
      );
      const load = <T>(name: string, schema: z.ZodType<T>) =>
        required(state, `stage 1 ${name}`, loadStageRows(ctx, 's01-base', state, name, schema));
      const jurisdictions = await load('jurisdictions', BJurisdictionSchema);
      const districts = await load('districts', BDistrictSchema);
      const fallbacks = await load('district_fallbacks', BDistrictFallbackSchema);
      const geometryRows = await load('geometry', BGeometrySchema);

      const stateJurisdiction = jurisdictions.find((j) => j.source_key === `state:${state}`);
      const stateDistrict = districts.find(
        (d) => d.source_key.startsWith('tiger:state:') && d.jurisdiction_key === `state:${state}`,
      );
      if (stateJurisdiction === undefined || stateDistrict === undefined) {
        throw new ExpandInputMissing(state, 'state jurisdiction or district');
      }
      const listingEdition = meta.datasets[LISTING_DATASET]?.edition;
      if (listingEdition === undefined) {
        throw new ExpandInputMissing(state, 'listing edition');
      }
      const unitPid6 = new Set(
        jurisdictions
          .filter((j) => j.source_key.startsWith('census:'))
          .map((j) => j.source_key.slice('census:'.length)),
      );
      const listing = new Map<string, ParsedListingRow>();
      for await (const row of readParsedListing(ctx, listingEdition)) {
        if (unitPid6.has(row.pid6)) {
          listing.set(row.pid6, row);
        }
      }
      const { units, withoutDistrict } = planUnits(
        state,
        jurisdictions,
        districts,
        fallbacks,
        listing,
      );
      const knownRefs =
        (await loadStageRows(ctx, 's02-known', state, OFFICE_REFS_FILE, OfficeRefRowSchema)) ?? [];
      const registry = await loadSlugRegistry(ctx.bucket, 'offices');
      const root = repoRoot();
      const [fixtures, zones, relevanceDefaults] = await Promise.all([
        rulesFixtureInfo(root, state),
        loadTimezoneRegister(),
        loadRelevanceDefaults(root),
      ]);
      const blockSums =
        referencedCountySets(template.template).length === 0
          ? null
          : await blockSumsFor(ctx, state, template.template, meta, districts);

      const output = await expandState({
        template,
        units,
        rules: deps.rulesFor(state),
        today: ctx.today,
        now: ctx.now,
        state,
        stateFips: stateDistrict.source_key.slice('tiger:state:'.length),
        stateName: stateJurisdiction.name,
        districts,
        geometry: new Map(geometryRows.map((row) => [row.source_key, row])),
        knownRefs,
        relevanceDefaults,
        newestRetrievedOn: fixtures.newestRetrievedOn,
        assignSlugs: registrySlugAssigner(registry),
        geometryFns: { fallbackRow, unionRow },
        blockSums,
        countyZone: (geoid) => zoneForCounty(zones, state, geoid),
      });
      const counts: Record<string, number> = {
        ...output.counts,
        unit_without_district: withoutDistrict,
      };
      const files = await writeOutput(opts, output);
      const pl = meta.datasets[PL_DATASET];
      return {
        files,
        checks: output.checks.map((check) =>
          check.name === 'expand' ? expandCheck(counts) : check,
        ),
        datasets: blockSums !== null && pl !== undefined ? { [PL_DATASET]: pl } : {},
      };
    },
  };
}

/** Stage 4 with the registered rules modules. */
export const s04Expand: StageModule = makeS04Expand({ rulesFor });
