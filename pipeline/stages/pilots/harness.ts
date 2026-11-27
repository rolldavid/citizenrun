// The pilot-state harness (PIPE-state-pilots): captures two counties' real stage 1 and stage 2 rows
// from the pipeline's home into a committed folder, and runs stage 4 and stage 5's pure cores over
// such a folder with a state's own rules module. A test helper with no test-runner import, so a
// scratch script may import it; only `capturePilotUnits` reads the bucket, and nothing here makes a
// request.
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StateRules } from '@citizenrun/rules';
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BGeometrySchema,
  BJurisdictionSchema,
  IsoInstantSchema,
  StateCodeSchema,
} from '@citizenrun/shared';
import type {
  BDistrict,
  BDistrictFallback,
  BElection,
  BFilingTrack,
  BGeometry,
  BJurisdiction,
  BOffice,
} from '@citizenrun/shared';
import { z } from 'zod';
import { encodeNdjsonGz, readNdjsonGz } from '../../lib/ndjson.ts';
import { readStageMeta } from '../../lib/runner.ts';
import type { RunContext } from '../../lib/runner.ts';
import { assignSlugs } from '../../lib/slug.ts';
import type { SlugRegistry } from '../../lib/slug.ts';
import { loadTimezoneRegister, zoneForCounty } from '../../lib/timezones.ts';
import {
  LISTING_DATASET,
  ParsedListingRowSchema,
  readParsedListing,
} from '../../sources/census-gus.ts';
import type { ParsedListingRow } from '../../sources/census-gus.ts';
import { citedNodes } from '../../templates/cited.ts';
import type { GroundedMark } from '../../templates/ground.ts';
import { readTemplateFile } from '../../templates/load.ts';
import { TemplateOutputSchema } from '../../templates/output.ts';
import type { TemplateOutput } from '../../templates/output.ts';
import type { StateTemplate } from '../../templates/schema.ts';
import { validateTemplateText } from '../../templates/validate.ts';
import { deadlinesState } from '../deadlines/deadlines-state.ts';
import type { DeadlinesOutput } from '../deadlines/deadlines-state.ts';
import { expandState } from '../expand/expand-state.ts';
import type { ExpandOutput } from '../expand/expand-state.ts';
import { unitsFor } from '../expand/units.ts';
import { fallbackRow, unionRow } from '../shared/geometry-rows.ts';
import { OFFICE_REFS_FILE, OfficeRefRowSchema } from '../shared/office-ref.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';
import { loadReferenceIds, loadRelevanceDefaults } from '../shared/reference.ts';
import { repoRoot } from '../shared/repo.ts';
import { rulesFixtureInfo } from '../shared/rules-fixtures.ts';
import { loadStageRows } from '../shared/stage-io.ts';

export const PILOT_FILES = [
  'jurisdictions',
  'districts',
  'district_fallbacks',
  'geometry',
  'listing',
  'known_refs',
] as const;
export type PilotFile = (typeof PILOT_FILES)[number];
export const PILOT_FIXTURE_MAX_BYTES = 2_000_000;

export const CaptureRecordSchema = z.strictObject({
  state: StateCodeSchema,
  counties: z
    .array(z.string().regex(/^\d{5}$/))
    .min(1)
    .max(4),
  captured_at: IsoInstantSchema,
  stage1_finished_at: IsoInstantSchema,
  stage2_finished_at: IsoInstantSchema.nullable(),
  census_gus_edition: z.string().min(1).max(20),
  rows: z.record(z.enum(PILOT_FILES), z.int().min(0)),
  transformations: z.array(z.string().min(1).max(200)).min(1).max(10),
});
export type CaptureRecord = z.infer<typeof CaptureRecordSchema>;

export type PilotUnits = {
  readonly capture: CaptureRecord;
  readonly jurisdictions: readonly BJurisdiction[];
  readonly districts: readonly BDistrict[];
  readonly fallbacks: readonly BDistrictFallback[];
  readonly geometry: readonly BGeometry[];
  readonly listing: readonly ParsedListingRow[];
  readonly knownRefs: readonly OfficeRefRow[];
};

export type PilotRun = {
  readonly template: TemplateOutput;
  readonly expand: ExpandOutput;
  readonly deadlines: DeadlinesOutput;
};

/** A captured folder over PILOT_FIXTURE_MAX_BYTES; names the byte count only. */
export class PilotFixtureTooLarge extends Error {
  override readonly name = 'PilotFixtureTooLarge';
  readonly bytes: number;

