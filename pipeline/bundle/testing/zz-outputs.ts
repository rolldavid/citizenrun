// The stage outputs of the fixture state ZZ, written into a test bucket by the real stage modules
// (known bodies, co-ops, templates, expansion, deadlines, people) on made-up inputs; stage 1's
// rows are fixtures written through the runner. Every name in them starts with "Fixture".
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BDistrictSchema, BZipCentroidSchema } from '@citizenrun/shared';
import type { StateRules } from '@citizenrun/rules';
import { z } from 'zod';
import { ZZ_BLOCKS } from '../../__fixtures__/s04/zz-blocks.ts';
import {
  ZZ_FIPS,
  ZZ_PL_URL,
  box,
  exactGeometry,
  zzStage1,
} from '../../__fixtures__/s04/zz-units.ts';
import { buildTarGz, saved, zzExecutiveYaml, zzText } from '../../__fixtures__/s09/zz-s09.ts';
import type { DataBucket } from '../../lib/bucket.ts';
import { storeRawBody } from '../../lib/fetch/cache.ts';
import type { FetchRequest, FetchResult, Fetcher } from '../../lib/fetch/types.ts';
import { writeXlsx } from '../../lib/xlsx.ts';
import { storedZip } from '../../lib/zip.fixtures.ts';
import { readStageMeta, readStageRows, runStage } from '../../lib/runner.ts';
import type { RunContext, StageId, StageModule, StageResult } from '../../lib/runner.ts';
import { CONGRESS_REQUIRED, LEGISLATORS_URL } from '../../sources/congress.ts';
import { writeDatasetRows } from '../../sources/dataset.ts';
import { EIA_URL } from '../../sources/eia861.ts';
import { coopsSample } from '../../sources/eia861.fixtures.ts';
import { eoBmfUrl } from '../../sources/irs-eobmf.ts';
import { batchUrl, indexUrl } from '../../sources/irs990.ts';
import { OPENSTATES_HEADER } from '../../sources/openstates.ts';
import {
  OPENSTATES_PEOPLE_COMMIT_URL,
  OPENSTATES_PEOPLE_TARBALL,
} from '../../sources/openstates-executive.ts';
import { HOUSE_TERM, SENATE_TERM } from '../../stages/federal.ts';
import { makeS02Coops } from '../../stages/s02-coops.ts';
import { makeS02Known } from '../../stages/s02-known.ts';
import { makeS03Templates } from '../../stages/s03-templates.ts';
import { makeS04Expand } from '../../stages/s04-expand.ts';
import { makeS05Deadlines } from '../../stages/s05-deadlines.ts';
import { makeS09People } from '../../stages/s09-people.ts';
import { repoRoot } from '../../stages/shared/repo.ts';
import { loadReferenceIds } from '../../stages/shared/reference.ts';
import { fixtureContext } from '../../templates/__fixtures__/zz-fake-fetcher.ts';
import { ZZ_RULES } from '../../templates/__fixtures__/zz-rules.ts';
import type { BundleDeps } from '../writer.ts';
import { runStageForBundle } from '../writer.ts';

export const ZZ_NOW = new Date('2026-11-26T15:00:00.000Z');
export const ZZ_TEMPLATE_FIXTURE = join(
  repoRoot(),
  'pipeline',
  'templates',
  '__fixtures__',
  'zz-template.yaml',
);
const STATUTE_URL = 'https://example.test/zz/code';
const OPENSTATES_URL = 'https://data.openstates.org/people/current/zz.csv';
const DATASET_ENTRY = { downloaded_on: '2026-11-01', source_url: ZZ_PL_URL };
const PEOPLE_COMMIT = '6c96e49451833e745fb4f529bb631fa04ae1148a';
const THUMB =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Fixture_Senator_official_portrait.jpg/640px-Fixture_Senator_official_portrait.jpg';
const SAVED_RETURN = '202640159349301609_public.xml';
const RETURN_BATCH = '2026_TEOS_XML_01A';

type Answer = { readonly body: Uint8Array | string; readonly contentType: string };

