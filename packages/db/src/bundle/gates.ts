import { posix } from 'node:path';
import { BUNDLE_SCHEMA_VERSION, LOADER_SCHEMA_REVISION } from '@citizenrun/shared';
import type { BundleManifest } from '@citizenrun/shared';
import { civicFormKey, civicPhotoKey } from '@citizenrun/shared/storage';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { assetFormatOk } from './assets.ts';
import type { MediaAssetWriter } from './assets.ts';
import { BundleChecksumError, BundlePathError } from './errors.ts';
import { resolveRelative } from './paths.ts';
import type { BundleReader } from './reader.ts';
import type { StageReport } from './stage.ts';
import type { GateResult } from './stats.ts';
import { isFullFileR0 } from './tables.ts';
import type { FullFileR0 } from './tables.ts';

// The sanity gates of PIPE-loader-gates (CTL-30). Every statement binds the bundle id
// and never builds SQL from a bundle value; table names come from the constants below.

export const GATE_ORDER = [
  'schema_compatible',
  'pipeline_checks',
  'checksums',
  'schema_valid',
  'shrink',
  'references',
  'reference_ids',
  'deadlines_before_elections',
  'personal_data',
  'geometry',
  'assets',
] as const;
export const SHRINK_MIN_PERCENT = 95; // PIPE-loader-gates
export const SHRINK_RETIRING = [
  'jurisdictions',
  'districts',
  'offices',
  'elections',
  'people',
] as const;
export const SHRINK_ALL_ROWS = ['office_powers', 'filing_tracks', 'officeholders'] as const; // 'results' and 'forms' join with their files (r1, r2)

const DETAIL_ENTRIES = 20; // PIPE-loader-gates
const DETAIL_MAX_CHARS = 2000; // T-data_bundles

export type AssetRef = {
  kind: 'photo' | 'form';
  sha256: string;
  path: string;
  bytes: number;
  mediaKey: string;
  present: boolean;
};

function passed(name: string): GateResult {
  return { name, passed: true, detail: null };
}

function failed(name: string, detail: string): GateResult {
  return { name, passed: false, detail: detail.slice(0, DETAIL_MAX_CHARS) };
}

/** At most 20 entries joined by ', ', cut to 2,000 characters. */
function joinDetail(entries: readonly string[]): string {
  return entries.slice(0, DETAIL_ENTRIES).join(', ').slice(0, DETAIL_MAX_CHARS);
}

function gate(name: string, entries: readonly string[]): GateResult {
  return entries.length === 0 ? passed(name) : failed(name, joinDetail(entries));
}

/** Bundle compatibility (B-manifest): the version, the revision, the kind, the files and the paths of a manifest. */
export function checkCompatibility(
  manifest: BundleManifest,
  kind: 'full' | 'geometry',
): GateResult {
  const name = 'schema_compatible';
  // Read as a number: a manifest built for another version still reaches this check.
  const schemaVersion: number = manifest.schema_version;
  if (schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    return failed(name, `schema_version ${String(schemaVersion)} not supported`);
  }
  if (manifest.schema_revision > LOADER_SCHEMA_REVISION) {
    return failed(
      name,
      `schema_revision ${String(manifest.schema_revision)} above ${String(LOADER_SCHEMA_REVISION)}`,
    );
  }
  if (manifest.kind !== kind) {
    return failed(name, `kind ${manifest.kind}`);
  }
  for (const file of manifest.files) {
    const allowed =
      kind === 'full'
        ? isFullFileR0(file.name)
        : file.name === 'geometry' || file.name === 'zip_centroids';
    if (!allowed) {
      return failed(name, `file ${file.name} not supported`);
    }
  }
  // Paths are checked as the bucket resolves them: against bundles/<version>/.
  const base = `bundles/${manifest.version}/manifest.json`;
  const paths: [string, string][] = [
    ...manifest.files.map((file): [string, string] => [file.name, file.path]),
    ...manifest.assets.map((asset): [string, string] => [asset.kind, asset.path]),
  ];
  for (const [label, path] of paths) {
    try {
      resolveRelative(base, path);
    } catch (error) {
      if (error instanceof BundlePathError) {
        return failed(name, `path of ${label} leaves the bundle`);
      }
      throw error;
    }
  }
  return passed(name);
}

