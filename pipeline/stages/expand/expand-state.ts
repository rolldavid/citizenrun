// Stage 4's pure core (PIPE-expand): a template, a state's units, its rules module and today give
// the state's offices, powers, party jurisdictions, created districts with their fallback and
// geometry rows, office references and elections. It reads no clock, bucket or network.
import { BOfficePowerSchema, BOfficeSchema, officeSlugBase } from '@citizenrun/shared';
import type {
  BDistrict,
  BDistrictFallback,
  BElection,
  BGeometry,
  BJurisdiction,
  BOffice,
  BOfficePower,
} from '@citizenrun/shared';
import type { StateRules } from '@citizenrun/rules';
import type { TemplateOutput } from '../../templates/output.ts';
import { nextElecting } from '../shared/contests.ts';
import { OfficeRefRowSchema } from '../shared/office-ref.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';
import type { RelevanceDefaults } from '../shared/reference.ts';
import { fallbackDistricts } from './districts.ts';
import { buildElections } from './elections.ts';
import { templatePatternErrors } from './match.ts';
import { unitOffices } from './offices.ts';
import type { DraftOffice, FallbackPlan, OfficeContext } from './offices.ts';
import { partyCommittees } from './party.ts';
import type { BlockSumInput } from './population.ts';
import { countyUnionDistricts, statewideOffices } from './statewide.ts';
import type { ExpandUnit } from './units.ts';

export type ExpandInput = {
  readonly template: TemplateOutput;
  readonly units: readonly ExpandUnit[];
  readonly rules: StateRules | null;
  readonly today: string;
  readonly now: Date;
  readonly state: string;
  readonly stateFips: string;
  readonly stateName: string;
  /** Stage 1's, for the ward lookup and the fallback geometry. */
  readonly districts: readonly BDistrict[];
  readonly geometry: ReadonlyMap<string, BGeometry>;
  readonly knownRefs: readonly OfficeRefRow[];
  /** loadRelevanceDefaults(repoRoot()) of the stage frame. */
  readonly relevanceDefaults: RelevanceDefaults;
  readonly newestRetrievedOn: string | null;
  readonly assignSlugs: (
    requests: readonly { identity: string; base: string }[],
  ) => ReadonlyMap<string, string>;
  readonly geometryFns: {
    readonly fallbackRow: (key: string, via: readonly BGeometry[]) => Promise<BGeometry>;
    readonly unionRow: (
      key: string,
      counties: readonly BGeometry[],
      stateFips: string,
    ) => Promise<BGeometry>;
  };
  /** Absent or null: every county union's population and population_18 null. */
  readonly blockSums?: BlockSumInput | null;
  /** Absent: party jurisdictions' timezone null. */
  readonly countyZone?: (countyGeoid: string) => string | null;
};

