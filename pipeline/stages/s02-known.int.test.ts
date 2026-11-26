import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BJurisdictionSchema, BOfficeSchema } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { bucketKeys } from '../lib/bucket.ts';
import type { DataBucket } from '../lib/bucket.ts';
import type { FetchResult, Fetcher } from '../lib/fetch/types.ts';
import { StageFailedSchema, readStageMeta, readStageRows, runStage } from '../lib/runner.ts';
import type { StageModule } from '../lib/runner.ts';
import { CONGRESS_REQUIRED, LEGISLATORS_URL } from '../sources/congress.ts';
import { OPENSTATES_HEADER } from '../sources/openstates.ts';
import { fakeFetcher, fixtureContext } from '../templates/__fixtures__/zz-fake-fetcher.ts';
import type { FakeAnswer } from '../templates/__fixtures__/zz-fake-fetcher.ts';
import { getTestBucket, resetStorage, testRunId } from '../testing/setup.ts';
import { HOUSE_TERM, SENATE_TERM } from './federal.ts';
import { S02_KNOWN_FILES, makeS02Known } from './s02-known.ts';
import { KNOWN_FIXTURES, zzDistricts } from './s02-known.fixtures.ts';

const OPENSTATES_URL = 'https://data.openstates.org/people/current/zz.csv';

function openStatesCsv(header: readonly string[]): string {
  const blank = ','.repeat(OPENSTATES_HEADER.length - 7);
  return [
    header.join(','),
    `ocd-person/zz-1,Fixture Senator One,Democratic,1,upper,Fixture,Senator One${blank}`,
    `ocd-person/zz-2,Fixture Senator Two,Republican,2,upper,Fixture,Senator Two${blank}`,
    `ocd-person/zz-3,Fixture Representative Three,Independent,1,lower,Fixture,Representative Three${blank}`,
    '',
  ].join('\n');
}

const LEGISLATORS_CSV = [
  [...CONGRESS_REQUIRED, 'nickname', 'wikipedia_id'].join(','),
  'Z000001,rep,ZZ,1,,Democrat,Fixture,,Member One,,Fixture Member One,,',
  'Z000002,sen,ZZ,,1,Republican,Fixture,,Member Two,,Fixture Member Two,Fixie,Fixture Member Two',
  '',
].join('\n');

const STATE_ROW = BJurisdictionSchema.parse({
  source_key: 'state:ZZ',
  kind: 'state',
  name: 'Fixture State',
  state: 'ZZ',
  census_id: null,
  parent_key: null,
  population: 5000,
  website: null,
  timezone: null,
  budget_cents: null,
  budget_year: null,
  census_active: null,
  label_lng: null,
  label_lat: null,
  field_meta: {},
});

/** Stage 1's output for ZZ, written through the runner so it has its `_meta.json`. */
const fixtureBase: StageModule = {
  id: 's01-base',
  milestone: 2,
  blockingChecks: [],
  states: () => Promise.resolve(['ZZ']),
  async run(_ctx, _state, opts) {
    return {
      files: [
        await opts.out.writeRows('districts', zzDistricts()),
        await opts.out.writeRows('jurisdictions', [STATE_ROW]),
      ],
      checks: [],
      datasets: {},
    };
  },
};

/** Both constitution URLs answered with the hand-written page that holds the two quotes. */
async function constitutionPages(): Promise<Record<string, FakeAnswer>> {
  const body = await readFile(join(KNOWN_FIXTURES, 'zz-federal-terms.html'), 'utf8');
  const page = { body, contentType: 'text/html; charset=utf-8' };
  return { [HOUSE_TERM.source_url]: page, [SENATE_TERM.source_url]: page };
}

/** The template test fetcher for pages, with downloads of the two files written to their key. */
function datasetFetcher(
  bucket: DataBucket,
  pages: Readonly<Record<string, FakeAnswer>>,
  files: Readonly<Record<string, string | Exclude<FetchResult, { kind: 'ok' }>>>,
): Fetcher {
  const pageFetcher = fakeFetcher(bucket, pages);
  return {
    fetch: (req) => pageFetcher.fetch(req),
    async download(req, key) {
      const file = files[req.url];
      if (file === undefined) {
        return { kind: 'error', status: null, reason: 'network' };
      }
      if (typeof file !== 'string') {
        return file;
      }
      const bytes = new TextEncoder().encode(file);
      await bucket.putBytes(key, bytes, 'text/csv');
      return {
        kind: 'ok',
        finalUrl: req.url,
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        etag: null,
        lastModified: null,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength,
        cacheKey: key,
      };
    },
  };
}

function context(bucket: DataBucket, fetcher: Fetcher) {
  return fixtureContext({
    bucket,
    fetcher,
    now: new Date('2026-11-21T23:30:00.000Z'),
    runId: testRunId(),
  });
}

const stage = () => makeS02Known({ rulesFor: () => null });