  constructor(bytes: number) {
    super(
      `the pilot fixture folder holds ${String(bytes)} bytes, over the limit of ${String(PILOT_FIXTURE_MAX_BYTES)}`,
    );
    this.bytes = bytes;
  }
}

/** A pilot fixture file that is missing, unreadable, or whose row count differs from capture.json. */
export class PilotFixtureInvalid extends Error {
  override readonly name = 'PilotFixtureInvalid';
  readonly file: string;

  constructor(file: string, reason: string) {
    super(`the pilot fixture file ${file} is invalid: ${reason}`);
    this.file = file;
  }
}

/** A template that fails validation; carries the error paths, never a value. */
export class PilotTemplateInvalid extends Error {
  override readonly name = 'PilotTemplateInvalid';
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    super(`the template fails validation at ${paths.join(', ')}`);
    this.paths = paths;
  }
}

/** A stage output the capture needs and the home does not hold; names the input only. */
export class PilotCaptureInputMissing extends Error {
  override readonly name = 'PilotCaptureInputMissing';

  constructor(state: string, input: string) {
    super(`the pilot capture of ${state} has no ${input}`);
  }
}

const FILE_SUFFIX = '.ndjson.gz';
const CAPTURE_FILE = 'capture.json';

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function bySourceKey<T extends { readonly source_key: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => byteOrder(a.source_key, b.source_key));
}

/** The rows of a capture, in the order and with the changes the folder holds them. */
export type PilotRows = {
  readonly jurisdictions: readonly BJurisdiction[];
  readonly districts: readonly BDistrict[];
  readonly fallbacks: readonly BDistrictFallback[];
  readonly geometry: readonly BGeometry[];
  readonly listing: readonly ParsedListingRow[];
  readonly knownRefs: readonly OfficeRefRow[];
};

/**
 * The rows a capture keeps: the state's own jurisdiction; each `census:` unit whose listing row lies
 * in one of `counties`; every district of a kept unit and the state's `tiger:state:` district (never
 * the state's other districts: stage 2's refs carry their offices); each fallback row of a kept
 * district with its via district; their geometry rows, with `lookup_wkb` replaced by `display_wkb`
 * where a row has both; the kept units' listing rows; and every stage 2 office ref of the state.
 */
export function selectPilotRows(input: {
  readonly state: string;
  readonly counties: readonly string[];
  readonly jurisdictions: readonly BJurisdiction[];
  readonly districts: readonly BDistrict[];
  readonly fallbacks: readonly BDistrictFallback[];
  readonly geometry: readonly BGeometry[];
  readonly listing: Iterable<ParsedListingRow>;
  readonly knownRefs: readonly OfficeRefRow[];
}): PilotRows {
  const stateKey = `state:${input.state}`;
  const counties = new Set(input.counties);
  const censusPid6 = new Set(
    input.jurisdictions
      .filter((j) => j.source_key.startsWith('census:'))
      .map((j) => j.source_key.slice('census:'.length)),
  );
  const listing: ParsedListingRow[] = [];
  for (const row of input.listing) {
    if (
      censusPid6.has(row.pid6) &&
      row.fips_county !== null &&
      counties.has(`${row.fips_state}${row.fips_county}`)
    ) {
      listing.push(row);
    }
  }
  const keptUnits = new Set(listing.map((row) => `census:${row.pid6}`));
  const jurisdictions = input.jurisdictions.filter(
    (j) => j.source_key === stateKey || keptUnits.has(j.source_key),
  );
  const districtKeys = new Set(
    input.districts
      .filter(
        (d) =>
          keptUnits.has(d.jurisdiction_key) ||
          (d.jurisdiction_key === stateKey && d.source_key.startsWith('tiger:state:')),
      )
      .map((d) => d.source_key),
  );
  const fallbacks = input.fallbacks.filter((row) => districtKeys.has(row.district_key));
  for (const row of fallbacks) {
    districtKeys.add(row.via_district_key);
  }
  const districts = input.districts.filter((d) => districtKeys.has(d.source_key));
  const geometry = input.geometry
    .filter((row) => districtKeys.has(row.source_key))
    .map((row) =>
      row.lookup_wkb !== null && row.display_wkb !== null
        ? { ...row, lookup_wkb: row.display_wkb }
        : row,
    );
  return {
    jurisdictions: bySourceKey(jurisdictions),
    districts: bySourceKey(districts),
    fallbacks: bySourceKey(fallbacks),
    geometry: bySourceKey(geometry),
    listing: listing.sort((a, b) => byteOrder(a.pid6, b.pid6)),
    knownRefs: [...input.knownRefs].sort((a, b) => byteOrder(a.slug, b.slug)),
  };
}

