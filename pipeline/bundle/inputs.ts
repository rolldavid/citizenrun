// Step 1 of the bundle writer: the newest complete output of every stage and state it merges.
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BElectionSchema,
  BFilingTrackSchema,
  BGeometrySchema,
  BGivenNameAliasSchema,
  BJurisdictionSchema,
  BOfficePowerSchema,
  BOfficeSchema,
  BOfficeholderSchema,
  BPersonAliasSchema,
  BPersonSchema,
  BZipCentroidSchema,
  Hex64Schema,
} from '@citizenrun/shared';
import type {
  BDistrict,
  BDistrictFallback,
  BElection,
  BFilingTrack,
  BGeometry,
  BGivenNameAlias,
  BJurisdiction,
  BOffice,
  BOfficePower,
  BOfficeholder,
  BPerson,
  BPersonAlias,
  BZipCentroid,
} from '@citizenrun/shared';
import { z } from 'zod';
import { bucketKeys } from '../lib/bucket.ts';
import { loadBoundarySources } from '../lib/data-files.ts';
import type { BoundarySource } from '../lib/data-files.ts';
import { FactSchema } from '../lib/facts.ts';
import type { Fact } from '../lib/facts.ts';
import { HostRegistry, readQueue } from '../lib/fetch/hosts.ts';
import { readStageMeta, verifyStageOutput } from '../lib/runner.ts';
import type { RunContext, StageId, StageMeta } from '../lib/runner.ts';
import { LISTING_DATASET, PARSED_LISTING_FILE, readParsedListing } from '../sources/census-gus.ts';
import { OFFICE_REFS_FILE, OfficeRefRowSchema } from '../stages/shared/office-ref.ts';
import type { OfficeRefRow } from '../stages/shared/office-ref.ts';
import { loadStageRows, newestFailure } from '../stages/shared/stage-io.ts';
import { QuoteRowSchema, S03_FILES, readTemplateOutput } from '../templates/output.ts';
import type { QuoteRow, TemplateOutput } from '../templates/output.ts';

/** One row of a stage's `coverage` file: stage 1's counters. */
export const CoverageRowSchema = z.strictObject({
  name: z.string().min(1).max(200),
  value: z.int().min(0),
});
export type CoverageRow = z.infer<typeof CoverageRowSchema>;

/** One row of stage 9's `assets` file: a stored photo a person of the output uses. */
export const AssetRowSchema = z.strictObject({
  path: z.string().regex(/^assets\/photos\/[0-9a-f]{64}\.jpg$/),
  sha256: Hex64Schema,
  bytes: z.int().min(1).max(20_000_000),
  width: z.int().min(1),
  height: z.int().min(1),
  content_type: z.literal('image/jpeg'),
});
export type AssetRow = z.infer<typeof AssetRowSchema>;

export type StageFailure = NonNullable<Awaited<ReturnType<typeof newestFailure>>>;

export type StateInputs = {
  readonly state: string;
  /** The state's FIPS code, from stage 1's `tiger:state:<fips>` district; null when it has none. */
  readonly fips: string | null;
  readonly base: {
    readonly meta: StageMeta;
    readonly failure: StageFailure | null;
    readonly jurisdictions: readonly BJurisdiction[];
    readonly districts: readonly BDistrict[];
    readonly district_fallbacks: readonly BDistrictFallback[];
    readonly geometry: readonly BGeometry[];
    readonly coverage: readonly CoverageRow[];
  };
  readonly known: {
    readonly meta: StageMeta | null;
    readonly offices: readonly BOffice[];
    readonly office_powers: readonly BOfficePower[];
    readonly people: readonly BPerson[];
    readonly officeholders: readonly BOfficeholder[];
    readonly office_refs: readonly OfficeRefRow[];
  };
  readonly coops: {
    readonly meta: StageMeta | null;
    readonly jurisdictions: readonly BJurisdiction[];
    readonly districts: readonly BDistrict[];
    readonly district_fallbacks: readonly BDistrictFallback[];
    readonly geometry: readonly BGeometry[];
    readonly offices: readonly BOffice[];
    readonly office_powers: readonly BOfficePower[];
    readonly people: readonly BPerson[];
    readonly officeholders: readonly BOfficeholder[];
    readonly office_refs: readonly OfficeRefRow[];
    readonly facts: readonly Fact[];
  };
  readonly templates: {
    readonly meta: StageMeta | null;
    readonly failure: StageFailure | null;
    readonly output: TemplateOutput | null;
    readonly quotes: readonly QuoteRow[];
  };
  readonly expand: {
    readonly meta: StageMeta | null;
    readonly offices: readonly BOffice[];
    readonly office_powers: readonly BOfficePower[];
    readonly elections: readonly BElection[];
    readonly jurisdictions: readonly BJurisdiction[];
    readonly districts: readonly BDistrict[];
    readonly district_fallbacks: readonly BDistrictFallback[];
    readonly geometry: readonly BGeometry[];
    readonly office_refs: readonly OfficeRefRow[];
  };
  readonly deadlines: {
    readonly meta: StageMeta | null;
    readonly filing_tracks: readonly BFilingTrack[];
    readonly facts: readonly Fact[];
  };
  readonly people: {
    readonly meta: StageMeta | null;
    readonly people: readonly BPerson[];
    readonly person_aliases: readonly BPersonAlias[];
    readonly officeholders: readonly BOfficeholder[];
    readonly assets: readonly AssetRow[];
  };
  /** Hosts marked `blocked_from_ci` whose queue names the state, and challenged quote hosts. */
  readonly blockedHosts: readonly string[];
};