export type ExpandCheck = {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type ExpandOutput = {
  readonly offices: readonly BOffice[];
  readonly officePowers: readonly BOfficePower[];
  readonly elections: readonly BElection[];
  readonly jurisdictions: readonly BJurisdiction[];
  readonly districts: readonly BDistrict[];
  readonly districtFallbacks: readonly BDistrictFallback[];
  readonly geometry: readonly BGeometry[];
  readonly officeRefs: readonly OfficeRefRow[];
  /** In StageResult's shape: no blocking flag. */
  readonly checks: readonly ExpandCheck[];
  readonly counts: Record<string, number>;
};

/** The counts of the non-blocking `expand` check, in the order its detail lists them. */
export const EXPAND_COUNTS = [
  'offices',
  'placeholder',
  'inactive_unit_skipped',
  'unit_without_district',
  'seats_vs_body',
  'stagger_by_district_unmapped',
  'rules_missing',
  'elections',
  'union_population_unknown',
] as const;

export const SLUG_UNIQUE = 'slug_unique';
export const TEMPLATE_PATTERN = 'template_pattern';
export const EXPAND_CHECK = 'expand';
/** The paths a failed check names in its detail. */
const DETAIL_ITEMS = 5;

/** The non-blocking `expand` check: every count as `name=count`. */
export function expandCheck(counts: Readonly<Record<string, number>>): ExpandCheck {
  return {
    name: EXPAND_CHECK,
    passed: true,
    detail: EXPAND_COUNTS.map((name) => `${name}=${String(counts[name] ?? 0)}`).join(' '),
  };
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function bySourceKey<T extends { readonly source_key: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => byteOrder(a.source_key, b.source_key));
}

function zeroCounts(): Record<string, number> {
  return Object.fromEntries(EXPAND_COUNTS.map((name) => [name, 0]));
}

const NO_OUTPUT = {
  offices: [],
  officePowers: [],
  elections: [],
  jurisdictions: [],
  districts: [],
  districtFallbacks: [],
  geometry: [],
  officeRefs: [],
} as const;

/** Stage 4 for one state. Async only for the geometry rows. */
export async function expandState(input: ExpandInput): Promise<ExpandOutput> {
  const template = input.template.template;
  const counts = zeroCounts();

  // Patterns the validator cannot check: one that does not compile fails the state.
  const badPatterns = templatePatternErrors(template);
  if (badPatterns.length > 0) {
    return {
      ...NO_OUTPUT,
      checks: [
        { name: SLUG_UNIQUE, passed: true, detail: 'not_run' },
        {
          name: TEMPLATE_PATTERN,
          passed: false,
          detail: `errors=${String(badPatterns.length)} paths=${badPatterns.slice(0, DETAIL_ITEMS).join(',')}`,
        },
        expandCheck(counts),
      ],
      counts,
    };
  }

  // County unions first: their population is the population of the offices on them.
  const unions = await countyUnionDistricts({
    template,
    out: input.template,
    state: input.state,
    stateFips: input.stateFips,
    blockSums: input.blockSums ?? null,
    geometry: input.geometry,
    unionRow: input.geometryFns.unionRow,
  });
  counts['union_population_unknown'] = unions.unknownPopulation;
  const districtsByKey = new Map<string, BDistrict>();
  for (const district of [...input.districts, ...unions.districts]) {
    districtsByKey.set(district.source_key, district);
  }
  const geometryByKey = new Map(input.geometry);
  for (const row of unions.geometry) {
    geometryByKey.set(row.source_key, row);
  }

  const ctx: OfficeContext = {
    out: input.template,
    rules: input.rules,
    state: input.state,
    today: input.today,
    now: input.now,
    relevanceDefaults: input.relevanceDefaults,
    newestRetrievedOn: input.newestRetrievedOn,
    districtKeys: new Set(input.districts.map((d) => d.source_key)),
    unionPopulations: new Map(unions.districts.map((d) => [d.source_key, d.population])),
  };

  const drafts: DraftOffice[] = [];
  const plans: FallbackPlan[] = [];
  for (const unit of input.units) {
    const made = unitOffices(unit, template, ctx);
    if (made.outcome === 'inactive') {
      counts['inactive_unit_skipped'] = (counts['inactive_unit_skipped'] ?? 0) + 1;
    } else if (made.outcome === 'placeholder') {
      counts['placeholder'] = (counts['placeholder'] ?? 0) + 1;
    }
    drafts.push(...made.drafts);
    plans.push(...made.fallbacks);
    counts['stagger_by_district_unmapped'] =
      (counts['stagger_by_district_unmapped'] ?? 0) + made.staggerUnmapped;
  }
  const statewide = statewideOffices({
    template,
    ctx,
    stateFips: input.stateFips,
    stateName: input.stateName,
    statePopulation: districtsByKey.get(`tiger:state:${input.stateFips}`)?.population ?? null,
  });
  drafts.push(...statewide.drafts);
  plans.push(...statewide.fallbacks);
  counts['stagger_by_district_unmapped'] =
    (counts['stagger_by_district_unmapped'] ?? 0) + statewide.staggerUnmapped;
  const party = await partyCommittees({
    template,
    ctx,
    districts: input.districts,
    geometry: geometryByKey,
    countyZone: input.countyZone,
    fallbackRow: input.geometryFns.fallbackRow,
  });
  drafts.push(...party.drafts);
  const created = await fallbackDistricts({
    plans,
    districts: districtsByKey,
    geometry: geometryByKey,
    fallbackRow: input.geometryFns.fallbackRow,
  });

  // Slugs (PIPE-slugs): one call for every office of the state.
  const assigned = input.assignSlugs(
    drafts.map((d) => ({
      identity: d.identity,
      base: officeSlugBase(input.state, d.jurisdictionName, d.office.title),
    })),
  );
  const unassigned: string[] = [];
  const holders = new Map<string, number>();
  const placed: { draft: DraftOffice; slug: string }[] = [];
  for (const draft of drafts) {
    const slug = assigned.get(draft.identity);
    if (slug === undefined) {
      unassigned.push(draft.identity);
      continue;
    }
    holders.set(slug, (holders.get(slug) ?? 0) + 1);
    placed.push({ draft, slug });
  }
  const duplicates = [...holders].filter(([, n]) => n > 1).map(([slug]) => slug);
  const slugCheck: ExpandCheck = {
    name: SLUG_UNIQUE,
    passed: unassigned.length === 0 && duplicates.length === 0,
    detail: `unassigned=${String(unassigned.length)} duplicate=${String(duplicates.length)}`,
  };
  const kept = placed
    .filter(({ slug }) => (holders.get(slug) ?? 0) === 1)
    .map(({ draft, slug }) => ({
      draft,
      slug,
      ref: OfficeRefRowSchema.parse({ slug, ...draft.ref }),
    }));
  if (input.rules === null) {
    counts['rules_missing'] = 1;
  }
  const { elections, contestsBySlug } = buildElections({
    refs: [
      ...kept.map(({ draft, ref }) => ({ ref, statewide: draft.statewide })),
      ...input.knownRefs.map((ref) => ({ ref, statewide: false })),
    ],
    rules: input.rules,
    state: input.state,
    today: input.today,
    now: input.now,
    newestRetrievedOn: input.newestRetrievedOn,
  });

  const offices: BOffice[] = [];
  const powers: BOfficePower[] = [];
  for (const { draft, slug } of kept) {
    let seatsUpNext: number | null = null;
    if (draft.seatsUpNext === 'contests') {
      seatsUpNext = nextElecting(contestsBySlug.get(slug) ?? [], input.today)?.seatsUp ?? null;
    }
    const bodySize = draft.office.body_size;
    if (seatsUpNext !== null && bodySize !== null && seatsUpNext > bodySize) {
      seatsUpNext = null;
      counts['seats_vs_body'] = (counts['seats_vs_body'] ?? 0) + 1;
    }
    offices.push(
      BOfficeSchema.parse({ source_key: slug, slug, ...draft.office, seats_up_next: seatsUpNext }),
    );
    for (const power of draft.powers) {
      powers.push(
        BOfficePowerSchema.parse({
          source_key: `${slug}|${power.power_id}`,
          office_key: slug,
          ...power,
        }),
      );
    }
  }
  counts['offices'] = offices.length;
  counts['elections'] = elections.length;

  return {
    offices: bySourceKey(offices),
    officePowers: bySourceKey(powers),
    elections: bySourceKey([...elections]),
    jurisdictions: bySourceKey([...party.jurisdictions]),
    districts: bySourceKey([...unions.districts, ...party.districts, ...created.districts]),
    districtFallbacks: bySourceKey([...party.fallbacks, ...created.fallbacks]),
    geometry: bySourceKey([...unions.geometry, ...party.geometry, ...created.geometry]),
    officeRefs: kept.map(({ ref }) => ref).sort((a, b) => byteOrder(a.slug, b.slug)),
    checks: [
      slugCheck,
      { name: TEMPLATE_PATTERN, passed: true, detail: 'errors=0' },
      expandCheck(counts),
    ],
    counts,
  };
}