function rowsOf(
  rows: PilotRows,
): Readonly<Record<PilotFile, readonly Readonly<Record<string, unknown>>[]>> {
  return {
    jurisdictions: rows.jurisdictions,
    districts: rows.districts,
    district_fallbacks: rows.fallbacks,
    geometry: rows.geometry,
    listing: rows.listing,
    known_refs: rows.knownRefs,
  };
}

/** Writes each of PILOT_FILES as `<dir>/<file>.ndjson.gz` with the deterministic writer. */
export async function writePilotFiles(
  dir: string,
  rows: PilotRows,
): Promise<Record<PilotFile, number>> {
  await mkdir(dir, { recursive: true });
  const files = rowsOf(rows);
  const counts = {} as Record<PilotFile, number>;
  for (const file of PILOT_FILES) {
    await writeFile(join(dir, `${file}${FILE_SUFFIX}`), encodeNdjsonGz(files[file]));
    counts[file] = files[file].length;
  }
  return counts;
}

/** Writes `<dir>/capture.json`: two-space indentation, keys in the schema's order, a final newline. */
export async function writeCaptureRecord(dir: string, record: CaptureRecord): Promise<void> {
  const parsed = CaptureRecordSchema.parse(record);
  const ordered: CaptureRecord = {
    state: parsed.state,
    counties: parsed.counties,
    captured_at: parsed.captured_at,
    stage1_finished_at: parsed.stage1_finished_at,
    stage2_finished_at: parsed.stage2_finished_at,
    census_gus_edition: parsed.census_gus_edition,
    rows: Object.fromEntries(PILOT_FILES.map((file) => [file, parsed.rows[file]])) as Record<
      PilotFile,
      number
    >,
    transformations: parsed.transformations,
  };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, CAPTURE_FILE), `${JSON.stringify(ordered, null, 2)}\n`);
}

async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await folderBytes(path);
    } else if (entry.isFile()) {
      total += (await stat(path)).size;
    }
  }
  return total;
}

/** Throws PilotFixtureTooLarge when the folder's files sum to more than PILOT_FIXTURE_MAX_BYTES. */
export async function assertPilotFixtureSize(dir: string): Promise<number> {
  const bytes = await folderBytes(dir);
  if (bytes > PILOT_FIXTURE_MAX_BYTES) {
    throw new PilotFixtureTooLarge(bytes);
  }
  return bytes;
}

async function requiredRows<T>(
  state: string,
  input: string,
  rows: Promise<readonly T[] | null>,
): Promise<readonly T[]> {
  const value = await rows;
  if (value === null) {
    throw new PilotCaptureInputMissing(state, input);
  }
  return value;
}

/**
 * Captures the real rows of `counties` (one to four county GEOIDs) of `state` from the pipeline's
 * home into `outDir`, with its `capture.json`. Run from a scratch script against the home, never
 * from a test. Logs the state and the row counts only.
 */
export async function capturePilotUnits(
  ctx: RunContext,
  state: string,
  counties: readonly string[],
  outDir: string,
): Promise<CaptureRecord> {
  const meta1 = await readStageMeta(ctx.bucket, 's01-base', state);
  if (meta1 === null) {
    throw new PilotCaptureInputMissing(state, 'stage 1 output');
  }
  const edition = meta1.datasets[LISTING_DATASET]?.edition;
  if (edition === undefined) {
    throw new PilotCaptureInputMissing(state, 'listing edition');
  }
  const load = <T>(name: string, schema: z.ZodType<T>) =>
    requiredRows(state, `stage 1 ${name}`, loadStageRows(ctx, 's01-base', state, name, schema));
  const jurisdictions = await load('jurisdictions', BJurisdictionSchema);
  const districts = await load('districts', BDistrictSchema);
  const fallbacks = await load('district_fallbacks', BDistrictFallbackSchema);
  const geometry = await load('geometry', BGeometrySchema);
  const meta2 = await readStageMeta(ctx.bucket, 's02-known', state);
  const knownRefs =
    (await loadStageRows(ctx, 's02-known', state, OFFICE_REFS_FILE, OfficeRefRowSchema)) ?? [];
  const listing: ParsedListingRow[] = [];
  for await (const row of readParsedListing(ctx, edition)) {
    listing.push(row);
  }
  const rows = selectPilotRows({
    state,
    counties,
    jurisdictions,
    districts,
    fallbacks,
    geometry,
    listing,
    knownRefs,
  });
  const record = CaptureRecordSchema.parse({
    state,
    counties: [...counties],
    captured_at: ctx.now.toISOString(),
    stage1_finished_at: meta1.finished_at,
    stage2_finished_at: meta2?.finished_at ?? null,
    census_gus_edition: edition,
    rows: rowCounts(rows),
    transformations: [
      `Kept the rows of the counties ${counties.join(', ')} and the state's own jurisdiction and district.`,
      'Replaced lookup_wkb by display_wkb on every geometry row that has both.',
      'Kept every stage 2 office ref of the state.',
    ],
  });
  await writePilotFiles(outDir, rows);
  await writeCaptureRecord(outDir, record);
  await assertPilotFixtureSize(outDir);
  ctx.log.info('pilot.capture', { state, ...record.rows });
  return record;
}

