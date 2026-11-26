import { createHash } from 'node:crypto';
import {
  BGivenNameAliasSchema,
  BOfficeholderSchema,
  BPersonAliasSchema,
  BPersonSchema,
  personSlug,
} from '@citizenrun/shared';
import type { BPerson } from '@citizenrun/shared';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DataBucket } from '../lib/bucket.ts';
import type { FetchRequest } from '../lib/fetch/types.ts';
import { StageFailedSchema, readStageMeta, readStageRows, runStage } from '../lib/runner.ts';
import type { StageId, StageModule } from '../lib/runner.ts';
import {
  OPENSTATES_PEOPLE_COMMIT_URL,
  OPENSTATES_PEOPLE_TARBALL,
} from '../sources/openstates-executive.ts';
import { getTestBucket, resetStorage, testRunId } from '../testing/setup.ts';
import {
  buildTarGz,
  saved,
  s09Context,
  scriptFetcher,
  zzExecutiveYaml,
  zzStatewideRef,
  zzTemplateOutput,
  zzText,
} from '../__fixtures__/s09/zz-s09.ts';
import type { Answer } from '../__fixtures__/s09/zz-s09.ts';
import { S09_FILES, makeS09People } from './s09-people.ts';
import { OFFICE_REFS_FILE } from './shared/office-ref.ts';
import { PERSON_SOURCES_FILE } from './shared/person-source.ts';

const COMMIT = '6c96e49451833e745fb4f529bb631fa04ae1148a';
const THUMB =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Fixture_Senator_official_portrait.jpg/640px-Fixture_Senator_official_portrait.jpg';
const GOVERNOR_KEY = 'openstates:ocd-person/00000000-0000-4000-8000-000000000001';

function person(
  key: string,
  name: string,
  first: string,
  last: string,
  extra: Partial<BPerson> = {},
): BPerson {
  return BPersonSchema.parse({
    source_key: key,
    slug: personSlug(name, key),
    name,
    first_name: first,
    middle_name: null,
    last_name: last,
    suffix: null,
    party: null,
    photo: null,
    website: null,
    roster_only: false,
    origin: { created_by: 'bundle', key, datasets: ['congress-legislators'] },
    ...extra,
  });
}

/** A stage module that writes the given files for ZZ, to stand in for an earlier stage's output. */
function writer(
  id: StageId,
  files: Record<string, readonly Record<string, unknown>[]>,
): StageModule {
  return {
    id,
    milestone: 2,
    blockingChecks: [],
    states: () => Promise.resolve(['ZZ']),
    async run(_ctx, _state, opts) {
      const written = [];
      for (const [name, rows] of Object.entries(files)) {
        written.push(await opts.out.writeRows(name, rows));
      }
      return { files: written, checks: [], datasets: {} };
    },
  };
}

async function seedInputs(bucket: DataBucket): Promise<void> {
  const ctx = s09Context(
    bucket,
    scriptFetcher(bucket, () => undefined),
    { runId: testRunId() },
  );
  const senator = person('bioguide:Z000001', 'Fixture Q. Senator', 'Fixture', 'Senator');
  const director = person(
    'irs990:990000001:fixture director',
    'Fixture Director',
    'Fixture',
    'Director',
    {
      roster_only: true,
      origin: {
        created_by: 'bundle',
        key: 'irs990:990000001:fixture director',
        datasets: ['irs990'],
      },
    },
  );
  const stages: StageModule[] = [
    writer('s02-known', {
      people: [senator],
      [PERSON_SOURCES_FILE]: [
        {
          person_key: senator.source_key,
          bioguide: 'Z000001',
          wikipedia_urls: ['https://en.wikipedia.org/wiki/Fixture_Senator'],
          wikidata_qid: null,
          nickname_alias: 'Fix Senator',
        },
      ],
    }),
    writer('s02-coops', { people: [director] }),
    writer('s03-templates', { template: [await zzTemplateOutput()] }),
    writer('s04-expand', {
      [OFFICE_REFS_FILE]: [
        zzStatewideRef('governor', 'governor'),
        zzStatewideRef('treasurer', 'state-treasurer'),
      ],
    }),
  ];
  for (const stage of stages) {
    const result = await runStage(stage, ctx, ['ZZ'], { dryRun: false });
    expect(result.exitCode).toBe(0);
  }
}

