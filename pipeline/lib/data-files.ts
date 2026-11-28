// The source registers and override files under data/ (PIPE-data-registers): one strict schema and
// one loader each.
import { join } from 'node:path';
import {
  IanaZoneSchema,
  IsoDateSchema,
  PartySchema,
  RefIdSchema,
  SafeUrlSchema,
  SlugSchema,
  SourceKeySchema,
  StateCodeSchema,
  US_ZONE_NAMES,
  text,
} from '@citizenrun/shared';
import { z } from 'zod';
import type { SourceHostRules } from './fetch/hosts.ts';
import { dataDir } from './paths.ts';
import { PIPELINE_STATES } from './states.ts';
import { readYamlFile } from './yaml.ts';

const HostnameSchema = z
  .string()
  .max(253)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
    'not a lower-case host name',
  );
const SpdxSchema = z
  .string()
  .max(60)
  .regex(/^(LicenseRef-[A-Za-z0-9.-]+|[A-Za-z0-9][A-Za-z0-9.+-]*)$/, 'not an SPDX id');
const GeoidCountySchema = z.string().regex(/^\d{5}$/, 'not a five-digit county GEOID');
const RegisterIdSchema = RefIdSchema.max(100);

const SOURCE_KINDS = ['dataset', 'adapter', 'crawl_host', 'photo_source'] as const;
/** The kinds whose non-forbidden entries must record their terms and robots check. */
const KINDS_WITH_TERMS: ReadonlySet<string> = new Set(['dataset', 'adapter', 'photo_source']);
/** The start of an adapter's notes when its host challenged the terms and robots check. */
const CHALLENGED = /^Host challenged the check on (\d{4}-\d{2}-\d{2})/;

// --- data/sources.yaml ---

export const SourceEntrySchema = z.strictObject({
  id: RegisterIdSchema,
  kind: z.enum(SOURCE_KINDS),
  name: text(200),
  publisher: text(200),
  url: SafeUrlSchema,
  terms_url: SafeUrlSchema.nullable(),
  terms_read_on: IsoDateSchema.nullable(),
  basis: text(500),
  licence_spdx: SpdxSchema.nullable(),
  attribution: text(500).nullable(),
  robots_checked_on: IsoDateSchema.nullable(),
  ci_status: z.enum(['reachable', 'blocked', 'unknown']),
  notes: text(2000).nullable(),
  hosts: z.array(HostnameSchema).min(1).max(10).optional(),
  forbidden: z.boolean().default(false),
  results_host: z.boolean().default(false),
});
export type SourceEntry = z.infer<typeof SourceEntrySchema>;

export const SourcesFileSchema = z
  .array(SourceEntrySchema)
  .max(2000)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'duplicate source id' });
      }
      seen.add(entry.id);
      if (!KINDS_WITH_TERMS.has(entry.kind) || entry.forbidden) {
        return;
      }
      const challenged = entry.kind === 'adapter' ? CHALLENGED.exec(entry.notes ?? '') : null;
      if (challenged !== null) {
        // A host that challenged the check: its terms wait, and the robots date is the day of the check.
        if (entry.robots_checked_on !== challenged[1]) {
          ctx.addIssue({
            code: 'custom',
            path: [i, 'robots_checked_on'],
            message: 'a challenged adapter is robots-checked on the date its notes give',
          });
        }
        return;
      }
      for (const field of ['terms_url', 'terms_read_on', 'robots_checked_on'] as const) {
        if (entry[field] === null) {
          ctx.addIssue({
            code: 'custom',
            path: [i, field],
            message: `a ${entry.kind} entry that is not forbidden needs ${field}`,
          });
        }
      }
    });
  });

/** The hosts an entry spans: its `hosts`, else the host of its `url`. */
export function sourceHosts(entry: SourceEntry): readonly string[] {
  return entry.hosts ?? [new URL(entry.url).hostname.toLowerCase()];
}

/** The fetcher's host rules from the register: forbidden hosts and results hosts. */
export function sourceHostRules(entries: readonly SourceEntry[]): SourceHostRules {
  const collect = (keep: (entry: SourceEntry) => boolean): readonly string[] =>
    Object.freeze([...new Set(entries.filter(keep).flatMap(sourceHosts))]);
  return Object.freeze({
    forbiddenHosts: collect((entry) => entry.forbidden),
    resultsHosts: collect((entry) => entry.results_host),
  });
}

