import { describe, expect, it } from 'vitest';
import type { BundleManifest } from '@citizenrun/shared';
import { BundlePathError } from './errors.ts';
import {
  assetShaFromPath,
  geometryManifestRelPath,
  joinRelative,
  resolveRelative,
} from './paths.ts';

const SHA = 'ab'.repeat(32);
const MANIFEST = 'bundles/20270115T060000Z-full/manifest.json';

function withGeometry(geometryVersion: string | null): BundleManifest {
  // Only geometry_version is read.
  return { geometry_version: geometryVersion } as BundleManifest;
}

describe('bundle paths', () => {
  it('resolves sibling and asset paths', () => {
    expect(resolveRelative(MANIFEST, `../../assets/photos/${SHA}.jpg`)).toBe(
      `assets/photos/${SHA}.jpg`,
    );
    expect(resolveRelative(MANIFEST, 'offices.ndjson.gz')).toBe(
      'bundles/20270115T060000Z-full/offices.ndjson.gz',
    );
    expect(resolveRelative(MANIFEST, '../20270101T000000Z-geometry/geometry/ZZ.ndjson.gz')).toBe(
      'bundles/20270101T000000Z-geometry/geometry/ZZ.ndjson.gz',
    );
  });

  it('refuses a path that leaves the root', () => {
    expect(() => resolveRelative(MANIFEST, '../../../etc/passwd')).toThrow(BundlePathError);
    expect(() => resolveRelative(MANIFEST, '/etc/passwd')).toThrow(BundlePathError);
    expect(() => resolveRelative(MANIFEST, '../../..')).toThrow(BundlePathError);
  });

  it('names the geometry manifest', () => {
    expect(geometryManifestRelPath(withGeometry('20270101T000000Z-geometry'))).toBe(
      '../20270101T000000Z-geometry/manifest.json',
    );
    expect(geometryManifestRelPath(withGeometry('sample-20270101T000000Z-geometry'))).toBe(
      '../geometry/manifest.json',
    );
    expect(geometryManifestRelPath(withGeometry(null))).toBeNull();
  });

  it('reads an asset hash from its path', () => {
    expect(assetShaFromPath(`../../assets/photos/${SHA}.jpg`)).toEqual({
      kind: 'photo',
      sha256: SHA,
    });
    expect(assetShaFromPath(`../../assets/forms/${SHA}.pdf`)).toEqual({
      kind: 'form',
      sha256: SHA,
    });
    expect(assetShaFromPath(`../assets/photos/${SHA}.jpg`)).toEqual({ kind: 'photo', sha256: SHA });
    expect(assetShaFromPath(`../assets/forms/${SHA}.pdf`)).toEqual({ kind: 'form', sha256: SHA });
    expect(assetShaFromPath('../../assets/photos/x.jpg')).toBeNull();
    expect(assetShaFromPath(`../../../assets/photos/${SHA}.jpg`)).toBeNull();
    expect(assetShaFromPath(`../../assets/photos/${SHA}.pdf`)).toBeNull();
    expect(assetShaFromPath(`../../assets/photos/${SHA.toUpperCase()}.jpg`)).toBeNull();
  });

  it('joins a path of another manifest onto the root folder', () => {
    expect(joinRelative('../G/manifest.json', '../E/geometry/NC.ndjson.gz')).toBe(
      '../E/geometry/NC.ndjson.gz',
    );
    expect(joinRelative('../G/manifest.json', 'geometry/NC.ndjson.gz')).toBe(
      '../G/geometry/NC.ndjson.gz',
    );
    expect(joinRelative('../geometry/manifest.json', 'zip_centroids.ndjson.gz')).toBe(
      '../geometry/zip_centroids.ndjson.gz',
    );
  });
});
