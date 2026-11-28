import { BGeometrySchema, civicId, looksPersonal } from '@citizenrun/shared';
import type { BGeometry, BundleManifest } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../client.ts';
import {
  BundleChecksumError,
  BundleGeometryManifestError,
  BundleManifestTooLargeError,
  BundleObjectMissingError,
} from './errors.ts';
import { checkCompatibility } from './gates.ts';
import { geometryManifestRelPath, geometryManifestRelPathOf, joinRelative } from './paths.ts';
import type { BundleReader } from './reader.ts';
import { CIVIC_ID_TABLE, FULL_FILES_R0, ROW_SCHEMAS } from './tables.ts';
import type { FullFileR0 } from './tables.ts';

// Staging (PIPE-loader): every validated line into staging.bundle_rows with its civic
// id, changed geometry into staging.district_geometry. A failing line is recorded by file and line
// only: never its content, never the parser's message (CTL-30).

export const STAGE_BATCH_ROWS = 1000; // PIPE-loader
export const GEOMETRY_BATCH_HEX_CHARS = 64_000_000; // a geometry batch also closes at this many WKB hex characters
export const SCHEMA_FAILURES_KEPT = 20; // PIPE-loader
const REPORT_ENTRIES_KEPT = 20; // PIPE-loader-gates: at most 20 entries per list

export type LineRef = { file: string; line: number }; // line is 1-based

export type StageReport = {
  rows: Partial<Record<FullFileR0 | 'zip_centroids', number>>;
  checksumFailures: string[]; // bundle-relative file paths
  schemaFailures: LineRef[]; // at most SCHEMA_FAILURES_KEPT
  personalData: (LineRef & { field: string })[]; // at most 20
  duplicateKeys: LineRef[]; // the second and later rows of a file with the same source_key, at most 20
};

type StagedFile = FullFileR0 | 'zip_centroids';
type StagedRow = { line: number; id: string | null; sourceKey: string; data: string };

/** The scanned name fields of each file (PIPE-loader-gates `personal_data`, D-084). */
const PERSONAL_FIELDS: Partial<Record<StagedFile, readonly string[]>> = {
  people: ['name', 'first_name', 'middle_name', 'last_name', 'suffix'],
  person_aliases: ['alias'],
  officeholders: ['seat_label'],
};

/** A report with nothing in it. */
export function emptyStageReport(): StageReport {
  return {
    rows: {},
    checksumFailures: [],
    schemaFailures: [],
    personalData: [],
    duplicateKeys: [],
  };
}

/** Empties both staging tables, every bundle's rows. */
export async function clearStaging(db: Db): Promise<void> {
  await db.execute(sql`delete from staging.bundle_rows`);
  await db.execute(sql`delete from staging.district_geometry`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parsed row of one line, or null when the line is not JSON or fails its strict schema. */
function parseLine(
  schema: (typeof ROW_SCHEMAS)[keyof typeof ROW_SCHEMAS],
  text: string,
): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success || !isRecord(parsed.data) || typeof parsed.data.source_key !== 'string') {
    return null;
  }
  return parsed.data;
}

function recordSchemaFailure(report: StageReport, ref: LineRef): void {
  if (report.schemaFailures.length < SCHEMA_FAILURES_KEPT) {
    report.schemaFailures.push(ref);
  }
}

function scanPersonal(
  report: StageReport,
  file: StagedFile,
  line: number,
  row: Record<string, unknown>,
): void {
  for (const field of PERSONAL_FIELDS[file] ?? []) {
    const value = row[field];
    if (
      typeof value === 'string' &&
      looksPersonal(value) &&
      report.personalData.length < REPORT_ENTRIES_KEPT
    ) {
      report.personalData.push({ file, line, field });
    }
  }
}

async function insertRows(
  db: Db,
  bundleId: string,
  file: StagedFile,
  rows: readonly StagedRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await db.execute(
    sql`insert into staging.bundle_rows (bundle_id, file, line, id, source_key, data)
        select ${bundleId}::uuid, ${file}, l.line, l.id, l.source_key, l.data
        from unnest(${sql.param(rows.map((row) => row.line))}::int[],
                    ${sql.param(rows.map((row) => row.id))}::uuid[],
                    ${sql.param(rows.map((row) => row.sourceKey))}::text[],
                    ${sql.param(rows.map((row) => row.data))}::jsonb[])
          as l(line, id, source_key, data)`,
  );
}