// --- the other registers ---

export const PhotoTermsEntrySchema = z.strictObject({
  jurisdiction_key: SourceKeySchema,
  host: HostnameSchema,
  terms_url: SafeUrlSchema,
  quote: text(2000),
  retrieved_on: IsoDateSchema,
});
export type PhotoTermsEntry = z.infer<typeof PhotoTermsEntrySchema>;

export const BoundarySourceSchema = z.strictObject({
  key: RegisterIdSchema,
  place_geoid: z.string().regex(/^\d{7}$/, 'not a seven-digit place GEOID'),
  url: SafeUrlSchema,
  publisher: text(200),
  licence_text: text(2000),
  retrieved_on: IsoDateSchema,
  label_field: text(100),
  /** Written before each label when the layer holds only the number ('District ' + '3'), D-901. */
  label_prefix: text(40).optional(),
  format: z.literal('geojson'),
});
export type BoundarySource = z.infer<typeof BoundarySourceSchema>;

export const RegistryEntrySchema = z.strictObject({
  state: StateCodeSchema,
  name: text(200),
  url: SafeUrlSchema,
  publisher: text(200),
  licence_text: text(2000),
  retrieved_on: IsoDateSchema,
  provides: z
    .array(z.enum(['boundaries', 'election_calendar', 'rosters', 'district_list']))
    .min(1)
    .max(4),
});
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export const CoopEinOverrideSchema = z.strictObject({
  eia_utility_number: z.int().min(1).max(99_999_999),
  ein: z.union([z.string().regex(/^\d{9}$/, 'not a nine-digit EIN'), z.literal('none')]),
  reason: text(500),
});
export type CoopEinOverride = z.infer<typeof CoopEinOverrideSchema>;

export const CountyNameOverrideSchema = z.strictObject({
  state: StateCodeSchema,
  eia_name: text(200),
  geoids: z.array(GeoidCountySchema).min(1).max(50),
});
export type CountyNameOverride = z.infer<typeof CountyNameOverrideSchema>;

export const UnitOverrideSchema = z
  .strictObject({
    pid6: z.string().regex(/^\d{6}$/, 'not a six-digit PID6'),
    website: SafeUrlSchema.optional(),
    name: text(200).optional(),
    // The unit's place code in the TIGER vintage in use, where the listing has an older one (D-887).
    fips_place: z
      .string()
      .regex(/^\d{5}$/, 'not a five-digit FIPS place code')
      .optional(),
    exclude: z.literal(true).optional(),
    reason: text(500),
  })
  .refine(
    (row) =>
      row.website !== undefined ||
      row.name !== undefined ||
      row.fips_place !== undefined ||
      row.exclude !== undefined,
    'an override sets website, name, fips_place or exclude',
  );
export type UnitOverride = z.infer<typeof UnitOverrideSchema>;

/** Lower-case and unaccented, as B-given_name_aliases stores them. */
const GivenNameSchema = z
  .string()
  .regex(/^[a-z][a-z' -]{0,40}$/, 'not a lower-case unaccented name');

export const NicknamePairSchema = z.strictObject({
  canonical: GivenNameSchema,
  alias: GivenNameSchema,
  note: text(200),
});
export type NicknamePair = z.infer<typeof NicknamePairSchema>;

function isConstructibleZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** An IANA zone the platform knows and a closing time can be shown in (US_ZONE_NAMES). */
const UsZoneSchema = IanaZoneSchema.refine(isConstructibleZone, 'not an IANA time zone').refine(
  (zone) => !isConstructibleZone(zone) || Object.hasOwn(US_ZONE_NAMES, zone),
  'not a zone of US_ZONE_NAMES',
);

const FIPS_BY_STATE: ReadonlyMap<string, string> = new Map(
  PIPELINE_STATES.map((row) => [row.code, row.fips]),
);

export const TimezoneEntrySchema = z
  .strictObject({
    state: StateCodeSchema,
    default: UsZoneSchema,
    county_overrides: z
      .array(z.strictObject({ county_geoid: GeoidCountySchema, zone: UsZoneSchema }))
      .max(300),
    source_url: SafeUrlSchema,
    quote: text(2000),
    citation: text(300),
  })
  .superRefine((entry, ctx) => {
    const fips = FIPS_BY_STATE.get(entry.state);
    if (fips === undefined) {
      ctx.addIssue({ code: 'custom', path: ['state'], message: 'not one of the 50 states or DC' });
    }
    const seen = new Set<string>();
    entry.county_overrides.forEach((override, i) => {
      if (fips !== undefined && !override.county_geoid.startsWith(fips)) {
        ctx.addIssue({
          code: 'custom',
          path: ['county_overrides', i, 'county_geoid'],
          message: 'the county is outside the entry state',
        });
      }
      if (seen.has(override.county_geoid)) {
        ctx.addIssue({
          code: 'custom',
          path: ['county_overrides', i, 'county_geoid'],
          message: 'the county is listed twice',
        });
      }
      seen.add(override.county_geoid);
      if (override.zone === entry.default) {
        ctx.addIssue({
          code: 'custom',
          path: ['county_overrides', i, 'zone'],
          message: 'an override names a zone other than the default',
        });
      }
    });
  });
export type TimezoneEntry = z.infer<typeof TimezoneEntrySchema>;

export const TimezonesFileSchema = z
  .array(TimezoneEntrySchema)
  .max(51)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      if (seen.has(entry.state)) {
        ctx.addIssue({ code: 'custom', path: [i, 'state'], message: 'the state has two entries' });
      }
      seen.add(entry.state);
    });
  });