function rowCounts(rows: PilotRows): Record<PilotFile, number> {
  const files = rowsOf(rows);
  return Object.fromEntries(PILOT_FILES.map((file) => [file, files[file].length])) as Record<
    PilotFile,
    number
  >;
}

async function readPilotFile<T>(
  dir: string,
  file: PilotFile,
  schema: z.ZodType<T>,
  expected: number,
): Promise<T[]> {
  const name = `${file}${FILE_SUFFIX}`;
  const rows: T[] = [];
  try {
    for await (const row of readNdjsonGz(createReadStream(join(dir, name)), schema)) {
      rows.push(row);
    }
  } catch (error) {
    const reason =
      error instanceof Error && 'lineNumber' in error
        ? `line ${String(error.lineNumber)} is not a valid row`
        : 'the file cannot be read';
    throw new PilotFixtureInvalid(name, reason);
  }
  if (rows.length !== expected) {
    throw new PilotFixtureInvalid(
      name,
      `it holds ${String(rows.length)} rows and capture.json says ${String(expected)}`,
    );
  }
  return rows;
}

/** Reads a captured folder; every line through its schema, every count checked against capture.json. */
export async function loadPilotUnits(dir: string): Promise<PilotUnits> {
  let capture: CaptureRecord;
  try {
    capture = CaptureRecordSchema.parse(
      JSON.parse(await readFile(join(dir, CAPTURE_FILE), 'utf8')),
    );
  } catch {
    throw new PilotFixtureInvalid(CAPTURE_FILE, 'it is missing or fails its schema');
  }
  const { rows } = capture;
  return {
    capture,
    jurisdictions: await readPilotFile(
      dir,
      'jurisdictions',
      BJurisdictionSchema,
      rows.jurisdictions,
    ),
    districts: await readPilotFile(dir, 'districts', BDistrictSchema, rows.districts),
    fallbacks: await readPilotFile(
      dir,
      'district_fallbacks',
      BDistrictFallbackSchema,
      rows.district_fallbacks,
    ),
    geometry: await readPilotFile(dir, 'geometry', BGeometrySchema, rows.geometry),
    listing: await readPilotFile(dir, 'listing', ParsedListingRowSchema, rows.listing),
    knownRefs: await readPilotFile(dir, 'known_refs', OfficeRefRowSchema, rows.known_refs),
  };
}

/**
 * The template narrowed to the captured counties. A capture holds two counties, PIPE-geometry
 * step 10 throws GeometryInputMissing for a listed county with no geometry row, and the pilot tests
 * read only the captured counties' offices: so each county set keeps only the counties whose
 * `tiger:county:<GEOID>` row the capture holds, and a set left with no county is removed together
 * with every statewide entry whose district is its county union.
 */
function narrowCountySets(template: StateTemplate, geometry: readonly BGeometry[]): StateTemplate {
  const captured = new Set(geometry.map((row) => row.source_key));
  const copy = structuredClone(template);
  const removed = new Set<string>();
  copy.county_sets = copy.county_sets.flatMap((set) => {
    const counties = set.counties.filter((geoid) => captured.has(`tiger:county:${geoid}`));
    if (counties.length === 0) {
      removed.add(set.id);
      return [];
    }
    return [{ ...set, counties }];
  });
  copy.statewide = copy.statewide.filter(
    (entry) => entry.district === null || !removed.has(entry.district.county_union),
  );
  return copy;
}

/** A slug assigner over an empty registry: every identity gets its base or a suffixed base. */
function emptyRegistryAssigner(
  requests: readonly { identity: string; base: string }[],
): ReadonlyMap<string, string> {
  const registry: SlugRegistry = new Map();
  return assignSlugs(registry, requests).assigned;
}

/**
 * Validates the template with `rules`, then runs stage 4 and stage 5's pure cores over the captured
 * units. Every quote counts as unchecked (no request is made). Reads no bucket and no network.
 */
