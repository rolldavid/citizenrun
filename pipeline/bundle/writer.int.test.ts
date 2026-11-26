import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BElectionSchema,
  BFilingTrackSchema,
  BGeometrySchema,
  BGivenNameAliasSchema,
  BJurisdictionSchema,
  BOfficePowerSchema,
  BOfficeSchema,
  BOfficeholderSchema,
  BPersonAliasSchema,
  BPersonSchema,
  BZipCentroidSchema,
  BundleManifestSchema,
  BundlePointerSchema,
} from '@citizenrun/shared';
import type { BundleManifest } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ZZ_RULES_IMPLAUSIBLE } from '../__fixtures__/s05/zz-rules-implausible.ts';
import { bucketKeys } from '../lib/bucket.ts';
import type { DataBucket } from '../lib/bucket.ts';
import { loadSlugRegistry, saveSlugRegistry } from '../lib/slug.ts';
import { OfficeRefRowSchema } from '../stages/shared/office-ref.ts';
import { loadStageRows } from '../stages/shared/stage-io.ts';
import { captureLogger } from '../testing/capture-log.ts';
import { getTestBucket, resetStorage, testRunId } from '../testing/setup.ts';
import { CoverageStatsSchema } from './coverage.ts';
import {
  ZZ_TEMPLATE_FIXTURE,
  rewriteStageOutput,
  writeZzStageOutputs,
  zzBundleDeps,
  zzContext,
  zzTemplatesDir,
} from './testing/zz-outputs.ts';
import { runBundle } from './writer.ts';
import type { BundleDeps } from './writer.ts';

const FILE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  jurisdictions: BJurisdictionSchema,
  districts: BDistrictSchema,
  district_fallbacks: BDistrictFallbackSchema,
  offices: BOfficeSchema,
  office_powers: BOfficePowerSchema,
  elections: BElectionSchema,
  filing_tracks: BFilingTrackSchema,
  people: BPersonSchema,
  person_aliases: BPersonAliasSchema,
  officeholders: BOfficeholderSchema,
  given_name_aliases: BGivenNameAliasSchema,
};
const ELEVEN = Object.keys(FILE_SCHEMAS);
const T1 = '2026-11-26T16:00:00.000Z';
const T2 = '2026-11-26T16:00:01.000Z';
const T3 = '2026-11-26T16:00:02.000Z';

async function writeLoader(bucket: DataBucket, value: Record<string, unknown>): Promise<void> {
  await bucket.putBytes(
    bucketKeys.loaderInfo(),
    Buffer.from(JSON.stringify(value)),
    'application/json',
  );
}

const LOADER = { schema_version: 1, schema_revision: 0, updated_at: '2026-11-26T14:00:00.000Z' };

async function setup(): Promise<{ bucket: DataBucket; deps: BundleDeps }> {
  const { bucket } = await getTestBucket('data');
  await writeZzStageOutputs(bucket);
  await writeLoader(bucket, LOADER);
  return { bucket, deps: zzBundleDeps(await zzTemplatesDir()) };
}

async function context(bucket: DataBucket, at: string) {
  return zzContext(bucket, new Date(at), testRunId());
}

async function keys(bucket: DataBucket, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for await (const info of bucket.list(prefix)) out.push(info.key);
  return out.sort();
}

async function json(bucket: DataBucket, key: string): Promise<unknown> {
  const bytes = await bucket.getBytes(key);
  expect(bytes).not.toBeNull();
  return JSON.parse(Buffer.from(bytes ?? new Uint8Array()).toString('utf8'));
}

async function manifestOf(bucket: DataBucket, version: string): Promise<BundleManifest> {
  return BundleManifestSchema.parse(await json(bucket, `bundles/${version}/manifest.json`));
}

async function expectNothingPublished(bucket: DataBucket): Promise<void> {
  expect(await keys(bucket, 'bundles/')).toEqual([bucketKeys.loaderInfo()]);
  expect(await keys(bucket, 'reports/')).toEqual([]);
}

const FULL = { kind: 'full', dryRun: false, states: 'all' } as const;
const NO_RERUN = { kind: 'full', dryRun: false, states: [] } as const;

beforeEach(async () => {
  await resetStorage();
});