/** A fetcher that answers every ZZ request from fixtures; any other URL is a 404. */
export function zzFetcher(
  bucket: DataBucket,
  lookup: (url: string) => Answer | undefined,
): Fetcher {
  const answer = async (req: FetchRequest, key: string | null): Promise<FetchResult> => {
    const found = lookup(req.url);
    if (found === undefined) return { kind: 'error', status: 404, reason: 'http_status' };
    const bytes =
      typeof found.body === 'string' ? new TextEncoder().encode(found.body) : found.body;
    let target: string;
    let sha256: string;
    if (key === null) {
      const stored = await storeRawBody(bucket, bytes, found.contentType);
      target = stored.key;
      sha256 = stored.sha256;
    } else {
      target = key;
      sha256 = (await bucket.putBytes(key, bytes, found.contentType)).sha256;
    }
    return {
      kind: 'ok',
      finalUrl: req.url,
      status: 200,
      contentType: found.contentType,
      etag: null,
      lastModified: null,
      sha256,
      bytes: bytes.byteLength,
      cacheKey: target,
    };
  };
  return { fetch: (req) => answer(req, null), download: (req, key) => answer(req, key) };
}

function openStatesCsv(): string {
  const blank = ','.repeat(OPENSTATES_HEADER.length - 7);
  return [
    OPENSTATES_HEADER.join(','),
    `ocd-person/zz-1,Fixture Senator One,Democratic,1,upper,Fixture,Senator One${blank}`,
    `ocd-person/zz-2,Fixture Senator Two,Republican,2,upper,Fixture,Senator Two${blank}`,
    `ocd-person/zz-3,Fixture Representative Three,Independent,1,lower,Fixture,Representative Three${blank}`,
    '',
  ].join('\n');
}

const LEGISLATORS_CSV = [
  [...CONGRESS_REQUIRED, 'nickname', 'wikipedia_id'].join(','),
  'Z000001,rep,ZZ,1,,Democrat,Fixture,,Member One,,Fixture Member One,,',
  'Z000002,sen,ZZ,,1,Republican,Fixture,Q.,Senator,,Fixture Q. Senator,Fix,Fixture Senator',
  '',
].join('\n');

const COUNTIES = [
  { geoid: '99001', statefp: ZZ_FIPS, name: 'Fixture County' },
  { geoid: '99003', statefp: ZZ_FIPS, name: 'Fixture Second County' },
];

async function coopAnswers(): Promise<[string, Answer][]> {
  const xlsx = (rows: (string | number | null)[][]) => writeXlsx([{ name: 'States', rows }]);
  const eia = storedZip([
    {
      name: 'Utility_Data_2025.xlsx',
      data: await xlsx([
        ['Utility Characteristics', null, null, null, null, null],
        ['Data Year', 'Utility Number', 'Utility Name', 'State', 'Ownership Type', 'City'],
        [2025, 99999, 'Fixture Electric Cooperative', 'ZZ', 'Cooperative', 'Fixture City'],
      ]),
    },
    {
      name: 'Service_Territory_2025.xlsx',
      data: await xlsx([
        ['Data Year', 'Utility Number', 'Utility Name', 'Short Form', 'State', 'County'],
        [2025, 99999, 'Fixture Electric Cooperative', null, 'ZZ', 'Fixture County'],
        [2025, 99999, 'Fixture Electric Cooperative', null, 'ZZ', 'Fixture Second County'],
      ]),
    },
    {
      name: 'Sales_Ult_Cust_2025.xlsx',
      data: await xlsx([
        ['Utility Characteristics', null, null, null, 'TOTAL', null, null],
        [null, null, null, null, 'Revenues', 'Sales', 'Customers'],
        [
          'Data Year',
          'Utility Number',
          'Utility Name',
          'State',
          'Thousand Dollars',
          'Megawatthours',
          'Count',
        ],
        [2025, 99999, 'Fixture Electric Cooperative', 'ZZ', 1, 2, 1000],
      ]),
    },
  ]);
  return [
    [EIA_URL, { body: eia, contentType: 'application/zip' }],
    [
      eoBmfUrl('ZZ'),
      {
        body: 'EIN,NAME,CITY,STATE,SUBSECTION\n990000001,FIXTURE ELECTRIC COOPERATIVE,FIXTURE CITY,ZZ,12\n',
        contentType: 'text/csv',
      },
    ],
    [
      indexUrl(2026),
      {
        body:
          'RETURN_ID,FILING_TYPE,EIN,TAX_PERIOD,SUB_DATE,TAXPAYER_NAME,RETURN_TYPE,DLN,OBJECT_ID,XML_BATCH_ID\n' +
          `1,EFILE,990000001,202506,2026,FIXTURE ELECTRIC COOPERATIVE,990,1,202640159349301609,${RETURN_BATCH}\n`,
        contentType: 'text/csv',
      },
    ],
    [
      batchUrl(2026, RETURN_BATCH),
      {
        body: storedZip([{ name: SAVED_RETURN, data: await coopsSample(SAVED_RETURN) }]),
        contentType: 'application/zip',
      },
    ],
  ];
}