/** Every check of the manifest passed (D-310, D-311); the detail names the failed checks, never their detail text. */
export function checkPipelineChecks(manifest: BundleManifest): GateResult {
  return gate(
    'pipeline_checks',
    manifest.checks.filter((check) => !check.passed).map((check) => check.name),
  );
}

/** checksums, then schema_valid, from the staging report. */
export function stagingGates(report: StageReport): GateResult[] {
  return [
    gate('checksums', report.checksumFailures),
    gate(
      'schema_valid',
      report.schemaFailures.map((ref) => `${ref.file}:${String(ref.line)}`),
    ),
  ];
}

/** personal_data, from the staging report (D-084). */
export function personalDataGate(report: StageReport): GateResult {
  return gate(
    'personal_data',
    report.personalData.map((ref) => `${ref.file}:${String(ref.line)} ${ref.field}`),
  );
}

type Line = { line: number };

async function lines(db: Db, query: SQL): Promise<number[]> {
  const rows = await db.execute<Line>(query, 'objects');
  return rows.map((row) => row.line);
}

async function count(db: Db, query: SQL): Promise<number> {
  const [row] = await db.execute<{ n: number }>(query, 'objects');
  return row?.n ?? 0;
}

type ShrinkTable = (typeof SHRINK_RETIRING)[number] | (typeof SHRINK_ALL_ROWS)[number];

function liveCountQuery(table: ShrinkTable): SQL {
  const name = sql.identifier(table);
  if (table === 'people') {
    // A person a filing or an admin created is in no bundle (T-people).
    return sql`select count(*)::int as n from ${name}
               where retired_at is null and origin ->> 'created_by' = 'bundle'`;
  }
  if ((SHRINK_RETIRING as readonly string[]).includes(table)) {
    return sql`select count(*)::int as n from ${name} where retired_at is null`;
  }
  return sql`select count(*)::int as n from ${name}`;
}

async function shrinkGates(
  db: Db,
  bundleId: string,
  files: readonly string[],
): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const table of [...SHRINK_RETIRING, ...SHRINK_ALL_ROWS]) {
    if (!files.includes(table)) {
      continue; // an absent file leaves its table untouched
    }
    // index: bundle_rows_key
    const staged = await count(
      db,
      sql`select count(*)::int as n from staging.bundle_rows where bundle_id = ${bundleId}::uuid and file = ${table}`,
    );
    const live = await count(db, liveCountQuery(table));
    if (live === 0) {
      continue;
    }
    const name = `shrink:${table}`;
    results.push(
      staged * 100 >= live * SHRINK_MIN_PERCENT
        ? passed(name)
        : failed(name, `rows ${String(staged)} of live ${String(live)}`),
    );
  }
  return results;
}

/** A key field of a staged file and the file its key names (PIPE-loader-gates). */
type Reference = { file: FullFileR0; field: string; target: FullFileR0; nullable: boolean };

const REFERENCES: readonly Reference[] = [
  { file: 'jurisdictions', field: 'parent_key', target: 'jurisdictions', nullable: true },
  { file: 'districts', field: 'jurisdiction_key', target: 'jurisdictions', nullable: false },
  { file: 'district_fallbacks', field: 'district_key', target: 'districts', nullable: false },
  { file: 'district_fallbacks', field: 'via_district_key', target: 'districts', nullable: false },
  { file: 'offices', field: 'district_key', target: 'districts', nullable: false },
  { file: 'offices', field: 'jurisdiction_key', target: 'jurisdictions', nullable: false },
  { file: 'office_powers', field: 'office_key', target: 'offices', nullable: false },
  { file: 'elections', field: 'office_key', target: 'offices', nullable: false },
  { file: 'officeholders', field: 'office_key', target: 'offices', nullable: false },
  { file: 'filing_tracks', field: 'election_key', target: 'elections', nullable: false },
  { file: 'person_aliases', field: 'person_key', target: 'people', nullable: false },
  { file: 'officeholders', field: 'person_key', target: 'people', nullable: false },
];

