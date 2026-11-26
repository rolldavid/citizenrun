import { gzipSync } from 'node:zlib';
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BElectionSchema,
  BGeometrySchema,
  BJurisdictionSchema,
  BOfficePowerSchema,
  BOfficeSchema,
} from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ZZ_BLOCKS } from '../__fixtures__/s04/zz-blocks.ts';
import { ZZ_KNOWN_REFS } from '../__fixtures__/s04/zz-known-refs.ts';
import { zzTemplateOutput } from '../__fixtures__/s04/zz-template-output.ts';
import { ZZ_PL_URL, zzStage1 } from '../__fixtures__/s04/zz-units.ts';
import { bucketKeys } from '../lib/bucket.ts';
import type { DataBucket } from '../lib/bucket.ts';
import { NO_FETCHER, readStageMeta, runStage } from '../lib/runner.ts';
import type { StageId, StageModule, StageResult } from '../lib/runner.ts';
import { writeDatasetRows } from '../sources/dataset.ts';
import { fixtureContext } from '../templates/__fixtures__/zz-fake-fetcher.ts';
import { ZZ_RULES } from '../templates/__fixtures__/zz-rules.ts';
import { getTestBucket, resetStorage, testRunId } from '../testing/setup.ts';
import { S04_FILES, makeS04Expand } from './s04-expand.ts';
import { OfficeRefRowSchema } from './shared/office-ref.ts';
import { loadStageRows } from './shared/stage-io.ts';

const NOW = new Date('2026-11-16T12:00:00.000Z');
const DATASET_ENTRY = { downloaded_on: '2026-11-01', source_url: ZZ_PL_URL };

function context(bucket: DataBucket) {
  return fixtureContext({ bucket, fetcher: NO_FETCHER, now: NOW, runId: testRunId() });
}

/** A stage module that writes the given rows as its output for ZZ. */
function writer(
  id: StageId,
  files: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>,
  datasets: StageResult['datasets'] = {},
): StageModule {
  return {
    id,
    milestone: 2,
    blockingChecks: [],
    states: () => Promise.resolve(['ZZ']),
    async run(_ctx, _state, opts) {
      const written: StageResult['files'][number][] = [];
      for (const [name, rows] of Object.entries(files)) {
        written.push(await opts.out.writeRows(name, rows));
      }
      return { files: written, checks: [], datasets };
    },
  };
}

async function seed(bucket: DataBucket): Promise<void> {
  const ctx = context(bucket);
  const stage1 = zzStage1();
  const datasets = {
    'census-gus': { edition: '2026', ...DATASET_ENTRY },
    pl94171: { edition: '2020', ...DATASET_ENTRY },
  };
  for (const module of [
    writer(
      's01-base',
      {
        jurisdictions: stage1.jurisdictions,
        districts: stage1.districts,
        district_fallbacks: stage1.fallbacks,
        geometry: stage1.geometry,
      },
      datasets,
    ),
    writer('s02-known', { office_refs: ZZ_KNOWN_REFS }),
    writer('s03-templates', { template: [await zzTemplateOutput()] }),
  ]) {
    expect((await runStage(module, ctx, ['ZZ'], { dryRun: false })).exitCode).toBe(0);
  }
  await writeDatasetRows(
    ctx,
    { dataset: 'census-gus', edition: '2026', file: 'parsed.ndjson.gz' },
    stage1.listing,
  );
  await writeDatasetRows(
    ctx,
    { dataset: 'pl94171', edition: '2020', file: 'blocks-ZZ.ndjson.gz' },
    ZZ_BLOCKS,
  );
}

const expand = makeS04Expand({ rulesFor: (state) => (state === 'ZZ' ? ZZ_RULES : null) });

async function rows<T>(
  bucket: DataBucket,
  name: string,
  schema: z.ZodType<T>,
): Promise<readonly T[]> {
  return (await loadStageRows(context(bucket), 's04-expand', 'ZZ', name, schema)) ?? [];
}

beforeEach(async () => {
  await resetStorage();
});