async function recordDuplicates(
  db: Db,
  bundleId: string,
  file: StagedFile,
  report: StageReport,
): Promise<void> {
  const room = REPORT_ENTRIES_KEPT - report.duplicateKeys.length;
  if (room <= 0) {
    return;
  }
  // A new bundle's rows have no planner statistics yet; without them this check plans as a nested
  // loop over the whole file and runs for many minutes on a national bundle.
  await db.execute(sql`analyze staging.bundle_rows`);
  // index: bundle_rows_key
  const rows = await db.execute<{ line: number }>(
    sql`select line from staging.bundle_rows b
        where bundle_id = ${bundleId}::uuid and file = ${file}
          and exists (select 1 from staging.bundle_rows a
                      where a.bundle_id = b.bundle_id and a.file = b.file
                        and a.source_key = b.source_key and a.line < b.line)
        order by line
        limit ${room}`,
    'objects',
  );
  for (const row of rows) {
    report.duplicateKeys.push({ file, line: row.line });
  }
}

/** Stages one gzip NDJSON file of rows into staging.bundle_rows; a checksum failure is recorded and staging goes on. */
async function stageRows(
  db: Db,
  reader: BundleReader,
  bundleId: string,
  file: StagedFile,
  entry: { path: string; sha256: string; bytes: number },
  report: StageReport,
): Promise<void> {
  const schema = ROW_SCHEMAS[file];
  const table = CIVIC_ID_TABLE[file];
  let batch: StagedRow[] = [];
  let line = 0;
  let staged = 0;
  try {
    for await (const text of reader.lines(entry.path, entry)) {
      line += 1;
      const row = parseLine(schema, text);
      if (row === null) {
        recordSchemaFailure(report, { file, line });
        continue;
      }
      scanPersonal(report, file, line, row);
      const sourceKey = String(row.source_key);
      batch.push({
        line,
        id: table === null ? null : civicId(table, sourceKey),
        sourceKey,
        data: JSON.stringify(row),
      });
      staged += 1;
      if (batch.length >= STAGE_BATCH_ROWS) {
        await insertRows(db, bundleId, file, batch);
        batch = [];
      }
    }
    await insertRows(db, bundleId, file, batch);
  } catch (error) {
    if (!(error instanceof BundleChecksumError)) {
      throw error;
    }
    report.checksumFailures.push(entry.path);
  }
  report.rows[file] = (report.rows[file] ?? 0) + staged;
  await recordDuplicates(db, bundleId, file, report);
}

/** Stages every FULL_FILES_R0 file the manifest lists, in that order; a file it does not list is skipped and its table left untouched. */
export async function stageFullFiles(
  db: Db,
  reader: BundleReader,
  manifest: BundleManifest,
  bundleId: string,
): Promise<StageReport> {
  const report = emptyStageReport();
  for (const file of FULL_FILES_R0) {
    const entry = manifest.files.find((candidate) => candidate.name === file);
    if (entry !== undefined) {
      await stageRows(db, reader, bundleId, file, entry, report);
    }
  }
  return report;
}

type GeometryRow = BGeometry & { line: number };

/** A float8[] literal of an outline box, or null. */
function bboxLiteral(bbox: BGeometry['outline_bbox']): string | null {
  return bbox === null ? null : `{${bbox.map((value) => String(value)).join(',')}}`;
}

async function insertGeometry(
  db: Db,
  bundleId: string,
  rows: readonly GeometryRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  // unnest flattens a two-dimensional array into its elements, so each outline_bbox travels as the
  // text of a one-dimensional float8[] (null for none) and is cast per row.
  await db.execute(
    sql`insert into staging.district_geometry (bundle_id, source_key, lookup_geom, display_geom, label_point, outline_svg, outline_bbox, geom_hash)
        select ${bundleId}::uuid, g.source_key,
               case when g.lookup_wkb is null then null else st_multi(st_setsrid(st_geomfromwkb(decode(g.lookup_wkb, 'hex')), 4326)) end,
               case when g.display_wkb is null then null else st_multi(st_setsrid(st_geomfromwkb(decode(g.display_wkb, 'hex')), 4326)) end,
               case when g.lng is null then null else st_setsrid(st_makepoint(g.lng, g.lat), 4326) end,
               g.outline_svg, g.outline_bbox::float8[], g.geom_hash
        from unnest(${sql.param(rows.map((row) => row.source_key))}::text[],
                    ${sql.param(rows.map((row) => row.lookup_wkb))}::text[],
                    ${sql.param(rows.map((row) => row.display_wkb))}::text[],
                    ${sql.param(rows.map((row) => row.label_point?.[0] ?? null))}::float8[],
                    ${sql.param(rows.map((row) => row.label_point?.[1] ?? null))}::float8[],
                    ${sql.param(rows.map((row) => row.outline_svg))}::text[],
                    ${sql.param(rows.map((row) => bboxLiteral(row.outline_bbox)))}::text[],
                    ${sql.param(rows.map((row) => row.geom_hash))}::text[])
          as g(source_key, lookup_wkb, display_wkb, lng, lat, outline_svg, outline_bbox, geom_hash)`,
  );
}