export type BundleInputs = {
  /** The states with a complete stage 1 output, sorted. */
  readonly states: readonly StateInputs[];
  /** States with a stage 1 failure record and no complete output, sorted, with that failure. */
  readonly missing: readonly { readonly state: string; readonly failure: StageFailure }[];
  readonly zipCentroids: readonly BZipCentroid[];
  readonly zipMeta: StageMeta | null;
  readonly givenNameAliases: readonly BGivenNameAlias[];
  readonly givenNameMeta: StageMeta | null;
  /** Listing rows with a non-empty web address, by state FIPS, from the edition stage 1 used. */
  readonly listingWebsites: ReadonlyMap<string, number>;
  readonly boundarySources: readonly BoundarySource[];
};

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** A reader of one stage's complete output for one state; every file reads as [] without one. */
async function stageReader(ctx: RunContext, stage: StageId, state: string) {
  const meta = (await verifyStageOutput(ctx.bucket, stage, state))
    ? await readStageMeta(ctx.bucket, stage, state)
    : null;
  const rows = async <T>(name: string, schema: z.ZodType<T>): Promise<readonly T[]> =>
    meta === null ? [] : ((await loadStageRows(ctx, stage, state, name, schema)) ?? []);
  return { meta, rows };
}

const STATE_FILE = /^([A-Z]{2})\/(?:_meta\.json|_failed-[A-Za-z0-9-]{1,64}\.json)$/;

/** The states (never `US`) with a stage 1 `_meta.json` or failure record, sorted. */
export async function baseStates(ctx: RunContext): Promise<readonly string[]> {
  const sample = bucketKeys.stageMeta('s01-base', 'US');
  const prefix = sample.slice(0, sample.length - 'US/_meta.json'.length);
  const found = new Set<string>();
  for await (const info of ctx.bucket.list(prefix)) {
    const state = STATE_FILE.exec(info.key.slice(prefix.length))?.[1];
    if (state !== undefined && state !== 'US') {
      found.add(state);
    }
  }
  return [...found].sort(byteOrder);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function blockedHostsByState(ctx: RunContext): Promise<ReadonlyMap<string, Set<string>>> {
  const registry = new HostRegistry(ctx.bucket);
  await registry.load();
  const out = new Map<string, Set<string>>();
  for (const host of registry.blockedHosts()) {
    for (const entry of await readQueue(ctx.bucket, host)) {
      if (entry.state === null) {
        continue;
      }
      const set = out.get(entry.state) ?? new Set<string>();
      set.add(host);
      out.set(entry.state, set);
    }
  }
  return out;
}

async function listingWebsites(
  ctx: RunContext,
  editions: ReadonlySet<string>,
): Promise<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>();
  for (const edition of [...editions].sort(byteOrder)) {
    const key = bucketKeys.dataset(LISTING_DATASET, edition, PARSED_LISTING_FILE);
    if ((await ctx.bucket.head(key)) === null) {
      continue;
    }
    for await (const row of readParsedListing(ctx, edition)) {
      if (row.web_address !== null && row.web_address.trim() !== '') {
        counts.set(row.fips_state, (counts.get(row.fips_state) ?? 0) + 1);
      }
    }
  }
  return counts;
}

