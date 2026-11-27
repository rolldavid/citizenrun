import { createHash } from 'node:crypto';
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BGeometrySchema,
  BJurisdictionSchema,
  BOfficeSchema,
  BOfficeholderSchema,
  BPersonSchema,
} from '@citizenrun/shared';
import type { BDistrict, BGeometry, BJurisdiction } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { bucketKeys } from '../lib/bucket.ts';
import type { DataBucket } from '../lib/bucket.ts';
import type { FetchRequest, FetchResult, Fetcher } from '../lib/fetch/types.ts';
import { readStageMeta, readStageRows, runStage } from '../lib/runner.ts';
import type { StageModule } from '../lib/runner.ts';
import { multiPolygonToWkb, toHex } from '../lib/wkb.ts';
import type { Position } from '../lib/wkb.ts';
import { writeXlsx } from '../lib/xlsx.ts';
import { storedZip } from '../lib/zip.fixtures.ts';
import { EIA_URL } from '../sources/eia861.ts';
import { coopsSample } from '../sources/eia861.fixtures.ts';
import { eoBmfUrl } from '../sources/irs-eobmf.ts';
import { irsBatchZip } from '../sources/irs990.fixtures.ts';
import { batchUrl, indexUrl } from '../sources/irs990.ts';
import { fixtureContext } from '../templates/__fixtures__/zz-fake-fetcher.ts';
import { getTestBucket, resetStorage, testRunId } from '../testing/setup.ts';
import { makeS02Coops } from './s02-coops.ts';
import { OfficeRefRowSchema } from './shared/office-ref.ts';

const SAVED = '202640159349301609_public.xml';
const BATCH = '2026_TEOS_XML_01A';
const NOW = new Date('2026-11-26T23:00:00.000Z');

type Answer = { body: Uint8Array; contentType: string };
type RecordingFetcher = Fetcher & { readonly requests: { url: string; key: string | null }[] };

/** Answers each URL from `answers`, storing a download at its key as the real fetcher does. */
function recordingFetcher(
  bucket: DataBucket,
  answers: ReadonlyMap<string, Answer>,
): RecordingFetcher {
  const requests: { url: string; key: string | null }[] = [];
  const answer = async (req: FetchRequest, key: string | null): Promise<FetchResult> => {
    requests.push({ url: req.url, key });
    const found = answers.get(req.url);
    if (found === undefined) return { kind: 'error', status: 404, reason: 'http_status' };
    const sha256 = createHash('sha256').update(found.body).digest('hex');
    const target = key ?? bucketKeys.rawCache(sha256, 'bin');
    await bucket.putBytes(target, found.body, found.contentType);
    return {
      kind: 'ok',
      finalUrl: req.url,
      status: 200,
      contentType: found.contentType,
      etag: null,
      lastModified: null,
      sha256,
      bytes: found.body.byteLength,
      cacheKey: target,
    };
  };
  return {
    requests,
    fetch: (req) => answer(req, null),
    download: (req, key) => answer(req, key),
  };
}

function square(x: number): Position[][][] {
  return [
    [
      [
        [x, 0],
        [x + 1, 0],
        [x + 1, 1],
        [x, 1],
        [x, 0],
      ],
    ],
  ];
}

function exactGeometry(key: string, x: number): BGeometry {
  const wkb = multiPolygonToWkb(square(x));
  return BGeometrySchema.parse({
    source_key: key,
    lookup_wkb: toHex(wkb),
    display_wkb: toHex(wkb),
    label_point: [x + 0.5, 0.5],
    outline_svg: 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z',
    outline_bbox: [x, 0, x + 1, 1],
    geom_hash: createHash('sha256').update(wkb).digest('hex'),
  });
}

function jurisdiction(
  key: string,
  kind: 'state' | 'county',
  name: string,
  population: number,
): BJurisdiction {
  return BJurisdictionSchema.parse({
    source_key: key,
    kind,
    name,
    state: 'ZZ',
    census_id: kind === 'county' ? key.slice('census:'.length) : null,
    parent_key: null,
    population,
    website: null,
    timezone: null,
    budget_cents: null,
    budget_year: null,
    census_active: null,
    label_lng: null,
    label_lat: null,
    field_meta: {},
  });
}

function district(key: string, jurisdictionKey: string, name: string, geomHash: string): BDistrict {
  return BDistrictSchema.parse({
    source_key: key,
    jurisdiction_key: jurisdictionKey,
    name,
    level: key.startsWith('tiger:state:') ? 'state' : 'county',
    geometry_quality: 'exact',
    geom_hash: geomHash,
    population: null,
    population_18: null,
    lean: null,
    lean_basis: null,
    field_meta: {},
  });
}