const PartyLabelSchema = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+([ -][a-z0-9]+)*$/, 'not a lower-case label');

export const PartiesFileSchema = z
  .strictObject({
    aliases: z.record(PartySchema, z.array(PartyLabelSchema).min(1).max(50)),
    nonpartisan: z.array(PartyLabelSchema).max(50),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>(file.nonpartisan);
    for (const [key, labels] of Object.entries(file.aliases)) {
      labels.forEach((label, i) => {
        if (seen.has(label)) {
          ctx.addIssue({
            code: 'custom',
            path: ['aliases', key, i],
            message: 'the label is listed twice',
          });
        }
        seen.add(label);
      });
    }
  });
export type PartiesFile = z.infer<typeof PartiesFileSchema>;

// --- data/snapshot-sources.yaml ---

/** A value still to be recorded: `<...>`. */
export const MARKER = /^<[^<>]+>$/;

function isRecipeUrl(value: string): boolean {
  return SafeUrlSchema.safeParse(value.replaceAll('{election_id}', '0')).success;
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** A recipe string: a marker, or a value that passes `check`. */
function recipeValue(max: number, check: (value: string) => boolean, message: string) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => MARKER.test(value) || check(value), message);
}

const RecipeUrlSchema = recipeValue(2048, isRecipeUrl, 'not an https URL or a <...> marker');
const RecipeTextSchema = recipeValue(
  200,
  (value) => text(200).safeParse(value).success,
  'not text',
);

export const SnapshotRecipeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('get'), url: RecipeUrlSchema }),
  z.strictObject({
    kind: z.literal('discover_get'),
    page: RecipeUrlSchema,
    link_pattern: recipeValue(300, compiles, 'not a regular expression or a <...> marker'),
  }),
  z.strictObject({
    kind: z.literal('playwright_export'),
    url: RecipeUrlSchema,
    election_ids_from: RecipeUrlSchema.optional(),
    election_select: RecipeTextSchema.optional(),
    export_button_text: RecipeTextSchema,
  }),
]);
export type SnapshotRecipe = z.infer<typeof SnapshotRecipeSchema>;

export const SnapshotSourceSchema = z
  .strictObject({
    source: SlugSchema,
    state: StateCodeSchema,
    always: z.boolean(),
    windows: z
      .array(z.strictObject({ from: IsoDateSchema, to: IsoDateSchema }))
      .max(20)
      .optional(),
    blocked: z.boolean().optional(),
    recipe: SnapshotRecipeSchema,
  })
  .superRefine((entry, ctx) => {
    (entry.windows ?? []).forEach((window, i) => {
      if (window.from > window.to) {
        ctx.addIssue({
          code: 'custom',
          path: ['windows', i],
          message: 'a window ends before it starts',
        });
      }
    });
    if (!entry.always && (entry.windows ?? []).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['windows'],
        message: 'an entry that is not always needs a window',
      });
    }
  });
export type SnapshotSource = z.infer<typeof SnapshotSourceSchema>;

export const SnapshotSourcesFileSchema = z
  .array(SnapshotSourceSchema)
  .max(500)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      if (seen.has(entry.source)) {
        ctx.addIssue({ code: 'custom', path: [i, 'source'], message: 'duplicate source' });
      }
      seen.add(entry.source);
    });
  });

