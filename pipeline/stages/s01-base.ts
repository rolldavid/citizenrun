// Stage 1, the base load: every government unit of a state as a jurisdiction, its exact,
// approximate or fallback district with geometry, populations, zones, validated websites, budgets
// and registered ward layers; `US` writes the ZIP centroids.
import type {
  BDistrict,
  BDistrictFallback,
  BJurisdiction,
  BZipCentroid,
  FieldMetaRow,
} from '@citizenrun/shared';
import { BGeometrySchema, BJurisdictionSchema } from '@citizenrun/shared';
import { validateWebsite, websiteOutcome } from '../crawlers/website-validate.ts';
import { bucketKeys } from '../lib/bucket.ts';
import { loadBoundarySources, loadUnitOverrides } from '../lib/data-files.ts';
import type { BoundarySource, UnitOverride } from '../lib/data-files.ts';
import { readStageMeta, readStageRows } from '../lib/runner.ts';
import type { RunContext, StageModule, StageOptions, StageResult } from '../lib/runner.ts';
import { PIPELINE_STATES, stateByCode } from '../lib/states.ts';
import { loadTimezoneRegister } from '../lib/timezones.ts';
import type { TimezoneRegister } from '../lib/timezones.ts';
import {
  ACS_DATASET,
  ACS_DIRECTORY,
  ACS_EDITION,
  PARSED_ACS_FILE,
  ensureAcsFile,
  readB01001,
  readParsedAcs,
  writeParsedAcs,
} from '../sources/acs.ts';
import type { AcsRow } from '../sources/acs.ts';
import {
  LISTING_DATASET,
  LISTING_EDITION,
  LISTING_ZIP,
  PARSED_LISTING_FILE,
  downloadListing,
  openListingWorkbook,
  writeParsedListing,
} from '../sources/census-gus.ts';
import type { ParsedListingRow } from '../sources/census-gus.ts';
import {
  DatasetRecordMissingError,
  DatasetUnavailableError,
  datasetEntry,
  datasetTempFile,
  ensureDatasetFile,
  openDatasetFile,
  readEditionRecord,
} from '../sources/dataset.ts';
import {
  PL_DATASET,
  PL_EDITION,
  PL_ROOT,
  buildBlockTable,
  plStateFolder,
} from '../sources/pl94171.ts';
import {
  SCHOOL_FINANCE_DATASET,
  SCHOOL_FINANCE_EDITION,
  SCHOOL_FINANCE_FILE,
  ensureSchoolFinanceFile,
  readSchoolFinance,
} from '../sources/school-finance.ts';
import {
  CB_STATE_DATASET,
  CB_STATE_EDITION,
  TIGER_DATASET,
  TIGER_EDITION,
  TIGER_LAYERS,
  ensureLayerFile,
  ensureMaskFile,
  readDbf,
} from '../sources/tiger.ts';
import type { TigerLayer } from '../sources/tiger.ts';
import { runBlockSums } from './base/block-sums.ts';
import type { BlockSum } from './base/block-sums.ts';
import {
  GOV_FINANCE,
  GOV_FINANCE_DATASET,
  GOV_FINANCE_YEAR,
  budgetFields,
  readBudgets,
} from './base/budgets.ts';
import type { Budget } from './base/budgets.ts';
import { Coverage } from './base/coverage.ts';
import {
  NAME_ONLY_LAYERS,
  STATE_WIDE_LAYERS,
  approxDistrictRow,
  approxGeometryRow,
  districtKey,
  exactDistrictRow,
  fallbackRow,
  isUndefinedDistrict,
  levelFor,
  planApproxDistricts,
  readNameLayer,
} from './base/districts.ts';
import type { ApproxUnit, Level } from './base/districts.ts';
import { buildGeometryRows, buildLandMask, readLayer } from './base/geometry.ts';
import type { GeometryRow, LayerFeature, LayerId, MultiPolygonCoords } from './base/geometry.ts';
import {
  JOIN_KINDS,
  featureId,
  joinRateCheck,
  joinUnits,
  schoolJoinPermille,
} from './base/joins.ts';
import type { TigerGeoids } from './base/joins.ts';
import {
  jurisdictionName,
  stateJurisdictionRow,
  stateKey,
  unitJurisdictionRow,
  unitKey,
  websiteMeta,
} from './base/jurisdictions.ts';
import {
  UNIT_KINDS,
  applyUnitOverrides,
  loadKnownUnitTypes,
  nationalCounts,
  readCheckedListing,
  unitCountsCheck,
  unitKind,
} from './base/listing.ts';
import type { Check, UnitKind } from './base/listing.ts';
import { acsIndex, acsPopulation, blockSumPopulation } from './base/population.ts';
import type { AcsIndex, DistrictPopulation } from './base/population.ts';
import { buildWardDistricts } from './base/wards.ts';
import type { WardDistrict } from './base/wards.ts';
import { assignZctas, stateGeometryRow, stateShape } from './base/zip-centroids.ts';
import type { StateShape } from './base/zip-centroids.ts';