async function script(): Promise<(req: FetchRequest) => Answer | undefined> {
  const portrait = (await saved('portrait.jpg')).bytes;
  const json = (body: string): Answer => ({ body, contentType: 'application/json' });
  const pageImages = await zzText('zz-wikipedia-pageimages.json');
  const commons = await zzText('zz-commons-senate-portrait.json');
  const holders = await zzText('zz-wikidata-holders.json');
  const tarball = buildTarGz(
    [
      {
        path: `people-${COMMIT}/data/zz/executive/Fixture-Governor-Person.yml`,
        body: zzExecutiveYaml({
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Fixture Governor Person',
          given: 'Fixture',
          family: 'Person',
          role: 'governor',
          start: '2025-01-01',
        }),
      },
    ],
    { comment: COMMIT },
  );
  const excerpt = await saved('names-excerpt.csv');
  return (req) => {
    const host = new URL(req.url).hostname;
    if (req.url === OPENSTATES_PEOPLE_COMMIT_URL) return json(JSON.stringify({ sha: COMMIT }));
    if (req.url === OPENSTATES_PEOPLE_TARBALL)
      return { body: tarball, contentType: 'application/x-gzip' };
    if (host === 'en.wikipedia.org') return json(pageImages);
    if (host === 'commons.wikimedia.org') return json(commons);
    if (host === 'query.wikidata.org')
      return { body: holders, contentType: 'application/sparql-results+json' };
    if (req.url === THUMB) return { body: portrait, contentType: 'image/jpeg' };
    if (req.url === excerpt.meta.url)
      return { body: excerpt.bytes, contentType: 'text/plain; charset=utf-8' };
    return undefined;
  };
}

async function rows<T>(
  bucket: DataBucket,
  state: string,
  name: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const out: T[] = [];
  for await (const row of readStageRows(bucket, 's09-people', state, name, schema)) {
    out.push(row);
  }
  return out;
}

const AssetRowSchema = z.strictObject({
  path: z.string(),
  sha256: z.string(),
  bytes: z.int(),
  width: z.int(),
  height: z.int(),
  content_type: z.literal('image/jpeg'),
});

beforeEach(async () => {
  await resetStorage();
});