/** The live tables a reference can resolve against when its target file is absent. */
const LIVE_TARGETS = {
  jurisdictions: 'jurisdictions',
  districts: 'districts',
  offices: 'offices',
  elections: 'elections',
  people: 'people',
} as const;

function liveTarget(target: FullFileR0): (typeof LIVE_TARGETS)[keyof typeof LIVE_TARGETS] {
  if (!(target in LIVE_TARGETS)) {
    throw new RangeError('No live table for this reference target.');
  }
  return LIVE_TARGETS[target as keyof typeof LIVE_TARGETS];
}

function unresolvedQuery(
  bundleId: string,
  ref: Reference,
  targetStaged: boolean,
  limit: number,
): SQL {
  const notNull = ref.nullable ? sql`and r.data ->> ${ref.field} is not null` : sql``;
  const resolves = targetStaged
    ? // index: bundle_rows_key
      sql`select 1 from staging.bundle_rows t
          where t.bundle_id = ${bundleId}::uuid and t.file = ${ref.target}
            and t.source_key = r.data ->> ${ref.field}`
    : // index: <table>_source_key_key
      sql`select 1 from ${sql.identifier(liveTarget(ref.target))} t where t.source_key = r.data ->> ${ref.field}`;
  // index: bundle_rows_key
  return sql`select r.line from staging.bundle_rows r
             where r.bundle_id = ${bundleId}::uuid and r.file = ${ref.file} ${notNull}
               and not exists (${resolves})
             order by r.line
             limit ${limit}`;
}

/** Fallback rows whose district is exact, or whose via district is not (T-district_fallbacks). */
function fallbackQualityQuery(
  bundleId: string,
  field: 'district_key' | 'via_district_key',
  districtsStaged: boolean,
  limit: number,
): SQL {
  const wrong = field === 'district_key' ? sql`= 'exact'` : sql`<> 'exact'`;
  const target = districtsStaged
    ? // index: bundle_rows_key
      sql`select 1 from staging.bundle_rows t
          where t.bundle_id = ${bundleId}::uuid and t.file = 'districts'
            and t.source_key = r.data ->> ${field} and t.data ->> 'geometry_quality' ${wrong}`
    : // index: districts_source_key_key
      sql`select 1 from districts t where t.source_key = r.data ->> ${field} and t.geometry_quality ${wrong}`;
  // index: bundle_rows_key
  return sql`select r.line from staging.bundle_rows r
             where r.bundle_id = ${bundleId}::uuid and r.file = 'district_fallbacks'
               and exists (${target})
             order by r.line
             limit ${limit}`;
}

async function referencesGate(
  db: Db,
  bundleId: string,
  files: readonly string[],
  report: StageReport,
): Promise<GateResult> {
  const entries: string[] = [];
  for (const ref of REFERENCES) {
    if (entries.length >= DETAIL_ENTRIES || !files.includes(ref.file)) {
      continue;
    }
    const found = await lines(
      db,
      unresolvedQuery(bundleId, ref, files.includes(ref.target), DETAIL_ENTRIES - entries.length),
    );
    entries.push(...found.map((line) => `${ref.file}:${String(line)} ${ref.field}`));
  }
  if (files.includes('district_fallbacks')) {
    for (const field of ['district_key', 'via_district_key'] as const) {
      if (entries.length >= DETAIL_ENTRIES) {
        break;
      }
      const found = await lines(
        db,
        fallbackQualityQuery(
          bundleId,
          field,
          files.includes('districts'),
          DETAIL_ENTRIES - entries.length,
        ),
      );
      entries.push(...found.map((line) => `district_fallbacks:${String(line)} ${field}`));
    }
  }
  entries.push(
    ...report.duplicateKeys.map((ref) => `${ref.file}:${String(ref.line)} duplicate key`),
  );
  return gate('references', entries);
}