/** True when a recipe value of the entry is still a `<...>` marker; the archiver refuses such an entry. */
export function hasMarker(entry: SnapshotSource): boolean {
  return Object.values(entry.recipe).some(
    (value) => typeof value === 'string' && MARKER.test(value),
  );
}

// --- loaders ---

/** The register files and their schemas, by file name under data/. */
export const REGISTER_FILES = Object.freeze({
  sources: { file: 'sources.yaml', schema: SourcesFileSchema },
  photoTerms: { file: 'photo_terms.yaml', schema: z.array(PhotoTermsEntrySchema).max(5000) },
  boundarySources: {
    file: 'boundary_sources.yaml',
    schema: z.array(BoundarySourceSchema).max(5000),
  },
  registries: { file: 'registries.yaml', schema: z.array(RegistryEntrySchema).max(500) },
  coopEinOverrides: {
    file: 'coop_ein_overrides.yaml',
    schema: z.array(CoopEinOverrideSchema).max(5000),
  },
  countyNameOverrides: {
    file: 'county-name-overrides.yaml',
    schema: z.array(CountyNameOverrideSchema).max(5000),
  },
  unitOverrides: { file: 'unit-overrides.yaml', schema: z.array(UnitOverrideSchema).max(20_000) },
  nicknameSupplement: {
    file: 'nicknames-supplement.yaml',
    schema: z.array(NicknamePairSchema).max(5000),
  },
  snapshotSources: { file: 'snapshot-sources.yaml', schema: SnapshotSourcesFileSchema },
  timezones: { file: 'timezones.yaml', schema: TimezonesFileSchema },
  parties: { file: 'parties.yaml', schema: PartiesFileSchema },
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

async function load<T>(dir: string, file: string, schema: z.ZodType<T>): Promise<T> {
  return deepFreeze(await readYamlFile(join(dir, file), schema));
}

export function loadSources(dir: string = dataDir()): Promise<readonly SourceEntry[]> {
  return load(dir, REGISTER_FILES.sources.file, REGISTER_FILES.sources.schema);
}

export function loadPhotoTerms(dir: string = dataDir()): Promise<readonly PhotoTermsEntry[]> {
  return load(dir, REGISTER_FILES.photoTerms.file, REGISTER_FILES.photoTerms.schema);
}

export function loadBoundarySources(dir: string = dataDir()): Promise<readonly BoundarySource[]> {
  return load(dir, REGISTER_FILES.boundarySources.file, REGISTER_FILES.boundarySources.schema);
}

export function loadRegistries(dir: string = dataDir()): Promise<readonly RegistryEntry[]> {
  return load(dir, REGISTER_FILES.registries.file, REGISTER_FILES.registries.schema);
}

export function loadCoopEinOverrides(dir: string = dataDir()): Promise<readonly CoopEinOverride[]> {
  return load(dir, REGISTER_FILES.coopEinOverrides.file, REGISTER_FILES.coopEinOverrides.schema);
}

export function loadCountyNameOverrides(
  dir: string = dataDir(),
): Promise<readonly CountyNameOverride[]> {
  return load(
    dir,
    REGISTER_FILES.countyNameOverrides.file,
    REGISTER_FILES.countyNameOverrides.schema,
  );
}

export function loadUnitOverrides(dir: string = dataDir()): Promise<readonly UnitOverride[]> {
  return load(dir, REGISTER_FILES.unitOverrides.file, REGISTER_FILES.unitOverrides.schema);
}

export function loadNicknameSupplement(dir: string = dataDir()): Promise<readonly NicknamePair[]> {
  return load(
    dir,
    REGISTER_FILES.nicknameSupplement.file,
    REGISTER_FILES.nicknameSupplement.schema,
  );
}

export function loadSnapshotSources(dir: string = dataDir()): Promise<readonly SnapshotSource[]> {
  return load(dir, REGISTER_FILES.snapshotSources.file, REGISTER_FILES.snapshotSources.schema);
}

export function loadTimezones(dir: string = dataDir()): Promise<readonly TimezoneEntry[]> {
  return load(dir, REGISTER_FILES.timezones.file, REGISTER_FILES.timezones.schema);
}

export function loadParties(dir: string = dataDir()): Promise<PartiesFile> {
  return load(dir, REGISTER_FILES.parties.file, REGISTER_FILES.parties.schema);
}
