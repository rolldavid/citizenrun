import type { GateResult } from './stats.ts';

// The load core's errors. A message names a bundle-relative path at most, never a byte of content.

/** A file's sha256 or byte count differs from the manifest, its gzip fails, or it is missing. */
export class BundleChecksumError extends Error {
  override readonly name = 'BundleChecksumError';
  readonly path: string;

  constructor(path: string) {
    super(`The bundle file ${path} does not match its manifest.`);
    this.path = path;
  }
}

/** A relative path leaves the bucket root or the sample folder. */
export class BundlePathError extends Error {
  override readonly name = 'BundlePathError';

  constructor(path: string) {
    super(`The bundle path ${path} leaves the bundle root.`);
  }
}

/** DataBucketClient.getStream: no such key. */
export class BundleObjectMissingError extends Error {
  override readonly name = 'BundleObjectMissingError';

  constructor(key: string) {
    super(`The bundle object ${key} does not exist.`);
  }
}

/** A manifest is larger than MANIFEST_MAX_BYTES, so it is not read. */
export class BundleManifestTooLargeError extends Error {
  override readonly name = 'BundleManifestTooLargeError';

  constructor(path: string) {
    super(`The bundle manifest ${path} is too large.`);
  }
}

/** The geometry manifest a full manifest names cannot be loaded: the gate schema_compatible fails with `gate`. */
export class BundleGeometryManifestError extends Error {
  override readonly name = 'BundleGeometryManifestError';
  readonly gate: GateResult;

  constructor(gate: GateResult) {
    super('The geometry manifest of the bundle is not compatible.');
    this.gate = gate;
  }
}