beforeEach(async () => {
  await resetStorage();
});

describe('stage 2 known bodies', () => {
  it('writes the six files and _meta.json, then keeps them when the header changes', async () => {
    const { bucket } = await getTestBucket('data');
    const base = await runStage(fixtureBase, context(bucket, fakeFetcher(bucket, {})), ['ZZ'], {
      dryRun: false,
    });
    expect(base.exitCode).toBe(0);

    const pages = await constitutionPages();
    const first = context(
      bucket,
      datasetFetcher(bucket, pages, {
        [OPENSTATES_URL]: openStatesCsv(OPENSTATES_HEADER),
        [LEGISLATORS_URL]: LEGISLATORS_CSV,
      }),
    );
    const known = stage();
    expect(await known.states(first)).toEqual(['ZZ']);
    const done = await runStage(known, first, ['ZZ'], { dryRun: false });
    expect(done.exitCode).toBe(0);

    const meta = await readStageMeta(bucket, 's02-known', 'ZZ');
    expect(meta?.run_id).toBe(first.runId);
    expect(meta?.files.map((f) => f.name).sort()).toEqual(Object.values(S02_KNOWN_FILES).sort());
    const check = meta?.checks.find((c) => c.name === 'known');
    expect(check?.passed).toBe(true);
    expect(check?.detail).toContain('legislators=3');
    expect(check?.detail).toContain('members=2');
    expect(check?.detail).toContain('legislator_unmapped=0');
    expect(meta?.datasets).toEqual({
      openstates: {
        edition: '2026-11-21',
        downloaded_on: '2026-11-21',
        source_url: OPENSTATES_URL,
      },
      'congress-legislators': {
        edition: '2026-11-21',
        downloaded_on: '2026-11-21',
        source_url: LEGISLATORS_URL,
      },
    });

    const offices = [];
    for await (const row of readStageRows(bucket, 's02-known', 'ZZ', 'offices', BOfficeSchema)) {
      offices.push(row);
    }
    expect(offices.map((o) => o.office_type_id).sort()).toEqual([
      'state-house',
      'state-house',
      'state-senate',
      'state-senate',
      'state-senate',
      'state-senate',
      'us-house',
      'us-house',
      'us-senate',
    ]);
    const house = offices.find((o) => o.office_type_id === 'us-house');
    expect(house?.field_meta['term_years']).toMatchObject({
      confidence: 'medium',
      checked_at: '2026-11-21T23:30:00.000Z',
    });
    const senate = offices.find((o) => o.office_type_id === 'us-senate');
    expect(senate?.field_meta['term_years']).toMatchObject({ confidence: 'medium' });
    expect(senate?.slug).toBe('zz-fixture-state-u-s-senator-class-1');

    const renamed = OPENSTATES_HEADER.map((name) =>
      name === 'current_district' ? 'district' : name,
    );
    const second = context(
      bucket,
      datasetFetcher(bucket, pages, {
        [OPENSTATES_URL]: openStatesCsv(renamed),
        [LEGISLATORS_URL]: LEGISLATORS_CSV,
      }),
    );
    const failed = await runStage(stage(), second, ['ZZ'], { dryRun: false });
    expect(failed.exitCode).toBe(1);
    expect(failed.summaries[0]?.failedChecks).toEqual(['openstates_header']);
    const record = await bucket.getJson(
      bucketKeys.stageFailed('s02-known', 'ZZ', second.runId),
      StageFailedSchema,
    );
    expect(record?.checks).toEqual([
      { name: 'openstates_header', passed: false, detail: 'missing=current_district' },
    ]);
    const kept = await readStageMeta(bucket, 's02-known', 'ZZ');
    expect(kept?.run_id).toBe(first.runId);
    let rows = 0;
    for await (const row of readStageRows(bucket, 's02-known', 'ZZ', 'offices', BOfficeSchema)) {
      expect(row.jurisdiction_key).toBe('state:ZZ');
      rows += 1;
    }
    expect(rows).toBe(offices.length);
  });

  it('a file the fetcher cannot get fails dataset_unavailable', async () => {
    const { bucket } = await getTestBucket('data');
    await runStage(fixtureBase, context(bucket, fakeFetcher(bucket, {})), ['ZZ'], {
      dryRun: false,
    });
    const ctx = context(
      bucket,
      datasetFetcher(bucket, await constitutionPages(), {
        [OPENSTATES_URL]: { kind: 'disallowed', reason: 'robots' },
        [LEGISLATORS_URL]: LEGISLATORS_CSV,
      }),
    );
    const result = await runStage(stage(), ctx, ['ZZ'], { dryRun: false });
    expect(result.exitCode).toBe(1);
    expect(result.summaries[0]?.failedChecks).toEqual(['dataset_unavailable:openstates']);
    expect(await readStageMeta(bucket, 's02-known', 'ZZ')).toBeNull();
  });
});
