// Step 9 of the bundle writer: a geometry bundle only when a state's geometry or the ZIP file
// changed; an unchanged file is referenced from the version that holds its bytes (B-geometry).
import { BGeometrySchema, BZipCentroidSchema } from '@citizenrun/shared';
import type { BGeometry, BZipCentroid, BundleManifest } from '@citizenrun/shared';
import { encodeFile } from './files.ts';

export type GeometryFilePlan = {
  readonly name: 'geometry' | 'zip_centroids';
  readonly state: string | null;
  /** The path relative to the new geometry bundle's folder. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly rows: number;
  /** The bytes to write; null when an earlier version holds them. */
  readonly data: Uint8Array | null;
};

const ZIP_PATH = 'zip_centroids.ndjson.gz';

export function geometryPath(state: string): string {
  return `geometry/${state}.ndjson.gz`;
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** The current entry's path as seen from a sibling folder: one level deep, never a reference to a reference. */
function holderPath(current: BundleManifest, path: string): string {
  return path.startsWith('../') ? path : `../${current.version}/${path}`;
}

/**
 * Encodes each state's geometry rows and the ZIP centroids and compares each SHA-256 with the
 * current geometry manifest. `changed` is true when any file differs, a state was added or left
 * out, or there is no current manifest.
 */
export function planGeometry(
  stateRows: ReadonlyMap<string, readonly BGeometry[]>,
  zip: readonly BZipCentroid[],
  current: BundleManifest | null,
): { changed: boolean; files: GeometryFilePlan[] } {
  const files: GeometryFilePlan[] = [];
  let changed = current === null;
  const plan = (
    name: GeometryFilePlan['name'],
    state: string | null,
    path: string,
    encoded: { bytes: Uint8Array; sha256: string; rows: number },
  ) => {
    const before = current?.files.find((file) => file.name === name && file.state === state);
    if (current !== null && before !== undefined && before.sha256 === encoded.sha256) {
      files.push({
        name,
        state,
        path: holderPath(current, before.path),
        sha256: before.sha256,
        bytes: before.bytes,
        rows: before.rows,
        data: null,
      });
      return;
    }
    changed = true;
    files.push({
      name,
      state,
      path,
      sha256: encoded.sha256,
      bytes: encoded.bytes.byteLength,
      rows: encoded.rows,
      data: encoded.bytes,
    });
  };
  const states = [...stateRows.keys()].sort(byteOrder);
  for (const state of states) {
    plan(
      'geometry',
      state,
      geometryPath(state),
      encodeFile(stateRows.get(state) ?? [], BGeometrySchema, 'geometry'),
    );
  }
  plan('zip_centroids', null, ZIP_PATH, encodeFile(zip, BZipCentroidSchema, 'zip_centroids'));
  if (current !== null) {
    const before = current.files
      .filter((file) => file.name === 'geometry')
      .map((file) => file.state ?? '')
      .sort(byteOrder);
    if (before.join(',') !== states.join(',')) {
      changed = true;
    }
  }
  return { changed, files };
}