export const BLOCKING_CHECKS = ['listing_header', 'unit_counts', 'join_rate', 'geometry_valid'];
/** Website checks run at once; each host keeps its own pace in the fetcher. */
const WEBSITE_CONCURRENCY = 8;
const INVALID_DETAIL_KEYS = 20;
const UNCLIPPED_LOG_KEYS = 50;

/** The TIGER STATE row of a state differs from the pipeline's table of states: a table error. */
export class StateTableError extends Error {
  override readonly name = 'StateTableError';
}

const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

function tigerLayer(token: string): TigerLayer {
  const found = TIGER_LAYERS.find((layer) => layer.token === token);
  if (found === undefined) throw new Error(`no TIGER layer ${token}`);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Inputs read once per run

type ListingLoad =
  | { ok: true; rows: readonly ParsedListingRow[]; checks: readonly Check[]; countsOk: boolean }
  | { ok: false; checks: readonly Check[]; needsSeed: boolean };

type RunInputs = {
  listing?: Promise<ListingLoad>;
  school?: Promise<{ map: ReadonlyMap<string, string> | null; needsSeed: boolean }>;
  acs?: Promise<{ rows: readonly AcsRow[] | null; fileUrl: string | null; needsSeed: boolean }>;
  register?: Promise<TimezoneRegister>;
  overrides?: Promise<readonly UnitOverride[]>;
  boundaries?: Promise<readonly BoundarySource[]>;
  budgets?: Promise<ReadonlyMap<string, Budget>>;
};

const runInputs = new WeakMap<RunContext, RunInputs>();

function inputs(ctx: RunContext): RunInputs {
  let found = runInputs.get(ctx);
  if (found === undefined) {
    found = {};
    runInputs.set(ctx, found);
  }
  return found;
}

/** The stored file a failed or gated download falls back on, when its edition record lists one. */
async function storedFile(
  ctx: RunContext,
  dataset: string,
  edition: string,
  file: string,
): Promise<string | null> {
  const record = await readEditionRecord(ctx, dataset, edition);
  const key = bucketKeys.dataset(dataset, edition, file);
  return record?.files.some((entry) => entry.name === file) === true &&
    (await ctx.bucket.head(key)) !== null
    ? key
    : null;
}

/**
 * The national listing, parsed once per run: the header of each tab, the General Purpose types
 * and the national counts are checked before any state is filtered from it.
 */
async function loadListing(ctx: RunContext): Promise<ListingLoad> {
  const download = await downloadListing(ctx);
  let zipKey: string;
  let fresh = false;
  if ('key' in download) {
    zipKey = download.key;
    fresh = !download.fromCache;
  } else {
    const reason = 'needsSeed' in download ? 'needs_seed' : download.failed;
    const stored = await storedFile(ctx, LISTING_DATASET, LISTING_EDITION, LISTING_ZIP);
    if (stored === null) {
      if (reason !== 'needs_seed') throw new DatasetUnavailableError(LISTING_DATASET, reason);
      return {
        ok: false,
        needsSeed: true,
        checks: [{ name: 'listing_header', passed: false, detail: 'needs_seed' }],
      };
    }
    ctx.log.warn('dataset.previous_file', { dataset: LISTING_DATASET, reason });
    zipKey = stored;
  }
  const read = await readCheckedListing(
    await openListingWorkbook(ctx, zipKey),
    await loadKnownUnitTypes(),
  );
  if (read.rows === null) {
    return { ok: false, needsSeed: false, checks: [read.check] };
  }
  const { rows } = read;
  const header = read.check;
  const parsedKey = bucketKeys.dataset(LISTING_DATASET, LISTING_EDITION, PARSED_LISTING_FILE);
  if (fresh || (await ctx.bucket.head(parsedKey)) === null) {
    await writeParsedListing(ctx, rows);
  }
  const counts = unitCountsCheck(LISTING_EDITION, nationalCounts(rows), null);
  const outside = rows.filter((row) => !PIPELINE_STATES.some((s) => s.fips === row.fips_state));

  if (outside.length > 0) {
    ctx.log.warn('listing.outside_states', { count: outside.length });
  }
  return { ok: true, rows, checks: [header, counts], countsOk: counts.passed };
}

async function loadSchool(
  ctx: RunContext,
): Promise<{ map: ReadonlyMap<string, string> | null; needsSeed: boolean }> {
  const result = await ensureSchoolFinanceFile(ctx);
  let key: string | null = 'key' in result ? result.key : null;
  const needsSeed = 'needsSeed' in result;
  if (key === null) {
    key = await storedFile(
      ctx,
      SCHOOL_FINANCE_DATASET,
      SCHOOL_FINANCE_EDITION,
      SCHOOL_FINANCE_FILE,
    );
    if (key === null) {
      if (!needsSeed) {
        throw new DatasetUnavailableError(
          SCHOOL_FINANCE_DATASET,
          'failed' in result ? result.failed : 'unavailable',
        );
      }
      return { map: null, needsSeed };
    }
  }
  return { map: await readSchoolFinance(await openDatasetFile(ctx, key)), needsSeed };
}

async function loadAcs(
  ctx: RunContext,
): Promise<{ rows: readonly AcsRow[] | null; fileUrl: string | null; needsSeed: boolean }> {
  let key: string;
  try {
    key = await ensureAcsFile(ctx);
  } catch (error) {
    if (error instanceof DatasetUnavailableError && error.reason === 'needs_seed') {
      return { rows: null, fileUrl: null, needsSeed: true };
    }
    throw error;
  }
  const fileUrl = `${ACS_DIRECTORY}${key.slice(key.lastIndexOf('/') + 1)}`;
  const parsedKey = bucketKeys.dataset(ACS_DATASET, ACS_EDITION, PARSED_ACS_FILE);
  const rows: AcsRow[] = [];
  if ((await ctx.bucket.head(parsedKey)) === null) {
    for await (const row of readB01001(await openDatasetFile(ctx, key))) rows.push(row);
    await writeParsedAcs(ctx, rows);
  } else {
    for await (const row of readParsedAcs(ctx)) rows.push(row);
  }
  return { rows, fileUrl, needsSeed: false };
}

/**
 * The budgets of a qualifying government-finance file (PIPE-budgets), by PID6; empty while no file
 * qualifies, so every `budget_cents` stays null.
 */
async function loadBudgets(ctx: RunContext): Promise<ReadonlyMap<string, Budget>> {
  if (GOV_FINANCE === null) return new Map();
  const spec = GOV_FINANCE;
  const file = spec.url.slice(spec.url.lastIndexOf('/') + 1);
  const result = await ensureDatasetFile(ctx, {
    dataset: GOV_FINANCE_DATASET,
    edition: String(GOV_FINANCE_YEAR),
    url: spec.url,
    file,
  });
  const key =
    'key' in result
      ? result.key
      : await storedFile(ctx, GOV_FINANCE_DATASET, String(GOV_FINANCE_YEAR), file);
  if (key === null) {
    ctx.log.warn('budgets.unavailable', {
      reason: 'needsSeed' in result ? 'needs_seed' : 'failed',
    });
    return new Map();
  }
  const read = await readBudgets(await openDatasetFile(ctx, key), spec, ctx.now.toISOString());
  if (read.reason !== null) ctx.log.warn('budgets.file_unusable', { reason: read.reason });
  return read.budgets;
}

function once<K extends keyof RunInputs>(
  ctx: RunContext,
  key: K,
  load: () => NonNullable<RunInputs[K]>,
): NonNullable<RunInputs[K]> {
  const cache = inputs(ctx);
  const found = cache[key];
  if (found !== undefined) return found;
  const made = load();
  cache[key] = made;
  return made;
}

// ---------------------------------------------------------------------------------------------
// Layers

type StateLayers = {
  /** Features by layer; invalid features are listed by GEOID apart. */
  readonly features: Map<LayerId, LayerFeature[]>;
  readonly invalid: Map<LayerId, string[]>;
};

async function withTemp<T>(
  ctx: RunContext,
  key: string,
  use: (path: string) => Promise<T>,
): Promise<T> {
  const temp = await datasetTempFile(ctx, key, '.zip');
  try {
    return await use(temp.path);
  } finally {
    await temp.remove();
  }
}

const STATE_FILE_LAYERS: readonly { id: LayerId; token: string }[] = [
  { id: 'place', token: 'place' },
  { id: 'cousub', token: 'cousub' },
  { id: 'cd', token: 'cd120' },
  { id: 'sldu', token: 'sldu' },
  { id: 'sldl', token: 'sldl' },
  { id: 'unsd', token: 'unsd' },
  { id: 'elsd', token: 'elsd' },
  { id: 'scsd', token: 'scsd' },
  { id: 'concity', token: 'concity' },
];

async function readStateLayers(ctx: RunContext, state: string, fips: string): Promise<StateLayers> {
  const features = new Map<LayerId, LayerFeature[]>();
  const invalid = new Map<LayerId, string[]>();
  const stateKeyFile = await ensureLayerFile(ctx, tigerLayer('state'), 'us');
  if (stateKeyFile === null) throw new StateTableError('TIGER lists no national STATE file');
  const stateRead = await withTemp(ctx, stateKeyFile, (path) =>
    readNameLayer(path, 'state', { stateFips: fips }),
  );
  const [only] = stateRead.features;
  const total = stateRead.features.length + stateRead.invalid.length;
  const matches =
    total === 1 &&
    (only === undefined
      ? stateRead.invalid[0] === fips
      : only.geoid === fips && only.properties['STUSPS'] === state);
  if (!matches) {
    throw new StateTableError(`the TIGER STATE row of ${fips} is not ${state}`);
  }
  features.set('state', stateRead.features);
  invalid.set('state', stateRead.invalid);

  const countyFile = await ensureLayerFile(ctx, tigerLayer('county'), 'us');
  if (countyFile === null) throw new StateTableError('TIGER lists no national COUNTY file');
  const county = await withTemp(ctx, countyFile, (path) =>
    readLayer(path, 'county', { stateFips: fips }),
  );
  features.set('county', county.features);
  invalid.set('county', county.invalid);

  for (const { id, token } of STATE_FILE_LAYERS) {
    const key = await ensureLayerFile(ctx, tigerLayer(token), fips);
    if (key === null) {
      features.set(id, []);
      invalid.set(id, []);
      continue;
    }
    const read = await withTemp(ctx, key, (path) =>
      NAME_ONLY_LAYERS.has(id)
        ? readNameLayer(path, id, { stateFips: null })
        : readLayer(path, id, { stateFips: null }),
    );
    features.set(id, read.features);
    invalid.set(id, read.invalid);
  }
  return { features, invalid };
}

function geoids(layers: StateLayers, layer: LayerId): Set<string> {
  return new Set([
    ...(layers.features.get(layer) ?? []).map((feature) => feature.geoid),
    ...(layers.invalid.get(layer) ?? []),
  ]);
}

// ---------------------------------------------------------------------------------------------
// The state run

async function previousWebsites(
  ctx: RunContext,
  state: string,
): Promise<Map<string, { url: string; meta: FieldMetaRow | null }>> {
  const out = new Map<string, { url: string; meta: FieldMetaRow | null }>();
  const meta = await readStageMeta(ctx.bucket, 's01-base', state);
  if (meta?.files.some((file) => file.name === 'jurisdictions') !== true) return out;
  for await (const row of readStageRows(
    ctx.bucket,
    's01-base',
    state,
    'jurisdictions',
    BJurisdictionSchema,
  )) {
    if (row.website !== null) {
      out.set(row.source_key, { url: row.website, meta: row.field_meta['website'] ?? null });
    }
  }
  return out;
}

async function pool<T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await work(item);
    }
  });
  await Promise.all(runners);
}