/** A `ZZ` stage 1 output: the state and two counties, with geometry rows. */
async function writeBase(bucket: DataBucket): Promise<void> {
  const geometry = [
    exactGeometry('tiger:county:99001', 0),
    exactGeometry('tiger:county:99003', 1),
    exactGeometry('tiger:state:99', 0),
  ];
  const hash = (key: string) => geometry.find((g) => g.source_key === key)?.geom_hash ?? '';
  const base: StageModule = {
    id: 's01-base',
    milestone: 2,
    blockingChecks: [],
    states: () => Promise.resolve(['ZZ']),
    async run(_ctx, _state, opts) {
      const files = [
        await opts.out.writeRows('jurisdictions', [
          jurisdiction('census:900001', 'county', 'Fixture County', 100),
          jurisdiction('census:900003', 'county', 'Fixture Second County', 300),
          jurisdiction('state:ZZ', 'state', 'Fixture State', 400),
        ]),
        await opts.out.writeRows('districts', [
          district(
            'tiger:county:99001',
            'census:900001',
            'Fixture County',
            hash('tiger:county:99001'),
          ),
          district(
            'tiger:county:99003',
            'census:900003',
            'Fixture Second County',
            hash('tiger:county:99003'),
          ),
          district('tiger:state:99', 'state:ZZ', 'Fixture State', hash('tiger:state:99')),
        ]),
        await opts.out.writeRows('district_fallbacks', []),
        await opts.out.writeRows('geometry', geometry),
      ];
      return { files, checks: [], datasets: {} };
    },
  };
  const ctx = fixtureContext({
    bucket,
    fetcher: recordingFetcher(bucket, new Map()),
    now: NOW,
    runId: testRunId(),
  });
  expect((await runStage(base, ctx, ['ZZ'], { dryRun: false })).exitCode).toBe(0);
}