describe('the bundle writer', () => {
  it('writes every file, the manifest and the pointers', async () => {
    const { bucket, deps } = await setup();
    const result = await runBundle(await context(bucket, T1), FULL, deps);
    expect(result).toEqual({
      status: 'published',
      fullVersion: '20261126T160000Z-full',
      geometryVersion: '20261126T160000Z-geometry',
    });
    const version = '20261126T160000Z-full';
    const files = await keys(bucket, `bundles/${version}/`);
    expect(files).toEqual(
      [
        ...ELEVEN.map((name) => `bundles/${version}/${name}.ndjson.gz`),
        `bundles/${version}/ATTRIBUTION.md`,
        `bundles/${version}/manifest.json`,
      ].sort(),
    );
    const manifest = await manifestOf(bucket, version);
    expect(manifest.kind).toBe('full');
    expect(manifest.states).toEqual(['ZZ']);
    expect(manifest.geometry_version).toBe('20261126T160000Z-geometry');
    expect(manifest.checks.every((check) => check.passed)).toBe(true);
    expect(manifest.checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'rules_fixtures',
        'template_valid:ZZ',
        'rules_plausible:ZZ',
        'personal_data',
        'referential_integrity',
        'listing_header',
        'unit_counts',
        'join_rate',
        'geometry_valid:ZZ',
        'slug_unique',
      ]),
    );
    expect(manifest.coverage_path).toBe(`../../reports/coverage/${version}.json`);
    expect(Object.keys(manifest.datasets)).toEqual(
      expect.arrayContaining(['census-gus', 'tiger', 'eia861', 'irs990', 'openstates']),
    );
    expect(manifest.assets.length).toBeGreaterThan(0);
    for (const asset of manifest.assets) {
      expect(asset.path).toMatch(/^\.\.\/\.\.\/assets\/photos\/[0-9a-f]{64}\.jpg$/);
      expect(await bucket.head(asset.path.slice('../../'.length))).not.toBeNull();
    }
    let offices = 0;
    for (const file of manifest.files) {
      const bytes = await bucket.getBytes(`bundles/${version}/${file.path}`);
      const schema = FILE_SCHEMAS[file.name];
      expect(schema).toBeDefined();
      const lines = gunzipSync(bytes ?? new Uint8Array())
        .toString('utf8')
        .split('\n')
        .filter((l) => l !== '');
      expect(lines).toHaveLength(file.rows);
      for (const line of lines) schema?.parse(JSON.parse(line));
      if (file.name === 'offices') offices = lines.length;
    }
    expect(offices).toBeGreaterThan(0);
    const geometry = await manifestOf(bucket, '20261126T160000Z-geometry');
    expect(geometry.files.map((f) => f.path)).toEqual([
      'geometry/ZZ.ndjson.gz',
      'zip_centroids.ndjson.gz',
    ]);
    const zip = await bucket.getBytes('bundles/20261126T160000Z-geometry/zip_centroids.ndjson.gz');
    BZipCentroidSchema.parse(
      JSON.parse(
        gunzipSync(zip ?? new Uint8Array())
          .toString('utf8')
          .split('\n')[0] ?? '',
      ),
    );
    const geoLines = gunzipSync(
      (await bucket.getBytes('bundles/20261126T160000Z-geometry/geometry/ZZ.ndjson.gz')) ??
        new Uint8Array(),
    )
      .toString('utf8')
      .split('\n')
      .filter((l) => l !== '');
    for (const line of geoLines) BGeometrySchema.parse(JSON.parse(line));
    expect(BundlePointerSchema.parse(await json(bucket, 'bundles/index/full.json'))).toMatchObject({
      kind: 'full',
      version,
    });
    expect(
      BundlePointerSchema.parse(await json(bucket, 'bundles/index/geometry.json')),
    ).toMatchObject({ kind: 'geometry', version: '20261126T160000Z-geometry' });
    const coverage = CoverageStatsSchema.parse(
      await json(bucket, `reports/coverage/${version}.json`),
    );
    expect(coverage.states['ZZ']?.template).toBe('valid');
    // The registries hold every office ref and person of the bundle.
    const refs =
      (await loadStageRows(
        await context(bucket, T1),
        's02-known',
        'ZZ',
        'office_refs',
        OfficeRefRowSchema,
      )) ?? [];
    const registry = await loadSlugRegistry(bucket, 'offices');
    for (const ref of refs) expect(registry.get(ref.identity)).toBe(ref.slug);
  });

  it('the same stage outputs give byte-identical files', async () => {
    const { bucket, deps } = await setup();
    const first = await runBundle(await context(bucket, T1), NO_RERUN, deps);
    const second = await runBundle(await context(bucket, T2), NO_RERUN, deps);
    expect(first.status).toBe('published');
    expect(second).toEqual({
      status: 'published',
      fullVersion: '20261126T160001Z-full',
      geometryVersion: null,
    });
    for (const name of [...ELEVEN.map((n) => `${n}.ndjson.gz`), 'ATTRIBUTION.md']) {
      const a = await bucket.getBytes(`bundles/20261126T160000Z-full/${name}`);
      const b = await bucket.getBytes(`bundles/20261126T160001Z-full/${name}`);
      if (name === 'ATTRIBUTION.md') {
        // The attribution names the version; everything else is the same.
        expect(
          Buffer.from(b ?? [])
            .toString()
            .replace('20261126T160001Z', '20261126T160000Z'),
        ).toBe(Buffer.from(a ?? []).toString());
      } else {
        expect(Buffer.from(a ?? []).equals(Buffer.from(b ?? []))).toBe(true);
      }
    }
    const strip = (m: BundleManifest) => {
      const rest: Record<string, unknown> = { ...m };
      for (const key of ['version', 'created_at', 'geometry_version', 'coverage_path']) {
        Reflect.deleteProperty(rest, key);
      }
      return rest;
    };
    expect(strip(await manifestOf(bucket, '20261126T160001Z-full'))).toEqual(
      strip(await manifestOf(bucket, '20261126T160000Z-full')),
    );
  });

  it('a person row containing 123 Main Street fails the scan', async () => {
    const { bucket, deps } = await setup();
    const ctx = await context(bucket, T1);
    // Stage 9 re-emits the stage 2 people with their photos, so the name changes in both.
    const rename = (rows: Record<string, unknown>[]) =>
      rows.map((row) =>
        row['source_key'] === 'bioguide:Z000001'
          ? { ...row, name: 'Fixture 123 Main Street' }
          : row,
      );
    await rewriteStageOutput(ctx, 's02-known', 'ZZ', { people: rename });
    await rewriteStageOutput(ctx, 's09-people', 'ZZ', { people: rename });
    const result = await runBundle(ctx, FULL, deps);
    expect(result).toMatchObject({ status: 'stopped', reason: 'checks_failed' });
    expect(result.status === 'stopped' ? result.failed : []).toContain('personal_data');
    await expectNothingPublished(bucket);
  });

  it('a dangling district_key fails integrity', async () => {
    const { bucket, deps } = await setup();
    const ctx = await context(bucket, T1);
    await rewriteStageOutput(ctx, 's02-known', 'ZZ', {
      offices: (rows) =>
        rows.map((row, i) => (i === 0 ? { ...row, district_key: 'tiger:county:99999' } : row)),
    });
    const { lines, log } = captureLogger();
    const result = await runBundle({ ...ctx, log }, FULL, deps);
    expect(result).toMatchObject({
      status: 'stopped',
      reason: 'checks_failed',
      failed: ['referential_integrity'],
    });
    await expectNothingPublished(bucket);
    const stopped = lines.find((line) => line.parsed['event'] === 'bundle.stopped');
    expect(stopped?.parsed).toMatchObject({
      reason: 'checks_failed',
      failed: ['referential_integrity'],
    });
    expect(stopped?.raw).not.toContain('tiger:county:99999');
  });

  it('the manifest is written after every file and the pointer after the manifest', async () => {
    const { bucket, deps } = await setup();
    const puts: string[] = [];
    const recording: DataBucket = {
      ...bucket,
      putBytes: (key, body, type) => {
        puts.push(key);
        return bucket.putBytes(key, body, type);
      },
      putJson: (key, value, schema) => {
        puts.push(key);
        return bucket.putJson(key, value, schema);
      },
      putStream: (key, body, type) => {
        puts.push(key);
        return bucket.putStream(key, body, type);
      },
    };
    const ctx = { ...(await context(bucket, T1)), bucket: recording };
    expect((await runBundle(ctx, NO_RERUN, deps)).status).toBe('published');
    const bundlePuts = puts.filter(
      (key) => key.startsWith('bundles/') || key.startsWith('reports/'),
    );
    const g = 'bundles/20261126T160000Z-geometry/';
    const f = 'bundles/20261126T160000Z-full/';
    expect(bundlePuts).toEqual([
      `${g}geometry/ZZ.ndjson.gz`,
      `${g}zip_centroids.ndjson.gz`,
      `${g}ATTRIBUTION.md`,
      `${g}manifest.json`,
      ...ELEVEN.map((name) => `${f}${name}.ndjson.gz`),
      `${f}ATTRIBUTION.md`,
      'reports/coverage/20261126T160000Z-full.json',
      `${f}manifest.json`,
      'bundles/index/geometry.json',
      'bundles/index/full.json',
    ]);
  });

  it('no loader.json stops with loader_missing and writes nothing under bundles/', async () => {
    const { bucket, deps } = await setup();
    await bucket.delete([bucketKeys.loaderInfo()]);
    expect(await runBundle(await context(bucket, T1), FULL, deps)).toEqual({
      status: 'stopped',
      reason: 'loader_missing',
      failed: [],
    });
    expect(await keys(bucket, 'bundles/')).toEqual([]);
  });

  it('an invalid loader.json reads as absent', async () => {
    const { bucket, deps } = await setup();
    await writeLoader(bucket, { schema_version: 1, schema_revision: 'zero' });
    const { lines, log } = captureLogger();
    const ctx = { ...(await context(bucket, T1)), log };
    expect(await runBundle(ctx, FULL, deps)).toMatchObject({
      status: 'stopped',
      reason: 'loader_missing',
    });
    await expectNothingPublished(bucket);
    expect(lines.some((line) => line.parsed['event'] === 'index_file.invalid')).toBe(true);
  });

  it('an older loader stops with loader_too_old', async () => {
    const { bucket, deps } = await setup();
    const ctx = await context(bucket, T1);
    expect(await runBundle(ctx, FULL, { ...deps, writerRevision: 1 })).toMatchObject({
      status: 'stopped',
      reason: 'loader_too_old',
    });
    await writeLoader(bucket, { ...LOADER, schema_version: 2 });
    expect(await runBundle(ctx, FULL, deps)).toMatchObject({
      status: 'stopped',
      reason: 'loader_too_old',
    });
    await expectNothingPublished(bucket);
  });

  it('a failing rules fixture blocks the bundle', async () => {
    const { bucket, deps } = await setup();
    const failing = {
      ...deps,
      runRulesFixtures: () => Promise.resolve({ passed: false, detail: 'exit=1' }),
    };
    expect(await runBundle(await context(bucket, T1), FULL, failing)).toEqual({
      status: 'stopped',
      reason: 'rules_fixtures',
      failed: ['rules_fixtures'],
    });
    await expectNothingPublished(bucket);
  });

  it('a failing template blocks the bundle', async () => {
    const { bucket } = await setup();
    const text = (await readFile(ZZ_TEMPLATE_FIXTURE, 'utf8')).replace(
      'power: zoning-land-use',
      'power: zz-not-a-power',
    );
    const deps = zzBundleDeps(await zzTemplatesDir(text));
    const result = await runBundle(await context(bucket, T1), FULL, deps);
    expect(result).toMatchObject({ status: 'stopped', reason: 'checks_failed' });
    expect(result.status === 'stopped' ? result.failed : []).toContain('template_valid:ZZ');
    await expectNothingPublished(bucket);
  });

  it('an implausible rule blocks the bundle', async () => {
    const { bucket } = await setup();
    const deps = zzBundleDeps(await zzTemplatesDir(), { rules: ZZ_RULES_IMPLAUSIBLE });
    const result = await runBundle(await context(bucket, T1), FULL, deps);
    expect(result).toMatchObject({ status: 'stopped', reason: 'checks_failed' });
    expect(result.status === 'stopped' ? result.failed : []).toContain('rules_plausible:ZZ');
    await expectNothingPublished(bucket);
  });

  it('a slug collision fails slug_unique', async () => {
    const { bucket, deps } = await setup();
    const ctx = await context(bucket, T1);
    const refs =
      (await loadStageRows(ctx, 's02-known', 'ZZ', 'office_refs', OfficeRefRowSchema)) ?? [];
    const taken = refs[0]?.slug ?? '';
    expect(taken).not.toBe('');
    await saveSlugRegistry(
      bucket,
      'offices',
      new Map([['state:ZZ|another-office|state:ZZ', taken]]),
    );
    const result = await runBundle(ctx, NO_RERUN, deps);
    expect(result).toEqual({ status: 'stopped', reason: 'checks_failed', failed: ['slug_unique'] });
    await expectNothingPublished(bucket);
    expect([...(await loadSlugRegistry(bucket, 'offices')).keys()]).toEqual([
      'state:ZZ|another-office|state:ZZ',
    ]);
  });

  it('a geometry bundle is written only on change', async () => {
    const { bucket, deps } = await setup();
    const v1 = await runBundle(await context(bucket, T1), NO_RERUN, deps);
    expect(v1).toMatchObject({ geometryVersion: '20261126T160000Z-geometry' });
    const v2 = await runBundle(await context(bucket, T2), NO_RERUN, deps);
    expect(v2).toMatchObject({ geometryVersion: null });
    expect((await manifestOf(bucket, '20261126T160001Z-full')).geometry_version).toBe(
      '20261126T160000Z-geometry',
    );
    expect(await keys(bucket, 'bundles/20261126T160001Z-geometry/')).toEqual([]);

    const ctx = await context(bucket, T3);
    await rewriteStageOutput(ctx, 's01-base', 'ZZ', {
      geometry: (rows) =>
        rows.map((row, i) => (i === 0 ? { ...row, label_point: [-79.25, 35.25] } : row)),
    });
    const v3 = await runBundle(ctx, NO_RERUN, deps);
    expect(v3).toMatchObject({ geometryVersion: '20261126T160002Z-geometry' });
    const third = await manifestOf(bucket, '20261126T160002Z-geometry');
    const first = await manifestOf(bucket, '20261126T160000Z-geometry');
    const zipBefore = first.files.find((f) => f.name === 'zip_centroids');
    expect(third.files.find((f) => f.name === 'zip_centroids')).toEqual({
      ...zipBefore,
      path: '../20261126T160000Z-geometry/zip_centroids.ndjson.gz',
    });
    expect(third.files.find((f) => f.name === 'geometry')?.path).toBe('geometry/ZZ.ndjson.gz');
    expect(await keys(bucket, 'bundles/20261126T160002Z-geometry/')).toEqual([
      'bundles/20261126T160002Z-geometry/ATTRIBUTION.md',
      'bundles/20261126T160002Z-geometry/geometry/ZZ.ndjson.gz',
      'bundles/20261126T160002Z-geometry/manifest.json',
    ]);
    expect((await manifestOf(bucket, '20261126T160002Z-full')).geometry_version).toBe(
      '20261126T160002Z-geometry',
    );
  });

  it('--kind geometry with no change is unchanged', async () => {
    const { bucket, deps } = await setup();
    const geometry = { kind: 'geometry', dryRun: false, states: 'all' } as const;
    expect(await runBundle(await context(bucket, T1), geometry, deps)).toEqual({
      status: 'published',
      fullVersion: null,
      geometryVersion: '20261126T160000Z-geometry',
    });
    expect(await runBundle(await context(bucket, T2), geometry, deps)).toEqual({
      status: 'unchanged',
    });
    expect(await keys(bucket, 'bundles/20261126T160000Z-full/')).toEqual([]);
    expect(await keys(bucket, 'pipeline-state/slugs/')).toEqual([]);
  });

  it('every bundle contains ATTRIBUTION.md', async () => {
    const { bucket, deps } = await setup();
    await runBundle(await context(bucket, T1), NO_RERUN, deps);
    for (const folder of ['20261126T160000Z-full', '20261126T160000Z-geometry']) {
      const text = Buffer.from(
        (await bucket.getBytes(`bundles/${folder}/ATTRIBUTION.md`)) ?? [],
      ).toString('utf8');
      expect(text).toContain('# Data attribution');
      expect(text).toContain('Creative Commons Attribution 4.0 International licence (CC BY 4.0)');
      expect(text).toContain('Photos and other third-party media are outside the data licence');
      expect(text).toContain(folder);
    }
  });

  it('a dry run writes nothing', async () => {
    const { bucket, deps } = await setup();
    const before = await keys(bucket, '');
    const result = await runBundle(
      await context(bucket, T1),
      { kind: 'full', dryRun: true, states: 'all' },
      deps,
    );
    expect(result).toMatchObject({ status: 'published', fullVersion: '20261126T160000Z-full' });
    expect(await keys(bucket, 'bundles/')).toEqual([bucketKeys.loaderInfo()]);
    expect(await keys(bucket, 'pipeline-state/slugs/')).toEqual(
      before.filter((k) => k.startsWith('pipeline-state/slugs/')),
    );
  });
});