async function readState(
  ctx: RunContext,
  state: string,
  baseMeta: StageMeta,
  baseFailure: StageFailure | null,
  blocked: ReadonlySet<string>,
): Promise<StateInputs> {
  const base = await stageReader(ctx, 's01-base', state);
  const known = await stageReader(ctx, 's02-known', state);
  const coops = await stageReader(ctx, 's02-coops', state);
  const templates = await stageReader(ctx, 's03-templates', state);
  const expand = await stageReader(ctx, 's04-expand', state);
  const deadlines = await stageReader(ctx, 's05-deadlines', state);
  const people = await stageReader(ctx, 's09-people', state);
  const districts = await base.rows('districts', BDistrictSchema);
  const stateDistrict = districts.find((row) => row.source_key.startsWith('tiger:state:'));
  const quotes = await templates.rows(S03_FILES.quotes, QuoteRowSchema);
  const hosts = new Set(blocked);
  for (const quote of quotes) {
    const host = quote.reason === 'challenge' ? hostOf(quote.source_url) : null;
    if (host !== null) {
      hosts.add(host);
    }
  }
  return {
    state,
    fips:
      stateDistrict === undefined ? null : stateDistrict.source_key.slice('tiger:state:'.length),
    base: {
      meta: baseMeta,
      failure: baseFailure,
      jurisdictions: await base.rows('jurisdictions', BJurisdictionSchema),
      districts,
      district_fallbacks: await base.rows('district_fallbacks', BDistrictFallbackSchema),
      geometry: await base.rows('geometry', BGeometrySchema),
      coverage: await base.rows('coverage', CoverageRowSchema),
    },
    known: {
      meta: known.meta,
      offices: await known.rows('offices', BOfficeSchema),
      office_powers: await known.rows('office_powers', BOfficePowerSchema),
      people: await known.rows('people', BPersonSchema),
      officeholders: await known.rows('officeholders', BOfficeholderSchema),
      office_refs: await known.rows(OFFICE_REFS_FILE, OfficeRefRowSchema),
    },
    coops: {
      meta: coops.meta,
      jurisdictions: await coops.rows('jurisdictions', BJurisdictionSchema),
      districts: await coops.rows('districts', BDistrictSchema),
      district_fallbacks: await coops.rows('district_fallbacks', BDistrictFallbackSchema),
      geometry: await coops.rows('geometry', BGeometrySchema),
      offices: await coops.rows('offices', BOfficeSchema),
      office_powers: await coops.rows('office_powers', BOfficePowerSchema),
      people: await coops.rows('people', BPersonSchema),
      officeholders: await coops.rows('officeholders', BOfficeholderSchema),
      office_refs: await coops.rows(OFFICE_REFS_FILE, OfficeRefRowSchema),
      facts: await coops.rows('facts', FactSchema),
    },
    templates: {
      meta: templates.meta,
      failure: await newestFailure(ctx, 's03-templates', state),
      output: templates.meta === null ? null : await readTemplateOutput(ctx, state),
      quotes,
    },
    expand: {
      meta: expand.meta,
      offices: await expand.rows('offices', BOfficeSchema),
      office_powers: await expand.rows('office_powers', BOfficePowerSchema),
      elections: await expand.rows('elections', BElectionSchema),
      jurisdictions: await expand.rows('jurisdictions', BJurisdictionSchema),
      districts: await expand.rows('districts', BDistrictSchema),
      district_fallbacks: await expand.rows('district_fallbacks', BDistrictFallbackSchema),
      geometry: await expand.rows('geometry', BGeometrySchema),
      office_refs: await expand.rows(OFFICE_REFS_FILE, OfficeRefRowSchema),
    },
    deadlines: {
      meta: deadlines.meta,
      filing_tracks: await deadlines.rows('filing_tracks', BFilingTrackSchema),
      facts: await deadlines.rows('facts', FactSchema),
    },
    people: {
      meta: people.meta,
      people: await people.rows('people', BPersonSchema),
      person_aliases: await people.rows('person_aliases', BPersonAliasSchema),
      officeholders: await people.rows('officeholders', BOfficeholderSchema),
      assets: await people.rows('assets', AssetRowSchema),
    },
    blockedHosts: [...hosts].sort(byteOrder),
  };
}

/**
 * The bundle's inputs for `states`: each state with a complete stage 1 output is read whole (a
 * missing output of a later stage reads as empty lists); a state with only a stage 1 failure
 * record is listed as missing; a state with neither is left out.
 */
export async function readInputs(
  ctx: RunContext,
  states: readonly string[],
): Promise<BundleInputs> {
  const blocked = await blockedHostsByState(ctx);
  const read: StateInputs[] = [];
  const missing: { state: string; failure: StageFailure }[] = [];
  const editions = new Set<string>();
  for (const state of [...new Set(states)].sort(byteOrder)) {
    const failure = await newestFailure(ctx, 's01-base', state);
    const complete = await verifyStageOutput(ctx.bucket, 's01-base', state);
    const meta = complete ? await readStageMeta(ctx.bucket, 's01-base', state) : null;
    if (meta === null) {
      if (failure !== null) {
        missing.push({ state, failure });
      }
      continue;
    }
    const edition = meta.datasets[LISTING_DATASET]?.edition;
    if (edition !== undefined) {
      editions.add(edition);
    }
    read.push(await readState(ctx, state, meta, failure, blocked.get(state) ?? new Set()));
  }
  const zip = await stageReader(ctx, 's01-base', 'US');
  const given = await stageReader(ctx, 's09-people', 'US');
  return {
    states: read,
    missing,
    zipCentroids: await zip.rows('zip_centroids', BZipCentroidSchema),
    zipMeta: zip.meta,
    givenNameAliases: await given.rows('given_name_aliases', BGivenNameAliasSchema),
    givenNameMeta: given.meta,
    listingWebsites: await listingWebsites(ctx, editions),
    boundarySources: await loadBoundarySources(),
  };
}