async function referenceIdsGate(
  db: Db,
  bundleId: string,
  files: readonly string[],
): Promise<GateResult> {
  const entries: string[] = [];
  if (files.includes('offices')) {
    // index: bundle_rows_key; office_types_pkey
    const found = await lines(
      db,
      sql`select r.line from staging.bundle_rows r
          where r.bundle_id = ${bundleId}::uuid and r.file = 'offices'
            and not exists (select 1 from office_types t where t.id = r.data ->> 'office_type_id')
          order by r.line
          limit ${DETAIL_ENTRIES}`,
    );
    entries.push(...found.map((line) => `offices:${String(line)} office_type_id`));
  }
  if (files.includes('office_powers') && entries.length < DETAIL_ENTRIES) {
    // index: bundle_rows_key; powers_pkey
    const found = await lines(
      db,
      sql`select r.line from staging.bundle_rows r
          where r.bundle_id = ${bundleId}::uuid and r.file = 'office_powers'
            and not exists (select 1 from powers t where t.id = r.data ->> 'power_id')
          order by r.line
          limit ${DETAIL_ENTRIES - entries.length}`,
    );
    entries.push(...found.map((line) => `office_powers:${String(line)} power_id`));
  }
  return gate('reference_ids', entries);
}

async function deadlinesGate(
  db: Db,
  bundleId: string,
  files: readonly string[],
): Promise<GateResult> {
  if (!files.includes('filing_tracks')) {
    return passed('deadlines_before_elections');
  }
  // ISO dates (YYYY-MM-DD, the row schema's form) order as text exactly as they order as dates, and
  // a text comparison cannot fail on a malformed day. A null makes the comparison null: no failure.
  const election = files.includes('elections')
    ? // index: bundle_rows_key
      sql`select e.data ->> 'election_date' as election_date from staging.bundle_rows e
          where e.bundle_id = ${bundleId}::uuid and e.file = 'elections'
            and e.source_key = t.data ->> 'election_key'
          limit 1`
    : // index: elections_source_key_key
      sql`select e.election_date::text as election_date from elections e
          where e.source_key = t.data ->> 'election_key'`;
  // index: bundle_rows_key
  const found = await lines(
    db,
    sql`select t.line from staging.bundle_rows t
        cross join lateral (${election}) e
        where t.bundle_id = ${bundleId}::uuid and t.file = 'filing_tracks'
          and ((t.data ->> 'closes_on') > e.election_date
            or (t.data ->> 'opens_on') > (t.data ->> 'closes_on')
            or (t.data ->> 'petition_due') > e.election_date)
        order by t.line
        limit ${DETAIL_ENTRIES}`,
  );
  return gate(
    'deadlines_before_elections',
    found.map((line) => `filing_tracks:${String(line)}`),
  );
}

/** shrink:<table> entries, references, reference_ids and deadlines_before_elections, in that order. */
export async function sqlGates(
  db: Db,
  bundleId: string,
  files: readonly string[],
  report: StageReport = {
    rows: {},
    checksumFailures: [],
    schemaFailures: [],
    personalData: [],
    duplicateKeys: [],
  },
): Promise<GateResult[]> {
  return [
    ...(await shrinkGates(db, bundleId, files)),
    await referencesGate(db, bundleId, files, report),
    await referenceIdsGate(db, bundleId, files),
    await deadlinesGate(db, bundleId, files),
  ];
}