/** The made-up national files of one `ZZ` co-op, under the real URLs, and the saved return's batch. */
async function answers(opts: { city: boolean } = { city: true }): Promise<Map<string, Answer>> {
  const xlsx = (rows: (string | number | null)[][]) => writeXlsx([{ name: 'States', rows }]);
  const utilityRows: (string | number | null)[][] = [
    ['Utility Characteristics', null, null, null, null, null],
    ['Data Year', 'Utility Number', 'Utility Name', 'State', 'Ownership Type', 'City'],
    [2025, 99999, 'Fixture Electric Cooperative', 'ZZ', 'Cooperative', 'Fixture City'],
  ];
  const eia = storedZip([
    {
      name: 'Utility_Data_2025.xlsx',
      data: await xlsx(opts.city ? utilityRows : utilityRows.map((row) => row.slice(0, 5))),
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
  const text = (s: string) => new TextEncoder().encode(s);
  return new Map<string, Answer>([
    [EIA_URL, { body: eia, contentType: 'application/zip' }],
    [
      eoBmfUrl('ZZ'),
      {
        body: text(
          'EIN,NAME,CITY,STATE,SUBSECTION\n990000001,FIXTURE ELECTRIC COOPERATIVE,FIXTURE CITY,ZZ,12\n',
        ),
        contentType: 'text/csv',
      },
    ],
    [
      indexUrl(2026),
      {
        body: text(
          'RETURN_ID,FILING_TYPE,EIN,TAX_PERIOD,SUB_DATE,TAXPAYER_NAME,RETURN_TYPE,DLN,OBJECT_ID,XML_BATCH_ID\n' +
            `1,EFILE,990000001,202506,2026,FIXTURE ELECTRIC COOPERATIVE,990,1,202640159349301609,${BATCH}\n`,
        ),
        contentType: 'text/csv',
      },
    ],
    [
      batchUrl(2026, BATCH),
      {
        body: storedZip([{ name: SAVED, data: await coopsSample(SAVED) }]),
        contentType: 'application/zip',
      },
    ],
  ]);
}

const COUNTIES = [
  { geoid: '99001', statefp: '99', name: 'Fixture County' },
  { geoid: '99003', statefp: '99', name: 'Fixture Second County' },
];

async function rows<T>(bucket: DataBucket, name: string, schema: z.ZodType<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const row of readStageRows(bucket, 's02-coops', 'ZZ', name, schema)) out.push(row);
  return out;
}

async function keysUnder(bucket: DataBucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const info of bucket.list(prefix)) keys.push(info.key);
  return keys.sort();
}

describe('stage 2, co-ops', () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it('writes the co-op files, keeps only the matched return and fetches no batch a second time', async () => {
    const { bucket } = await getTestBucket('data');
    await writeBase(bucket);
    const table = await answers();
    const module = makeS02Coops({ countyAttributes: () => Promise.resolve(COUNTIES) });
    const fetcher = recordingFetcher(bucket, table);
    const ctx = fixtureContext({ bucket, fetcher, now: NOW, runId: testRunId() });
    expect(await module.states(ctx)).toEqual(['ZZ']);
    const result = await runStage(module, ctx, 'all', { dryRun: false });
    expect(result.summaries.map((s) => [s.state, s.status])).toEqual([['ZZ', 'done']]);

    const meta = await readStageMeta(bucket, 's02-coops', 'ZZ');
    expect(meta?.files.map((f) => f.name)).toEqual([
      'jurisdictions',
      'districts',
      'district_fallbacks',
      'geometry',
      'offices',
      'office_powers',
      'people',
      'officeholders',
      'office_refs',
      'facts',
    ]);
    expect(Object.keys(meta?.datasets ?? {}).sort()).toEqual(['eia861', 'irs-eobmf', 'irs990']);
    expect(meta?.checks.find((c) => c.name === 'coops')?.detail).toContain('matched=1');

    expect(
      (await rows(bucket, 'jurisdictions', BJurisdictionSchema)).map((j) => j.source_key),
    ).toEqual(['coop:99999']);
    const districts = await rows(bucket, 'districts', BDistrictSchema);
    const geometry = await rows(bucket, 'geometry', BGeometrySchema);
    expect(districts.map((d) => d.source_key)).toEqual(['county_approx:coop:99999']);
    expect(geometry.map((g) => g.source_key)).toEqual(['county_approx:coop:99999']);
    expect(districts[0]?.geom_hash).toBe(geometry[0]?.geom_hash);
    expect(
      (await rows(bucket, 'district_fallbacks', BDistrictFallbackSchema)).map(
        (f) => f.via_district_key,
      ),
    ).toEqual(['tiger:county:99001', 'tiger:county:99003']);
    const offices = await rows(bucket, 'offices', BOfficeSchema);
    expect(
      offices.map((o) => [o.slug, o.body_size, o.electorate, o.pay_annual_cents, o.hours_per_week]),
    ).toEqual([['zz-fixture-electric-cooperative-director', 9, 1000, 1_721_300, 10]]);
    expect(await rows(bucket, 'office_refs', OfficeRefRowSchema)).toHaveLength(1);
    const people = await rows(bucket, 'people', BPersonSchema);
    expect(people).toHaveLength(9);
    expect(people.every((p) => p.roster_only && p.source_key.startsWith('irs990:990000001:'))).toBe(
      true,
    );
    expect(
      (await rows(bucket, 'officeholders', BOfficeholderSchema)).every((h) => h.since === null),
    ).toBe(true);

    // The batch was fetched once and deleted; only the matched return is kept beside the index.
    expect(fetcher.requests.filter((r) => r.url === batchUrl(2026, BATCH))).toHaveLength(1);
    expect(await keysUnder(bucket, 'datasets/irs990/2026/')).toEqual([
      'datasets/irs990/2026/202640159349301609_public.xml',
      'datasets/irs990/2026/_edition.json',
      'datasets/irs990/2026/index_2026.csv',
    ]);
    expect(await bucket.head(bucketKeys.coopsUnresolved())).not.toBeNull();

    const second = recordingFetcher(bucket, table);
    const later = fixtureContext({ bucket, fetcher: second, now: NOW, runId: testRunId() });
    const again = makeS02Coops({ countyAttributes: () => Promise.resolve(COUNTIES) });
    expect((await runStage(again, later, ['ZZ'], { dryRun: false })).exitCode).toBe(0);
    expect(second.requests.map((r) => r.url)).not.toContain(batchUrl(2026, BATCH));
    expect(second.requests.length).toBeGreaterThan(0);
    expect((await rows(bucket, 'offices', BOfficeSchema))[0]?.body_size).toBe(9);
  });

  it('with no EIA city column the single candidate is matched by name and its return fetched', async () => {
    const { bucket } = await getTestBucket('data');
    await writeBase(bucket);
    const fetcher = recordingFetcher(bucket, await answers({ city: false }));
    const module = makeS02Coops({ countyAttributes: () => Promise.resolve(COUNTIES) });
    const ctx = fixtureContext({ bucket, fetcher, now: NOW, runId: testRunId() });
    const result = await runStage(module, ctx, ['ZZ'], { dryRun: false });
    expect(result.summaries.map((s) => [s.state, s.status])).toEqual([['ZZ', 'done']]);
    const meta = await readStageMeta(bucket, 's02-coops', 'ZZ');
    const detail = meta?.checks.find((c) => c.name === 'coops')?.detail;
    expect(detail).toContain('matched=1');
    expect(detail).toContain('ein_name_only=1');
    expect(Object.keys(meta?.datasets ?? {}).sort()).toEqual(['eia861', 'irs-eobmf', 'irs990']);
    expect(fetcher.requests.filter((r) => r.url === batchUrl(2026, BATCH))).toHaveLength(1);
    const office = (await rows(bucket, 'offices', BOfficeSchema))[0];
    expect(office?.body_size).toBe(9);
    expect(
      Object.entries(office?.field_meta ?? {}).every(
        ([, m]) => m.confidence === 'medium' || m.confidence === 'low',
      ),
    ).toBe(true);
    expect(await rows(bucket, 'people', BPersonSchema)).toHaveLength(9);
  });

  it('a batch whose return is packed with Deflate64 is read with the system unzip', async () => {
    const { bucket } = await getTestBucket('data');
    await writeBase(bucket);
    const table = await answers({ city: false });
    table.set(batchUrl(2026, BATCH), {
      body: irsBatchZip(SAVED, await coopsSample(SAVED)),
      contentType: 'application/zip',
    });
    const module = makeS02Coops({ countyAttributes: () => Promise.resolve(COUNTIES) });
    const ctx = fixtureContext({
      bucket,
      fetcher: recordingFetcher(bucket, table),
      now: NOW,
      runId: testRunId(),
    });
    const result = await runStage(module, ctx, ['ZZ'], { dryRun: false });
    expect(result.summaries.map((s) => [s.state, s.status])).toEqual([['ZZ', 'done']]);
    const detail = (await readStageMeta(bucket, 's02-coops', 'ZZ'))?.checks.find(
      (c) => c.name === 'coops',
    )?.detail;
    expect(detail).toContain('matched=1');
    expect(detail).toContain('batch_unavailable=0');
    expect((await rows(bucket, 'offices', BOfficeSchema))[0]?.body_size).toBe(9);
    expect(await rows(bucket, 'people', BPersonSchema)).toHaveLength(9);
    expect(await keysUnder(bucket, 'datasets/irs990/2026/')).toEqual([
      'datasets/irs990/2026/202640159349301609_public.xml',
      'datasets/irs990/2026/_edition.json',
      'datasets/irs990/2026/index_2026.csv',
    ]);
  });

  it('a batch whose return neither yauzl nor unzip can decompress counts batch_unavailable', async () => {
    const { bucket } = await getTestBucket('data');
    await writeBase(bucket);
    const table = await answers({ city: false });
    // The same archive with its entry marked Deflate64 (method 9) in both headers, though its bytes
    // are stored: yauzl refuses the method and unzip exits non-zero on the invalid stream.
    const zip = storedZip([{ name: SAVED, data: await coopsSample(SAVED) }]);
    zip.writeUInt16LE(9, 8);
    zip.writeUInt16LE(9, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
    table.set(batchUrl(2026, BATCH), { body: zip, contentType: 'application/zip' });
    const module = makeS02Coops({ countyAttributes: () => Promise.resolve(COUNTIES) });
    const ctx = fixtureContext({
      bucket,
      fetcher: recordingFetcher(bucket, table),
      now: NOW,
      runId: testRunId(),
    });
    const result = await runStage(module, ctx, ['ZZ'], { dryRun: false });
    expect(result.summaries.map((s) => [s.state, s.status])).toEqual([['ZZ', 'done']]);
    const detail = (await readStageMeta(bucket, 's02-coops', 'ZZ'))?.checks.find(
      (c) => c.name === 'coops',
    )?.detail;
    expect(detail).toContain('batch_unavailable=1');
    expect(detail).toContain('matched=0');
    expect(await rows(bucket, 'people', BPersonSchema)).toEqual([]);
    expect(await keysUnder(bucket, 'datasets/irs990/2026/')).toEqual([
      'datasets/irs990/2026/_edition.json',
      'datasets/irs990/2026/index_2026.csv',
    ]);
  });

  it('a state whose EO BMF file is unavailable keeps its last good output', async () => {
    const { bucket } = await getTestBucket('data');
    await writeBase(bucket);
    const table = await answers();
    table.delete(eoBmfUrl('ZZ'));
    const module = makeS02Coops({ countyAttributes: () => Promise.resolve(COUNTIES) });
    const ctx = fixtureContext({
      bucket,
      fetcher: recordingFetcher(bucket, table),
      now: NOW,
      runId: testRunId(),
    });
    const result = await runStage(module, ctx, ['ZZ'], { dryRun: false });
    expect(result.exitCode).toBe(1);
    expect(result.summaries[0]?.failedChecks).toEqual(['dataset_unavailable:irs-eobmf']);
    expect(await readStageMeta(bucket, 's02-coops', 'ZZ')).toBeNull();
  });
});