function datasetEntries(
  ctx: RunContext,
  used: readonly [string, string][],
): StageResult['datasets'] {
  const out: Record<string, { edition: string; downloaded_on: string; source_url: string }> = {};
  for (const [id, edition] of used) {
    try {
      out[id] = datasetEntry(ctx, id, edition);
    } catch (error) {
      if (!(error instanceof DatasetRecordMissingError)) throw error;
    }
  }
  return out;
}

type Unit = {
  readonly row: ParsedListingRow;
  readonly listed: ParsedListingRow;
  readonly kind: UnitKind;
};

/** One state's base load (PIPE-base-load), written through `opts.out`. */
export async function runState(
  ctx: RunContext,
  state: string,
  opts: StageOptions,
): Promise<StageResult> {
  const { fips } = stateByCode(state);
  const checkedAt = ctx.now.toISOString();
  const coverage = new Coverage();
  const checks: Check[] = [];
  const needsSeed: string[] = [];

  // Listing: national, parsed once per run; a header failure stops the state here.
  const listing = await once(ctx, 'listing', () => loadListing(ctx));
  checks.push(...listing.checks);
  if (!listing.ok) {
    if (listing.needsSeed) {
      needsSeed.push(LISTING_DATASET);
      checks.push({ name: `dataset:${LISTING_DATASET}`, passed: false, detail: 'needs_seed' });
    }
    return { files: [], checks, datasets: {} };
  }
  if (!listing.countsOk) {
    return {
      files: [],
      checks,
      datasets: datasetEntries(ctx, [[LISTING_DATASET, LISTING_EDITION]]),
    };
  }

  const school = await once(ctx, 'school', () => loadSchool(ctx));
  if (school.needsSeed) needsSeed.push(SCHOOL_FINANCE_DATASET);
  const acs = await once(ctx, 'acs', () => loadAcs(ctx));
  if (acs.needsSeed) needsSeed.push(ACS_DATASET);
  const register = await once(ctx, 'register', () => loadTimezoneRegister());
  const overrides = await once(ctx, 'overrides', () => loadUnitOverrides());
  const boundaries = await once(ctx, 'boundaries', () => loadBoundarySources());
  const budgets = await once(ctx, 'budgets', () => loadBudgets(ctx));

  const layers = await readStateLayers(ctx, state, fips);
  const maskKey = await ensureMaskFile(ctx);
  const mask: MultiPolygonCoords = await withTemp(ctx, maskKey, (path) =>
    buildLandMask(path, fips),
  );
  const blocksKey = await buildBlockTable(ctx, state);
  const plFileUrl = `${PL_ROOT}${plStateFolder(state)}${state.toLowerCase()}2020.pl.zip`;

  // Units of the state, corrected by data/unit-overrides.yaml.
  // Units are placed by FIPS_STATE, the code the joins use: a row's STATE can disagree with it
  // (the 2026 file has a Wisconsin town listed with STATE WA).
  const listedRows = listing.rows.filter((row) => row.fips_state === fips);
  const mismatched = listedRows.filter((row) => row.state !== state).length;
  if (mismatched > 0) {
    ctx.log.warn('listing.state_mismatch', { state, count: mismatched });
  }
  const listedByPid6 = new Map(listedRows.map((row) => [row.pid6, row]));
  const overrideNames = new Map(
    overrides.flatMap((row) => (row.name === undefined ? [] : [[row.pid6, row.name] as const])),
  );
  const units: Unit[] = applyUnitOverrides(listedRows, overrides).map((row) => ({
    row,
    listed: listedByPid6.get(row.pid6) ?? row,
    kind: unitKind(row),
  }));
  for (const kind of UNIT_KINDS) {
    coverage.set(`units:${kind}`, units.filter((unit) => unit.kind === kind).length);
  }
  const loaded = new Set(units.map((unit) => unit.row.pid6));

  // Joins.
  const tiger: TigerGeoids = {
    county: geoids(layers, 'county'),
    place: geoids(layers, 'place'),
    cousub: geoids(layers, 'cousub'),
    concity: geoids(layers, 'concity'),
    unsd: geoids(layers, 'unsd'),
    elsd: geoids(layers, 'elsd'),
    scsd: geoids(layers, 'scsd'),
  };
  const joined = joinUnits(
    units.map((unit) => ({ ...unit.row, kind: unit.kind })),
    tiger,
    school.map ?? new Map(),
  );
  const rates = joinRateCheck(joined);
  checks.push(rates.joinRate, rates.schoolRate);
  if (!rates.schoolRate.passed) {
    ctx.log.warn('joins.school_rate_low', { state, detail: rates.schoolRate.detail });
  }
  for (const kind of JOIN_KINDS) {
    coverage.set(`join:${kind}:units`, joined.counts[kind].units);
    coverage.set(`join:${kind}:matched`, joined.counts[kind].matched);
  }
  const permille = schoolJoinPermille(joined);
  if (permille !== null) coverage.set('school_join_rate_permille', permille);
  coverage.set('district_shared', joined.shared.length);

  // Feature names, for district and jurisdiction names.
  const featureByKey = new Map<string, LayerFeature>();
  for (const [layer, list] of layers.features) {
    for (const feature of list) featureByKey.set(districtKey(layer, feature.geoid), feature);
  }
  const nameOf = (key: string): string | null => {
    const feature = featureByKey.get(key);
    if (feature === undefined) return null;
    return feature.namelsad;
  };

  // Exact districts: the features the loaded units use, and every state-wide feature.
  type Exact = {
    key: string;
    layer: LayerId;
    geoid: string;
    jurisdictionKey: string;
    level: Level;
  };
  const exact = new Map<string, Exact>();
  const exactByPid6 = new Map<string, string>();
  for (const [pid6, ref] of joined.joins) {
    const key = districtKey(ref.layer, ref.geoid);
    exactByPid6.set(pid6, key);
    const owner = joined.owners.get(featureId(ref));
    if (owner === pid6) {
      exact.set(key, {
        key,
        layer: ref.layer,
        geoid: ref.geoid,
        jurisdictionKey: unitKey(pid6),
        level: levelFor(ref.layer),
      });
    }
  }
  let undefinedSkipped = 0;
  for (const layer of STATE_WIDE_LAYERS) {
    for (const geoid of geoids(layers, layer)) {
      const key = districtKey(layer, geoid);
      if (isUndefinedDistrict(layer, geoid, featureByKey.get(key))) {
        undefinedSkipped += 1;
        continue;
      }
      exact.set(key, {
        key,
        layer,
        geoid,
        jurisdictionKey: stateKey(state),
        level: levelFor(layer),
      });
    }
  }
  ctx.log.info('districts.undefined_skipped', { state, count: undefinedSkipped });

  // Approximate and fallback districts, and the county districts they stand in through.
  const unitNames = new Map<string, string>();
  for (const unit of units) {
    const ref = joined.joins.get(unit.row.pid6);
    const owned = ref !== undefined && joined.owners.get(featureId(ref)) === unit.row.pid6;
    const joinedName = owned ? nameOf(districtKey(ref.layer, ref.geoid)) : null;
    unitNames.set(
      unit.row.pid6,
      jurisdictionName(unit.listed.unit_name, joinedName, overrideNames.get(unit.row.pid6) ?? null),
    );
  }
  const approxUnits: ApproxUnit[] = units.map((unit) => ({
    pid6: unit.row.pid6,
    tab: unit.row.tab,
    fips_state: unit.row.fips_state,
    fips_county: unit.row.fips_county,
    parent_pid6:
      unit.row.parent_pid6 !== null && loaded.has(unit.row.parent_pid6)
        ? unit.row.parent_pid6
        : null,
    kind: unit.kind,
    name: unitNames.get(unit.row.pid6) ?? unit.row.unit_name,
  }));
  const countyGeoids = new Set(
    (layers.features.get('county') ?? []).map((feature) => feature.geoid),
  );
  const { approx, unplaced } = planApproxDistricts({
    units: approxUnits,
    exactByPid6,
    countyGeoids,
  });
  coverage.set('approx_unplaced', unplaced.length);
  let viaOnly = 0;
  for (const district of approx) {
    if (exact.has(district.via)) continue;
    const geoid = district.via.slice('tiger:county:'.length);
    exact.set(district.via, {
      key: district.via,
      layer: 'county',
      geoid,
      jurisdictionKey: stateKey(state),
      level: 'county',
    });
    viaOnly += 1;
  }
  if (viaOnly > 0) ctx.log.info('districts.via_only_counties', { state, count: viaOnly });

  // Geometry of the exact districts (PIPE-geometry steps 3 to 8).
  const wanted = new Map<string, { layer: LayerId; geoid: string }>();
  for (const district of exact.values())
    wanted.set(district.key, { layer: district.layer, geoid: district.geoid });
  const geometry = await buildGeometryRows({
    stateFips: fips,
    layers: layers.features,
    mask,
    wanted,
  });
  coverage.set('outline_dropped', geometry.droppedOutlines.length);
  ctx.log.info('geometry.display_unclipped', {
    state,
    count: geometry.unclippedDisplay.length,
    keys: geometry.unclippedDisplay.slice(0, UNCLIPPED_LOG_KEYS),
  });

  // Wards of the registered layers.
  const placeOwners = new Map<string, string>();
  for (const [pid6, ref] of joined.joins) {
    if (
      (ref.layer === 'place' || ref.layer === 'concity') &&
      joined.owners.get(featureId(ref)) === pid6
    ) {
      placeOwners.set(ref.geoid, unitKey(pid6));
    }
  }
  const wards = await buildWardDistricts(ctx, {
    entries: boundaries,
    stateFips: fips,
    placeOwners,
    mask,
  });
  coverage.set('ward_layer_failed', wards.failures.length);
  const wardByKey = new Map<string, WardDistrict>(wards.districts.map((ward) => [ward.key, ward]));

  // Block sums and the PostGIS validity check over every lookup geometry.
  const sumInput: { key: string; lookupWkbHex: string }[] = [];
  for (const [key, row] of geometry.rows) {
    if (row.lookup_wkb !== null) sumInput.push({ key, lookupWkbHex: row.lookup_wkb });
  }
  for (const ward of wards.districts)
    sumInput.push({ key: ward.key, lookupWkbHex: ward.lookupWkbHex });
  sumInput.sort((a, b) => byteOrder(a.key, b.key));
  const blockSums = await runBlockSums({ runId: ctx.runId, blocksKey, districts: sumInput }, ctx);
  const [wp7] = geometry.checks;
  const invalidKeys = [...blockSums.invalid].sort(byteOrder);
  const geometryPassed = (wp7?.passed ?? false) && invalidKeys.length === 0;
  checks.push({
    name: `geometry_valid:${state}`,
    passed: geometryPassed,
    detail: (invalidKeys.length === 0
      ? (wp7?.detail ?? '')
      : `${wp7?.detail ?? ''}; PostGIS finds ${String(invalidKeys.length)} invalid: ${invalidKeys
          .slice(0, INVALID_DETAIL_KEYS)
          .join(', ')}`
    ).slice(0, 2000),
  });

  // Populations of the exact districts.
  const index: AcsIndex = acs.rows === null ? new Map() : acsIndex(acs.rows, fips);
  const populationOf = (
    key: string,
    layer: LayerId | 'ward',
    geoid: string,
  ): DistrictPopulation | null => {
    if (layer !== 'ward' && acs.fileUrl !== null) {
      const found = acsPopulation(index, layer, geoid, acs.fileUrl, checkedAt);
      if (found !== null) return found;
    }
    const sum: BlockSum = blockSums.sums.get(key) ?? { p1: 0, p3: 0, blocks: 0 };
    return blockSumPopulation(sum, plFileUrl, checkedAt);
  };

  // Districts, fallbacks and geometry rows.
  const districts: BDistrict[] = [];
  const geometryRows: GeometryRow[] = [];
  for (const district of exact.values()) {
    const row = geometry.rows.get(district.key);
    if (row === undefined) continue; // missing or invalid: geometry_valid has failed
    const name =
      district.layer === 'state' ? (nameOf(district.key) ?? state) : nameOf(district.key);
    if (name === null) continue;
    districts.push(
      exactDistrictRow(
        {
          key: district.key,
          jurisdictionKey: district.jurisdictionKey,
          name,
          level: district.level,
        },
        row.geom_hash,
        populationOf(district.key, district.layer, district.geoid),
      ),
    );
    geometryRows.push(row);
  }
  for (const ward of wardByKey.values()) {
    districts.push(
      exactDistrictRow(
        { key: ward.key, jurisdictionKey: ward.jurisdictionKey, name: ward.name, level: 'local' },
        ward.geometry.geom_hash,
        populationOf(ward.key, 'ward', ''),
      ),
    );
    geometryRows.push(ward.geometry);
  }
  const fallbacks: BDistrictFallback[] = [];
  let approxCount = 0;
  let parentCount = 0;
  for (const district of approx) {
    const via = geometry.rows.get(district.via);
    const viaDisplay = geometry.display.get(district.via) ?? null;
    if (via === undefined || viaDisplay === null) continue; // the via feature failed geometry_valid
    districts.push(approxDistrictRow(district));
    fallbacks.push(fallbackRow(district));
    geometryRows.push(await approxGeometryRow(district, via, viaDisplay));
    if (district.quality === 'county_approx') approxCount += 1;
    else parentCount += 1;
  }
  coverage.set('districts:exact', districts.length - approxCount - parentCount);
  coverage.set('districts:county_approx', approxCount);
  coverage.set('districts:parent_fallback', parentCount);

  // Websites (crawl class: refused in business hours, which leaves them unchecked).
  const previous = await previousWebsites(ctx, state);
  const websites = new Map<string, { url: string; meta: FieldMetaRow } | null>();
  const withWebsite = units.filter((unit) => unit.row.web_address !== null);
  coverage.set('units_with_website', withWebsite.length);
  for (const name of ['units_website_valid', 'website_invalid', 'website_unchecked'] as const) {
    coverage.set(name, 0);
  }
  await pool(withWebsite, WEBSITE_CONCURRENCY, async (unit) => {
    const address = unit.row.web_address ?? '';
    const verdict = await validateWebsite(ctx.fetcher, address, state);
    const before = previous.get(unitKey(unit.row.pid6)) ?? null;
    const outcome = websiteOutcome(verdict, before?.url ?? null);
    coverage.add(outcome.counter);
    if (outcome.website === null) {
      websites.set(unit.row.pid6, null);
    } else if (outcome.kept && before !== null) {
      websites.set(unit.row.pid6, {
        url: outcome.website,
        meta: before.meta ?? websiteMeta(unit.row.pid6, address, checkedAt),
      });
    } else {
      websites.set(unit.row.pid6, {
        url: outcome.website,
        meta: websiteMeta(unit.row.pid6, address, checkedAt),
      });
    }
  });

  // Jurisdictions.
  const labelOf = (key: string | undefined): readonly [number, number] | null => {
    if (key === undefined) return null;
    return geometry.rows.get(key)?.label_point ?? null;
  };
  const budgetOf = (pid6: string) => {
    const found = budgetFields(budgets, pid6);
    return found.budget_cents === null || found.budget_year === null || found.meta === null
      ? null
      : { cents: found.budget_cents, year: found.budget_year, meta: found.meta };
  };
  let parentUnmatched = 0;
  const jurisdictions: BJurisdiction[] = [];
  for (const unit of units) {
    const { pid6 } = unit.row;
    let parentKey: string | null = null;
    if (unit.row.tab === 'DEP School Dist') {
      if (unit.row.parent_pid6 !== null && loaded.has(unit.row.parent_pid6)) {
        parentKey = unitKey(unit.row.parent_pid6);
      } else {
        parentUnmatched += 1;
      }
    }
    jurisdictions.push(
      unitJurisdictionRow({
        state,
        kind: unit.kind,
        listed: unit.listed,
        name: unitNames.get(pid6) ?? unit.row.unit_name,
        parentKey,
        website: websites.get(pid6) ?? null,
        register,
        budget: budgetOf(pid6),
        label: labelOf(exactByPid6.get(pid6)),
        checkedAt,
      }),
    );
  }
  coverage.set('parent_unmatched', parentUnmatched);
  const stateDistrict = districtKey('state', fips);
  const statePopulation =
    acs.fileUrl === null ? null : acsPopulation(index, 'state', fips, acs.fileUrl, checkedAt);
  jurisdictions.push(
    stateJurisdictionRow({
      state,
      name: nameOf(stateDistrict) ?? stateByCode(state).name,
      population:
        statePopulation === null
          ? null
          : { value: statePopulation.population, meta: statePopulation.meta },
      register,
      label: labelOf(stateDistrict),
      checkedAt,
    }),
  );

  for (const id of needsSeed) {
    coverage.set(`dataset_needs_seed:${id}`, 1);
    checks.push({ name: `dataset:${id}`, passed: false, detail: 'needs_seed' });
  }

  // Writing, in the stage's order, each file sorted by its key.
  jurisdictions.sort((a, b) => byteOrder(a.source_key, b.source_key));
  districts.sort((a, b) => byteOrder(a.source_key, b.source_key));
  fallbacks.sort((a, b) => byteOrder(a.source_key, b.source_key));
  geometryRows.sort((a, b) => byteOrder(a.source_key, b.source_key));
  const files = [
    await opts.out.writeRows('jurisdictions', jurisdictions),
    await opts.out.writeRows('districts', districts),
    await opts.out.writeRows('district_fallbacks', fallbacks),
    await opts.out.writeRows('geometry', geometryRows),
    await opts.out.writeRows('coverage', coverage.rows()),
  ];
  const used: [string, string][] = [
    [LISTING_DATASET, LISTING_EDITION],
    [TIGER_DATASET, TIGER_EDITION],
    [CB_STATE_DATASET, CB_STATE_EDITION],
    [SCHOOL_FINANCE_DATASET, SCHOOL_FINANCE_EDITION],
    [ACS_DATASET, ACS_EDITION],
    [PL_DATASET, PL_EDITION],
  ];
  if (GOV_FINANCE !== null && budgets.size > 0)
    used.push([GOV_FINANCE_DATASET, String(GOV_FINANCE_YEAR)]);
  return { files, checks, datasets: datasetEntries(ctx, used) };
}