/** geometry (D-208, B-geometry): exact districts have both shapes, staged or loaded with the same hash; no other has any; hashes agree. */
export async function geometryGate(db: Db, bundleId: string): Promise<GateResult> {
  const entries: string[] = [];
  // index: bundle_rows_key; district_geometry_pkey; districts_source_key_key; district_parts_district
  const exactMissing = await lines(
    db,
    sql`select d.line from staging.bundle_rows d
        where d.bundle_id = ${bundleId}::uuid and d.file = 'districts'
          and d.data ->> 'geometry_quality' = 'exact'
          and not exists (select 1 from staging.district_geometry g
                          where g.bundle_id = d.bundle_id and g.source_key = d.source_key
                            and g.lookup_geom is not null and g.display_geom is not null
                            and g.geom_hash = d.data ->> 'geom_hash')
          and not exists (select 1 from districts l
                          where l.source_key = d.source_key and l.geom is not null
                            and l.geom_hash = d.data ->> 'geom_hash'
                            and exists (select 1 from district_parts p where p.district_id = l.id))
        order by d.line
        limit ${DETAIL_ENTRIES}`,
  );
  entries.push(...exactMissing.map((line) => `districts:${String(line)} a`));
  // index: bundle_rows_key; district_geometry_pkey
  const approximateWithShape = await lines(
    db,
    sql`select d.line from staging.bundle_rows d
        join staging.district_geometry g on g.bundle_id = d.bundle_id and g.source_key = d.source_key
        where d.bundle_id = ${bundleId}::uuid and d.file = 'districts'
          and d.data ->> 'geometry_quality' <> 'exact'
          and (g.lookup_geom is not null or g.display_geom is not null)
        order by d.line
        limit ${DETAIL_ENTRIES}`,
  );
  entries.push(...approximateWithShape.map((line) => `districts:${String(line)} b`));
  // index: district_geometry_pkey; bundle_rows_key
  const hashDiffers = await lines(
    db,
    sql`select d.line from staging.district_geometry g
        join staging.bundle_rows d on d.bundle_id = g.bundle_id and d.file = 'districts' and d.source_key = g.source_key
        where g.bundle_id = ${bundleId}::uuid and g.geom_hash <> d.data ->> 'geom_hash'
        order by d.line
        limit ${DETAIL_ENTRIES}`,
  );
  entries.push(...hashDiffers.map((line) => `districts:${String(line)} c`));
  return gate('geometry', entries);
}

/**
 * assets (PIPE-loader-assets): every asset a staged row references is listed in the
 * manifest; every listed asset not yet in the media store is read, its hash and format checked and,
 * for a photo, decoded and re-encoded (the result is discarded: nothing is written here).
 */
export async function assetsGate(
  db: Db,
  reader: BundleReader,
  manifest: BundleManifest,
  bundleId: string,
  media: MediaAssetWriter,
): Promise<{ gate: GateResult; assets: AssetRef[] }> {
  const entries: string[] = [];
  // index: bundle_rows_key
  const referenced = await db.execute<{ line: number; asset: string | null }>(
    sql`select r.line, r.data -> 'photo' ->> 'asset' as asset from staging.bundle_rows r
        where r.bundle_id = ${bundleId}::uuid and r.file = 'people'
          and jsonb_typeof(r.data -> 'photo') = 'object'
        order by r.line`,
    'objects',
  );
  const listed = new Map(
    manifest.assets
      .filter((asset) => asset.kind === 'photo')
      .map((asset) => [posix.normalize(asset.path), asset] as const),
  );
  const used = new Map<string, (typeof manifest.assets)[number]>();
  for (const row of referenced) {
    const asset = row.asset === null ? undefined : listed.get(posix.normalize(row.asset));
    if (asset === undefined) {
      entries.push(`people:${String(row.line)} asset not listed`);
      continue;
    }
    used.set(asset.sha256, asset);
  }
  const assets: AssetRef[] = [];
  for (const asset of used.values()) {
    const mediaKey =
      asset.kind === 'photo' ? civicPhotoKey(asset.sha256) : civicFormKey(asset.sha256);
    const present = await media.store.exists(mediaKey);
    assets.push({
      kind: asset.kind,
      sha256: asset.sha256,
      path: asset.path,
      bytes: asset.bytes,
      mediaKey,
      present,
    });
    if (present) {
      continue; // verified when it was first written; its name is its content hash
    }
    if (!(await assetReadable(reader, asset, media))) {
      entries.push(`${asset.kind} ${asset.sha256}`);
    }
  }
  return { gate: gate('assets', entries), assets };
}

async function assetReadable(
  reader: BundleReader,
  asset: BundleManifest['assets'][number],
  media: MediaAssetWriter,
): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = await reader.bytes(asset.path, { sha256: asset.sha256, bytes: asset.bytes });
  } catch (error) {
    if (error instanceof BundleChecksumError) {
      return false;
    }
    throw error;
  }
  if (!assetFormatOk(asset.kind, bytes)) {
    return false;
  }
  if (asset.kind === 'photo') {
    try {
      await media.reencodePhoto(bytes);
    } catch {
      // An undecodable photo rejects the bundle before anything is written.
      return false;
    }
  }
  return true;
}