/** Stages one geometry state file into staging.district_geometry. */
async function stageGeometryFile(
  db: Db,
  reader: BundleReader,
  bundleId: string,
  state: string,
  entry: { path: string; sha256: string; bytes: number },
  seen: Set<string>,
  report: StageReport,
): Promise<void> {
  const file = `geometry/${state}`;
  let batch: GeometryRow[] = [];
  let hexChars = 0;
  let line = 0;
  try {
    for await (const text of reader.lines(entry.path, entry)) {
      line += 1;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        recordSchemaFailure(report, { file, line });
        continue;
      }
      const parsed = BGeometrySchema.safeParse(value);
      if (!parsed.success) {
        recordSchemaFailure(report, { file, line });
        continue;
      }
      const row = parsed.data;
      if (seen.has(row.source_key)) {
        if (report.duplicateKeys.length < REPORT_ENTRIES_KEPT) {
          report.duplicateKeys.push({ file, line });
        }
        continue;
      }
      seen.add(row.source_key);
      batch.push({ ...row, line });
      hexChars += (row.lookup_wkb?.length ?? 0) + (row.display_wkb?.length ?? 0);
      if (batch.length >= STAGE_BATCH_ROWS || hexChars >= GEOMETRY_BATCH_HEX_CHARS) {
        await insertGeometry(db, bundleId, batch);
        batch = [];
        hexChars = 0;
      }
    }
    await insertGeometry(db, bundleId, batch);
  } catch (error) {
    if (!(error instanceof BundleChecksumError)) {
      throw error;
    }
    report.checksumFailures.push(entry.path);
  }
}

function isUnreadableManifest(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    error instanceof BundleManifestTooLargeError ||
    error instanceof BundleObjectMissingError ||
    (error instanceof Error && error.name === 'ZodError')
  );
}

async function readPreviousGeometry(
  reader: BundleReader,
  previousGeometryVersion: string,
): Promise<BundleManifest | null> {
  try {
    return await reader.readManifest(geometryManifestRelPathOf(previousGeometryVersion));
  } catch {
    // Unreadable: every state file is staged.
    return null;
  }
}

/**
 * Stages the geometry of a full manifest when its geometry_version differs from the last loaded
 * one (PIPE-loader): each state file whose sha256 differs from the previous geometry
 * manifest's, and always the zip_centroids file. Throws BundleGeometryManifestError when the
 * geometry manifest cannot be read or is not compatible (gate schema_compatible).
 */
export async function stageGeometry(
  db: Db,
  reader: BundleReader,
  input: { bundleId: string; manifest: BundleManifest; previousGeometryVersion: string | null },
  report: StageReport,
): Promise<{ staged: boolean; states: string[] }> {
  const { bundleId, manifest, previousGeometryVersion } = input;
  const relPath = geometryManifestRelPath(manifest);
  if (relPath === null || manifest.geometry_version === previousGeometryVersion) {
    return { staged: false, states: [] };
  }
  let geometry: BundleManifest;
  try {
    geometry = await reader.readManifest(relPath);
  } catch (error) {
    if (isUnreadableManifest(error)) {
      throw new BundleGeometryManifestError({
        name: 'schema_compatible',
        passed: false,
        detail: 'geometry manifest invalid',
      });
    }
    throw error;
  }
  const compatible = checkCompatibility(geometry, 'geometry');
  if (!compatible.passed) {
    throw new BundleGeometryManifestError(compatible);
  }
  if (geometry.version !== manifest.geometry_version) {
    throw new BundleGeometryManifestError({
      name: 'schema_compatible',
      passed: false,
      detail: 'geometry version differs from geometry_version',
    });
  }
  const previous =
    previousGeometryVersion === null
      ? null
      : await readPreviousGeometry(reader, previousGeometryVersion);
  const previousSha = new Map<string, string>();
  for (const file of previous?.files ?? []) {
    if (file.name === 'geometry' && file.state !== null) {
      previousSha.set(file.state, file.sha256);
    }
  }
  const seen = new Set<string>();
  const states: string[] = [];
  for (const file of geometry.files) {
    if (
      file.name !== 'geometry' ||
      file.state === null ||
      previousSha.get(file.state) === file.sha256
    ) {
      continue;
    }
    states.push(file.state);
    await stageGeometryFile(
      db,
      reader,
      bundleId,
      file.state,
      { ...file, path: joinRelative(relPath, file.path) },
      seen,
      report,
    );
  }
  for (const file of geometry.files) {
    if (file.name === 'zip_centroids') {
      await stageRows(
        db,
        reader,
        bundleId,
        'zip_centroids',
        { ...file, path: joinRelative(relPath, file.path) },
        report,
      );
    }
  }
  return { staged: true, states };
}