export async function runPilotExpansion(input: {
  readonly templatePath: string;
  readonly rules: StateRules;
  readonly units: PilotUnits;
  readonly today: string;
  readonly now: Date;
}): Promise<PilotRun> {
  const { rules, units, today, now } = input;
  const state = units.capture.state;
  const root = repoRoot();
  const text = await readTemplateFile(input.templatePath);
  const { officeTypeIds, powerIds } = await loadReferenceIds(root);
  const validated = validateTemplateText(text, {
    state,
    officeTypeIds,
    powerIds,
    rules,
    isFixture: false,
  });
  if (!validated.ok) {
    throw new PilotTemplateInvalid(validated.errors.map((error) => error.path));
  }
  const template = narrowCountySets(validated.template, units.geometry);
  const grounded: Record<string, GroundedMark> = {};
  for (const { path } of citedNodes(template)) {
    grounded[path] = { grounded: false, checked_at: null, text_sha256: null, reason: 'refused' };
  }
  const templateOutput = TemplateOutputSchema.parse({
    schema_version: 1,
    state,
    template,
    grounded,
    checked_at: now.toISOString(),
  });

  const stateJurisdiction = units.jurisdictions.find((j) => j.source_key === `state:${state}`);
  if (stateJurisdiction === undefined) {
    throw new PilotFixtureInvalid(`jurisdictions${FILE_SUFFIX}`, 'it holds no state jurisdiction');
  }
  const stateDistrict = units.districts.find(
    (d) => d.source_key.startsWith('tiger:state:') && d.jurisdiction_key === `state:${state}`,
  );
  if (stateDistrict === undefined) {
    throw new PilotFixtureInvalid(`districts${FILE_SUFFIX}`, 'it holds no state district');
  }
  const listing = new Map(units.listing.map((row) => [row.pid6, row]));
  const [relevanceDefaults, fixtures, zones] = await Promise.all([
    loadRelevanceDefaults(root),
    rulesFixtureInfo(root, state),
    loadTimezoneRegister(),
  ]);

  const expand = await expandState({
    template: templateOutput,
    units: unitsFor(state, units.jurisdictions, units.districts, units.fallbacks, listing),
    rules,
    today,
    now,
    state,
    stateFips: stateDistrict.source_key.slice('tiger:state:'.length),
    stateName: stateJurisdiction.name,
    districts: units.districts,
    geometry: new Map(units.geometry.map((row) => [row.source_key, row])),
    knownRefs: units.knownRefs,
    relevanceDefaults,
    newestRetrievedOn: fixtures.newestRetrievedOn,
    assignSlugs: emptyRegistryAssigner,
    geometryFns: { fallbackRow, unionRow },
    // A capture holds no block table, so every county union's population stays unknown.
    blockSums: null,
    countyZone: (geoid) => zoneForCounty(zones, state, geoid),
  });
  const deadlines = deadlinesState({
    state,
    today,
    now,
    elections: expand.elections,
    refs: [...expand.officeRefs, ...units.knownRefs],
    rules,
    newestRetrievedOn: fixtures.newestRetrievedOn,
  });
  return { template: templateOutput, expand, deadlines };
}

/** The run's offices of one jurisdiction, sorted by source_key. */
export function officesOf(run: PilotRun, jurisdictionKey: string): readonly BOffice[] {
  return bySourceKey(run.expand.offices.filter((o) => o.jurisdiction_key === jurisdictionKey));
}

function compareNullsFirst(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return -1;
  }
  if (b === null) {
    return 1;
  }
  return byteOrder(a, b);
}

/** The run's elections of one office, sorted by date, kind and party (nulls first). */
export function electionsOf(run: PilotRun, officeKey: string): readonly BElection[] {
  return run.expand.elections
    .filter((e) => e.office_key === officeKey)
    .sort(
      (a, b) =>
        byteOrder(a.election_date, b.election_date) ||
        byteOrder(a.kind, b.kind) ||
        compareNullsFirst(a.party, b.party),
    );
}

/** The run's filing tracks of one election, sorted by track. */
export function tracksOf(run: PilotRun, electionKey: string): readonly BFilingTrack[] {
  return run.deadlines.tracks
    .filter((t) => t.election_key === electionKey)
    .sort((a, b) => byteOrder(a.track, b.track));
}

/** The number of placeholder offices, of jurisdictions of `kind` when it is given. */
export function placeholderCount(run: PilotRun, kind?: string): number {
  const kindOf = new Map(run.expand.officeRefs.map((ref) => [ref.slug, ref.jurisdiction_kind]));
  return run.expand.offices.filter(
    (o) => o.placeholder && (kind === undefined || kindOf.get(o.slug) === kind),
  ).length;
}