describe('stage 4', () => {
  it('writes its eight files from the stage outputs in the bucket', async () => {
    const { bucket } = await getTestBucket('data');
    await seed(bucket);
    expect(await expand.states(context(bucket))).toEqual(['ZZ']);
    const result = await runStage(expand, context(bucket), ['ZZ'], { dryRun: false });
    expect(result.exitCode).toBe(0);

    const meta = await readStageMeta(bucket, 's04-expand', 'ZZ');
    expect(meta?.files.map((f) => f.name).sort()).toEqual(Object.values(S04_FILES).sort());
    expect(meta?.datasets).toEqual({ pl94171: { edition: '2020', ...DATASET_ENTRY } });

    const offices = await rows(bucket, S04_FILES.offices, BOfficeSchema);
    const districts = await rows(bucket, S04_FILES.districts, BDistrictSchema);
    const fallbacks = await rows(bucket, S04_FILES.districtFallbacks, BDistrictFallbackSchema);
    const geometry = await rows(bucket, S04_FILES.geometry, BGeometrySchema);
    const refs = await rows(bucket, S04_FILES.officeRefs, OfficeRefRowSchema);
    expect(offices).toHaveLength(18);
    expect(refs.map((r) => r.slug)).toEqual(offices.map((o) => o.slug));
    expect(await rows(bucket, S04_FILES.jurisdictions, BJurisdictionSchema)).toHaveLength(6);
    expect((await rows(bucket, S04_FILES.elections, BElectionSchema)).length).toBe(68);
    expect((await rows(bucket, S04_FILES.officePowers, BOfficePowerSchema)).length).toBeGreaterThan(
      0,
    );

    const known = new Set([...zzStage1().districts, ...districts].map((d) => d.source_key));
    for (const key of [
      ...offices.map((o) => o.district_key),
      ...fallbacks.flatMap((f) => [f.district_key, f.via_district_key]),
    ]) {
      expect(known.has(key)).toBe(true);
    }
    for (const d of districts) {
      expect(geometry.find((g) => g.source_key === d.source_key)?.geom_hash).toBe(d.geom_hash);
    }
    const union = districts.find((d) => d.source_key === 'county_union:ZZ:east');
    expect([union?.population, union?.population_18]).toEqual([350, 265]);
    const check = meta?.checks.find((c) => c.name === 'expand');
    expect(check?.detail).toContain('union_population_unknown=0');
    expect(check?.detail).toContain('unit_without_district=0');
    expect(meta?.checks.filter((c) => !c.passed)).toEqual([]);

    // Without the block table the union's population is not known yet.
    await bucket.delete([bucketKeys.dataset('pl94171', '2020', 'blocks-ZZ.ndjson.gz')]);
    expect((await runStage(expand, context(bucket), ['ZZ'], { dryRun: false })).exitCode).toBe(0);
    const again = (await rows(bucket, S04_FILES.districts, BDistrictSchema)).find(
      (d) => d.source_key === 'county_union:ZZ:east',
    );
    expect([again?.population, again?.population_18]).toEqual([null, null]);
    const second = await readStageMeta(bucket, 's04-expand', 'ZZ');
    expect(second?.checks.find((c) => c.name === 'expand')?.detail).toContain(
      'union_population_unknown=1',
    );
    expect(second?.datasets).toEqual({});
  });

  it('a slug the registry holds for another identity fails the state and keeps its last output', async () => {
    const { bucket } = await getTestBucket('data');
    await seed(bucket);
    expect((await runStage(expand, context(bucket), ['ZZ'], { dryRun: false })).exitCode).toBe(0);
    const before = await readStageMeta(bucket, 's04-expand', 'ZZ');
    const registry = {
      'census:990001|sheriff|tiger:county:99001': 'zz-fixture-county-sheriff',
      'census:990099|sheriff|tiger:county:99099': 'zz-fixture-county-sheriff',
    };
    await bucket.putBytes(
      bucketKeys.slugs('offices'),
      new Uint8Array(gzipSync(JSON.stringify(registry))),
      'application/gzip',
    );
    const failed = await runStage(expand, context(bucket), ['ZZ'], { dryRun: false });
    expect(failed.exitCode).toBe(1);
    expect(failed.summaries[0]?.failedChecks).toEqual(['slug_unique']);
    expect((await readStageMeta(bucket, 's04-expand', 'ZZ'))?.run_id).toBe(before?.run_id);
  });

  it('a state with no stage 1 output fails', async () => {
    const { bucket } = await getTestBucket('data');
    const ctx = context(bucket);
    await runStage(writer('s03-templates', { template: [await zzTemplateOutput()] }), ctx, ['ZZ'], {
      dryRun: false,
    });
    const result = await runStage(expand, context(bucket), ['ZZ'], { dryRun: false });
    expect(result.exitCode).toBe(1);
    expect(result.summaries[0]?.errorClass).toBe('ExpandInputMissing');
  });
});
