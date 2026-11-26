import { describe, expect, it } from 'vitest';
import { BundleFileNameSchema, BundleManifestSchema } from './manifest.ts';
import { MANIFEST_FIXTURES } from './rows.fixtures.ts';

const { full } = MANIFEST_FIXTURES;

function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
}

function passes(manifest: unknown): boolean {
  return BundleManifestSchema.safeParse(manifest).success;
}

describe('BundleManifestSchema', () => {
  it('the fixture manifests pass', () => {
    for (const [kind, manifest] of Object.entries(MANIFEST_FIXTURES)) {
      expect(passes(manifest), kind).toBe(true);
    }
  });

  it('the manifest is complete', () => {
    expect(passes(without(full, 'version'))).toBe(false);
    expect(passes(without(full, 'schema_version'))).toBe(false);
    const file = full.files[0];
    const dataset = full.datasets['census-gus'];
    if (file === undefined || dataset === undefined) {
      throw new Error('the full fixture has a file and a dataset');
    }
    expect(passes({ ...full, files: [without(file, 'sha256')] })).toBe(false);
    expect(passes({ ...full, files: [without(file, 'rows')] })).toBe(false);
    expect(passes({ ...full, datasets: { 'census-gus': without(dataset, 'edition') } })).toBe(
      false,
    );
    expect(passes({ ...full, datasets: { 'census-gus': without(dataset, 'downloaded_on') } })).toBe(
      false,
    );
    expect(passes({ ...full, schema_version: 2 })).toBe(false);
    expect(passes({ ...full, unknown_key: 'x' })).toBe(false);
  });

  it('sample and real versions never mix', () => {
    expect(passes({ ...full, geometry_version: 'sample-20261116T000000Z-geometry' })).toBe(false);
    expect(passes({ ...full, version: 'sample-20261116T000000Z-full' })).toBe(false);
    expect(
      passes({
        ...full,
        version: 'sample-20261116T000000Z-full',
        geometry_version: 'sample-20261116T000000Z-geometry',
      }),
    ).toBe(true);
  });

  it('a failed check still parses', () => {
    expect(
      passes({
        ...full,
        checks: [{ name: 'personal_data', passed: false, detail: 'Fixture failure.' }],
      }),
    ).toBe(true);
  });

  it('names the nineteen bundle files', () => {
    expect(BundleFileNameSchema.options).toEqual([
      'jurisdictions',
      'districts',
      'district_fallbacks',
      'offices',
      'office_powers',
      'elections',
      'filing_tracks',
      'results',
      'people',
      'person_aliases',
      'officeholders',
      'given_name_aliases',
      'power_phrases',
      'search_synonyms',
      'forms',
      'filings',
      'field_report_resolutions',
      'zip_centroids',
      'geometry',
    ]);
  });
});