describe('stage 9', () => {
  it("run('ZZ') writes the four files, the photo and the checks", async () => {
    const { bucket } = await getTestBucket('data');
    await seedInputs(bucket);
    const fetcher = scriptFetcher(bucket, await script());
    const ctx = s09Context(bucket, fetcher, { runId: testRunId() });
    const module = makeS09People({
      fecApiKey: () => null,
      nicknamesUrl: () => Promise.reject(new Error('not read for a state')),
    });
    const result = await runStage(module, ctx, ['ZZ'], { dryRun: false });
    expect(result.exitCode).toBe(0);

    const meta = await readStageMeta(bucket, 's09-people', 'ZZ');
    expect(meta?.files.map((file) => file.name)).toEqual([
      S09_FILES.people,
      S09_FILES.personAliases,
      S09_FILES.officeholders,
      S09_FILES.assets,
    ]);
    expect(meta?.checks.find((check) => check.name === 'photos')?.detail).toBe(
      'step1=0 step2=0 step3=1 reused=0 none=2 missing=1 no_page_image=2',
    );
    expect(meta?.checks.find((check) => check.name === 'holders')?.detail).toMatch(
      /^statewide=2 wikidata_ambiguous=0 executives=1 /,
    );
    expect(meta?.datasets).toMatchObject({
      'openstates-people': { edition: COMMIT, source_url: OPENSTATES_PEOPLE_TARBALL },
      wikidata: { edition: '2026-11-26', source_url: 'https://query.wikidata.org/' },
    });
    // No Congress.gov request is made without the key.
    expect(fetcher.requests.some((r) => new URL(r.req.url).hostname === 'api.congress.gov')).toBe(
      false,
    );

    const people = await rows(bucket, 'ZZ', S09_FILES.people, BPersonSchema);
    expect(people.map((p) => p.source_key)).toEqual([
      'bioguide:Z000001',
      'irs990:990000001:fixture director',
      GOVERNOR_KEY,
      'wikidata:Q99999002',
    ]);
    const senator = people[0];
    expect(senator?.photo).toMatchObject({ width: 320, height: 391, license: 'LicenseRef-PD' });
    expect(people.slice(1).every((p) => p.photo === null)).toBe(true);

    const assets = await rows(bucket, 'ZZ', S09_FILES.assets, AssetRowSchema);
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset?.path).toBe(`assets/photos/${asset?.sha256 ?? ''}.jpg`);
    expect(senator?.photo?.asset).toBe(`../../${asset?.path ?? ''}`);
    const stored = await bucket.getBytes(asset?.path ?? '');
    expect(stored).not.toBeNull();
    const bytes = stored ?? new Uint8Array();
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset?.sha256);
    expect(asset).toMatchObject({
      bytes: bytes.byteLength,
      width: 320,
      height: 391,
      content_type: 'image/jpeg',
    });
    expect((await sharp(bytes).metadata()).width).toBe(320);

    const holders = await rows(bucket, 'ZZ', S09_FILES.officeholders, BOfficeholderSchema);
    expect(holders.map((row) => row.source_key)).toEqual([
      `zz-governor|${GOVERNOR_KEY}|`,
      'zz-treasurer|wikidata:Q99999002|',
    ]);
    const aliases = await rows(bucket, 'ZZ', S09_FILES.personAliases, BPersonAliasSchema);
    expect(aliases.filter((a) => a.person_key === 'bioguide:Z000001').map((a) => a.alias)).toEqual([
      'Fix Senator',
      'Fixture Q. Senator',
      'Fixture Senator',
    ]);

    // A second run finds the same Commons file and keeps the photo with no image request.
    const again = scriptFetcher(bucket, await script());
    const second = await runStage(
      module,
      s09Context(bucket, again, { runId: testRunId() }),
      ['ZZ'],
      {
        dryRun: false,
      },
    );
    expect(second.exitCode).toBe(0);
    expect(again.requests.some((r) => r.req.url === THUMB)).toBe(false);
    const kept = await rows(bucket, 'ZZ', S09_FILES.people, BPersonSchema);
    expect(kept[0]?.photo).toEqual(senator?.photo);
    expect((await readStageMeta(bucket, 's09-people', 'ZZ'))?.checks[0]?.detail).toBe(
      'step1=0 step2=0 step3=0 reused=1 none=2 missing=1 no_page_image=2',
    );
  });

  it("run('US') writes given_name_aliases from the pinned names.csv", async () => {
    const { bucket } = await getTestBucket('data');
    const excerpt = await saved('names-excerpt.csv');
    const commit = /\/([0-9a-f]{40})\//.exec(excerpt.meta.url)?.[1] ?? '';
    const url = `https://raw.githubusercontent.com/carltonnorthern/nicknames/${commit}/names.csv`;
    expect(url).toBe(excerpt.meta.url);
    const fetcher = scriptFetcher(bucket, await script());
    const module = makeS09People({
      fecApiKey: () => null,
      nicknamesUrl: () => Promise.resolve(url),
    });
    const result = await runStage(
      module,
      s09Context(bucket, fetcher, { runId: testRunId() }),
      ['US'],
      {
        dryRun: false,
      },
    );
    expect(result.exitCode).toBe(0);
    const meta = await readStageMeta(bucket, 's09-people', 'US');
    expect(meta?.files.map((file) => file.name)).toEqual([S09_FILES.givenNameAliases]);
    expect(meta?.datasets.nicknames).toMatchObject({ edition: commit, source_url: url });
    const aliases = await rows(bucket, 'US', S09_FILES.givenNameAliases, BGivenNameAliasSchema);
    expect(aliases.length).toBeGreaterThan(50);
    expect(aliases).toContainEqual({
      source_key: 'aaron|erin',
      canonical: 'aaron',
      alias: 'erin',
      source: 'nicknames',
    });
    // The supplement's pairs are added (data/nicknames-supplement.yaml).
    expect(aliases).toContainEqual({
      source_key: 'jose|pepe',
      canonical: 'jose',
      alias: 'pepe',
      source: 'supplement',
    });
  });

  it('an unpinned nicknames url fails nicknames_unpinned and writes nothing', async () => {
    const { bucket } = await getTestBucket('data');
    const fetcher = scriptFetcher(bucket, () => undefined);
    const ctx = s09Context(bucket, fetcher, { runId: testRunId() });
    const module = makeS09People({
      fecApiKey: () => null,
      nicknamesUrl: () => Promise.resolve('https://github.com/carltonnorthern/nicknames'),
    });
    const result = await runStage(module, ctx, ['US'], { dryRun: false });
    expect(result.exitCode).toBe(1);
    expect(result.summaries[0]?.failedChecks).toEqual(['nicknames_unpinned']);
    expect(fetcher.requests).toHaveLength(0);
    expect(await readStageMeta(bucket, 's09-people', 'US')).toBeNull();
    const failed = await bucket.getJson(
      `stage-out/s09-people/US/_failed-${ctx.runId}.json`,
      StageFailedSchema,
    );
    expect(failed?.checks.map((check) => check.name)).toEqual(['nicknames_unpinned']);
  });

  it('lists the states with a stage 2 output, then US', async () => {
    const { bucket } = await getTestBucket('data');
    await seedInputs(bucket);
    const module = makeS09People({
      fecApiKey: () => null,
      nicknamesUrl: () => Promise.resolve(''),
    });
    const ctx = s09Context(
      bucket,
      scriptFetcher(bucket, () => undefined),
    );
    expect(await module.states(ctx)).toEqual(['ZZ', 'US']);
  });
});
