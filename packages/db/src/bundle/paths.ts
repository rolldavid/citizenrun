import { posix } from 'node:path';
import type { BundleManifest } from '@citizenrun/shared';
import { BundlePathError } from './errors.ts';

// Bundle paths (B-manifest, B-sample). Every path is posix and relative to a manifest's folder.

const PHOTO_PATH = /^(?:\.\.\/){1,2}assets\/photos\/([0-9a-f]{64})\.jpg$/;
const FORM_PATH = /^(?:\.\.\/){1,2}assets\/forms\/([0-9a-f]{64})\.pdf$/;

/** posix-normalises `rel` against the folder of `base` (a manifest path); throws BundlePathError when the result starts with '../' or '/'. */
export function resolveRelative(base: string, rel: string): string {
  if (rel.startsWith('/')) {
    throw new BundlePathError(rel);
  }
  const resolved = posix.normalize(posix.join(posix.dirname(base), rel));
  if (resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) {
    throw new BundlePathError(rel);
  }
  return resolved;
}

/** The manifest of a geometry version, relative to a full manifest's folder: '../geometry/manifest.json' for a 'sample-' version (B-sample), else '../<version>/manifest.json'. */
export function geometryManifestRelPathOf(geometryVersion: string): string {
  return geometryVersion.startsWith('sample-')
    ? '../geometry/manifest.json'
    : `../${geometryVersion}/manifest.json`;
}

/** The geometry manifest of a full manifest, relative to the full manifest's folder: null when geometry_version is null;
 *  '../geometry/manifest.json' when it starts with 'sample-' (B-sample); otherwise '../<geometry_version>/manifest.json'. */
export function geometryManifestRelPath(manifest: BundleManifest): string | null {
  return manifest.geometry_version === null
    ? null
    : geometryManifestRelPathOf(manifest.geometry_version);
}

/** Kind and sha256 of an asset path: `../../assets/photos/<sha>.jpg` or `../../assets/forms/<sha>.pdf` (bucket rows), or `../assets/photos/<sha>.jpg` or `../assets/forms/<sha>.pdf` (B-sample rows), `<sha>` being 64 lower-case hex characters; null for any other shape. */
export function assetShaFromPath(rel: string): { kind: 'photo' | 'form'; sha256: string } | null {
  const photo = PHOTO_PATH.exec(rel)?.[1];
  if (photo !== undefined) {
    return { kind: 'photo', sha256: photo };
  }
  const form = FORM_PATH.exec(rel)?.[1];
  if (form !== undefined) {
    return { kind: 'form', sha256: form };
  }
  return null;
}

/** A path relative to another manifest's folder, re-expressed relative to the root manifest's folder:
 *  posix.normalize(posix.join(posix.dirname(manifestRel), rel)). joinRelative('../G/manifest.json', '../E/geometry/NC.ndjson.gz') is '../E/geometry/NC.ndjson.gz'. */
export function joinRelative(manifestRel: string, rel: string): string {
  return posix.normalize(posix.join(posix.dirname(manifestRel), rel));
}