// ---------------------------------------------------------------------------------------------
// The national run

/** `base --state US`: the ZIP centroids from the national ZCTA table and each state's stage 1 geometry. */
export async function runNational(ctx: RunContext, opts: StageOptions): Promise<StageResult> {
  const key = await ensureLayerFile(ctx, tigerLayer('zcta520'), 'us');
  if (key === null) throw new StateTableError('TIGER lists no national ZCTA520 file');
  const table = await readDbf(key, ctx, ['ZCTA5CE20', 'INTPTLAT20', 'INTPTLON20']);
  const display: StateShape[] = [];
  const lookup: StateShape[] = [];
  let missing = 0;
  for (const { code, fips } of PIPELINE_STATES) {
    if ((await readStageMeta(ctx.bucket, 's01-base', code)) === null) {
      missing += 1;
      continue;
    }
    const row = await stateGeometryRow(
      readStageRows(ctx.bucket, 's01-base', code, 'geometry', BGeometrySchema),
      fips,
    );
    if (row === null) {
      missing += 1;
      continue;
    }
    const land = stateShape(code, row.display_wkb);
    const whole = stateShape(code, row.lookup_wkb);
    if (land !== null) display.push(land);
    if (whole !== null) lookup.push(whole);
  }
  const { rows, unassigned } = assignZctas(table, display, lookup);
  const coverage = new Coverage();
  coverage.set('zcta_unassigned', unassigned);
  coverage.set('states_without_base', missing);
  ctx.log.info('zip_centroids.assigned', {
    rows: rows.length,
    unassigned,
    statesWithoutBase: missing,
  });
  const files = [
    await opts.out.writeRows('zip_centroids', rows satisfies BZipCentroid[]),
    await opts.out.writeRows('coverage', coverage.rows()),
  ];
  return {
    files,
    checks: [],
    datasets: datasetEntries(ctx, [[TIGER_DATASET, TIGER_EDITION]]),
  };
}

/** Stage 1 (PIPE-base-load). */
export const s01Base: StageModule = {
  id: 's01-base',
  milestone: 2,
  blockingChecks: BLOCKING_CHECKS,
  states: () => Promise.resolve(PIPELINE_STATES.map((row) => row.code)),
  run: (ctx, state, opts) => (state === 'US' ? runNational(ctx, opts) : runState(ctx, state, opts)),
};