async function peopleAnswers(): Promise<[string, Answer][]> {
  const json = (body: string): Answer => ({ body, contentType: 'application/json' });
  const tarball = buildTarGz(
    [
      {
        path: `people-${PEOPLE_COMMIT}/data/zz/executive/Fixture-Governor-Person.yml`,
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
    { comment: PEOPLE_COMMIT },
  );
  const excerpt = await saved('names-excerpt.csv');
  return [
    [OPENSTATES_PEOPLE_COMMIT_URL, json(JSON.stringify({ sha: PEOPLE_COMMIT }))],
    [OPENSTATES_PEOPLE_TARBALL, { body: tarball, contentType: 'application/x-gzip' }],
    [THUMB, { body: (await saved('portrait.jpg')).bytes, contentType: 'image/jpeg' }],
    [excerpt.meta.url, { body: excerpt.bytes, contentType: 'text/plain; charset=utf-8' }],
  ];
}

/** Every answer the ZZ stages need, by URL. */
export async function zzAnswers(): Promise<(url: string) => Answer | undefined> {
  const statutes = await readFile(
    join(repoRoot(), 'pipeline', 'templates', '__fixtures__', 'zz-statutes.html'),
    'utf8',
  );
  const federal = await readFile(
    join(repoRoot(), 'pipeline', '__fixtures__', 's02', 'known', 'zz-federal-terms.html'),
    'utf8',
  );
  const html = (body: string): Answer => ({ body, contentType: 'text/html; charset=utf-8' });
  const answers = new Map<string, Answer>([
    [STATUTE_URL, html(statutes)],
    [HOUSE_TERM.source_url, html(federal)],
    [SENATE_TERM.source_url, html(federal)],
    [OPENSTATES_URL, { body: openStatesCsv(), contentType: 'text/csv' }],
    [LEGISLATORS_URL, { body: LEGISLATORS_CSV, contentType: 'text/csv' }],
    ...(await coopAnswers()),
    ...(await peopleAnswers()),
  ]);
  const json = (body: string): Answer => ({ body, contentType: 'application/json' });
  const hostAnswers = new Map<string, Answer>([
    ['en.wikipedia.org', json(await zzText('zz-wikipedia-pageimages.json'))],
    ['commons.wikimedia.org', json(await zzText('zz-commons-senate-portrait.json'))],
    [
      'query.wikidata.org',
      {
        body: await zzText('zz-wikidata-holders.json'),
        contentType: 'application/sparql-results+json',
      },
    ],
  ]);
  // Wikipedia, Commons and Wikidata answer by host: their URLs carry each request's query.
  return (url) => {
    const exact = answers.get(url);
    if (exact !== undefined) return exact;
    try {
      return hostAnswers.get(new URL(url).hostname);
    } catch {
      return undefined;
    }
  };
}

/** A stage module that writes the given rows as its output for one state. */
export function fixtureStage(
  id: StageId,
  state: string,
  files: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>,
  extra: Partial<Pick<StageResult, 'checks' | 'datasets'>> = {},
): StageModule {
  return {
    id,
    milestone: 2,
    blockingChecks: [],
    states: () => Promise.resolve([state]),
    async run(_ctx, _state, opts) {
      const written: StageResult['files'][number][] = [];
      for (const [name, rows] of Object.entries(files)) {
        written.push(await opts.out.writeRows(name, rows));
      }
      return { files: written, checks: extra.checks ?? [], datasets: extra.datasets ?? {} };
    },
  };
}

const AnyRow = z.record(z.string(), z.unknown());

/** Rewrites a state's complete output of `stage`, changing the files `changes` names. */
export async function rewriteStageOutput(
  ctx: RunContext,
  stage: StageId,
  state: string,
  changes: Readonly<Record<string, (rows: Record<string, unknown>[]) => Record<string, unknown>[]>>,
): Promise<void> {
  const meta = await readStageMeta(ctx.bucket, stage, state);
  if (meta === null) throw new Error(`no ${stage} output for ${state}`);
  const files: Record<string, Record<string, unknown>[]> = {};
  for (const file of meta.files) {
    const rows: Record<string, unknown>[] = [];
    for await (const row of readStageRows(ctx.bucket, stage, state, file.name, AnyRow))
      rows.push(row);
    const change = changes[file.name];
    files[file.name] = change === undefined ? rows : change(rows);
  }
  const module = fixtureStage(stage, state, files, {
    checks: meta.checks,
    datasets: meta.datasets,
  });
  const result = await runStage(module, ctx, [state], { dryRun: false });
  if (result.exitCode !== 0) throw new Error(`rewriting ${stage} for ${state} failed`);
}

/** Stage 1's ZZ output: the units of the expansion fixtures plus the legislative districts. */
function stage1Files() {
  const stage1 = zzStage1();
  const legislative = [
    ['tiger:sldu:99001', 'State Senate District 1', box(-80, 35, -79, 36)],
    ['tiger:sldu:99002', 'State Senate District 2', box(-79, 35, -77, 36)],
    ['tiger:sldl:99001', 'State House District 1', box(-80, 35, -77, 36)],
  ] as const;
  const geometry = [...stage1.geometry];
  const districts = [...stage1.districts];
  for (const [key, name, shape] of legislative) {
    const row = exactGeometry(key, shape);
    geometry.push(row);
    districts.push(
      BDistrictSchema.parse({
        source_key: key,
        jurisdiction_key: 'state:ZZ',
        name,
        level: 'state',
        geometry_quality: 'exact',
        geom_hash: row.geom_hash,
        population: 1000,
        population_18: 800,
        lean: null,
        lean_basis: null,
        field_meta: {},
      }),
    );
  }
  return {
    listing: stage1.listing,
    files: {
      jurisdictions: stage1.jurisdictions,
      districts,
      district_fallbacks: stage1.fallbacks,
      geometry,
      coverage: [
        { name: 'units:county', value: 2 },
        { name: 'website_unchecked', value: 1 },
      ],
    },
  };
}

export const ZZ_ZIP = BZipCentroidSchema.parse({
  source_key: 'zcta:99001',
  zip: '99001',
  state: 'ZZ',
  lng: -79.5,
  lat: 35.5,
});

/** A context over `bucket` at `now` whose fetcher answers every ZZ request. */
export async function zzContext(
  bucket: DataBucket,
  now: Date = ZZ_NOW,
  runId = 'zz-bundle-fixture',
): Promise<RunContext> {
  return fixtureContext({ bucket, fetcher: zzFetcher(bucket, await zzAnswers()), now, runId });
}

/** A template folder holding the ZZ fixture template as `zz.yaml`, or `text` in its place. */
export async function zzTemplatesDir(text?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-zz-templates-'));
  if (text === undefined) {
    await copyFile(ZZ_TEMPLATE_FIXTURE, join(dir, 'zz.yaml'));
  } else {
    await writeFile(join(dir, 'zz.yaml'), text, 'utf8');
  }
  return dir;
}

/** The three stages the writer reruns, on the ZZ template folder and rules module. */
export function zzStages(templatesDir: string, rules: StateRules = ZZ_RULES): BundleDeps['stages'] {
  const rulesFor = (state: string) => (state === 'ZZ' ? rules : null);
  return {
    s03: makeS03Templates({
      templatesDir,
      rulesFor: (state) => (state === 'ZZ' ? ZZ_RULES : null),
      loadReference: () => loadReferenceIds(repoRoot()),
    }),
    s04: makeS04Expand({ rulesFor }),
    s05: makeS05Deadlines({ rulesFor }),
  };
}

/** The writer's deps for the ZZ fixtures, with the rules tests and the git commit faked. */
export function zzBundleDeps(
  templatesDir: string,
  extra: Partial<BundleDeps> & { readonly rules?: StateRules } = {},
): BundleDeps {
  return {
    runRulesFixtures: () => Promise.resolve({ passed: true, detail: 'passed' }),
    gitSha: () => Promise.resolve('0123456789abcdef0123456789abcdef01234567'),
    runStage: runStageForBundle,
    stages: zzStages(templatesDir, extra.rules),
    templateStates: () => Promise.resolve(['ZZ']),
    rulesFor: (state) => (state === 'ZZ' ? ZZ_RULES : null),
    writerRevision: 0,
    ...extra,
  };
}

async function run(module: StageModule, ctx: RunContext, state: string): Promise<void> {
  const result = await runStage(module, ctx, [state], { dryRun: false });
  if (result.exitCode !== 0) {
    const summary = result.summaries[0];
    throw new Error(
      `the fixture run of ${module.id} for ${state} failed: ${summary?.errorClass ?? ''} ${summary?.failedChecks.join(',') ?? ''}`,
    );
  }
}

/**
 * Writes the ZZ stage outputs into `bucket`: stage 1 (fixtures), then the real stages 3, 2 known,
 * 2 co-ops, 4, 5 and 9 (ZZ and US), in the order their inputs need.
 */
export async function writeZzStageOutputs(bucket: DataBucket): Promise<void> {
  // A run id of its own: some readers keep one result per bucket and run id.
  const ctx = await zzContext(bucket, ZZ_NOW, `zz-${randomUUID()}`);
  const base = stage1Files();
  const baseDatasets = {
    'census-gus': { edition: '2026', ...DATASET_ENTRY },
    tiger: { edition: '2026', ...DATASET_ENTRY },
    'cb-state': { edition: '2025', ...DATASET_ENTRY },
    pl94171: { edition: '2020', ...DATASET_ENTRY },
  };
  const passed = (name: string) => ({ name, passed: true, detail: 'passed' });
  await run(
    fixtureStage('s01-base', 'ZZ', base.files, {
      datasets: baseDatasets,
      checks: [
        passed('listing_header'),
        passed('unit_counts'),
        passed('join_rate'),
        passed('geometry_valid:ZZ'),
      ],
    }),
    ctx,
    'ZZ',
  );
  await run(fixtureStage('s01-base', 'US', { zip_centroids: [ZZ_ZIP], coverage: [] }), ctx, 'US');
  await writeDatasetRows(
    ctx,
    { dataset: 'census-gus', edition: '2026', file: 'parsed.ndjson.gz' },
    base.listing,
  );
  await writeDatasetRows(
    ctx,
    { dataset: 'pl94171', edition: '2020', file: 'blocks-ZZ.ndjson.gz' },
    ZZ_BLOCKS,
  );

  const stages = zzStages(await zzTemplatesDir());
  await run(stages.s03, ctx, 'ZZ');
  await run(makeS02Known({ rulesFor: (state) => (state === 'ZZ' ? ZZ_RULES : null) }), ctx, 'ZZ');
  await run(makeS02Coops({ countyAttributes: () => Promise.resolve(COUNTIES) }), ctx, 'ZZ');
  await run(stages.s04, ctx, 'ZZ');
  await run(stages.s05, ctx, 'ZZ');
  const excerpt = await saved('names-excerpt.csv');
  const people = makeS09People({
    fecApiKey: () => null,
    nicknamesUrl: () => Promise.resolve(excerpt.meta.url),
  });
  await run(people, ctx, 'ZZ');
  await run(people, ctx, 'US');
}
