import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PipelineEnv } from '../../env.ts';
import { bucketKeys } from '../../lib/bucket.ts';
import { NO_FETCHER, createRunContext } from '../../lib/runner.ts';
import { EditionRecordSchema } from '../../sources/dataset.ts';
import { getTestBucket, resetStorage } from '../../testing/setup.ts';
import { seedDataset } from './datasets-seed.ts';

const ENV: PipelineEnv = Object.freeze({
  DATA_BUCKET: 'fixture',
  DATA_ENDPOINT: 'http://localhost:8333',
  DATA_REGION: 'us-east-1',
  DATA_ACCESS_KEY_ID: 'fixture',
  DATA_SECRET_ACCESS_KEY: 'fixture',
  S3_FORCE_PATH_STYLE: true,
  LOG_LEVEL: 'error',
  PIPELINE_RUN_ID: null,
  FEC_API_KEY: null,
  PIPELINE_SCRATCH_URL: null,
  isCi: false,
});

let temp: string | null = null;

beforeEach(async () => {
  await resetStorage();
  temp = await mkdtemp(join(tmpdir(), 'datasets-seed-'));
});

afterEach(async () => {
  if (temp !== null) await rm(temp, { recursive: true, force: true });
  temp = null;
});

async function context() {
  const { bucket } = await getTestBucket('data');
  const ctx = createRunContext({
    env: ENV,
    now: new Date('2026-11-26T12:00:00.000Z'),
    bucket,
    fetcher: NO_FETCHER,
    log: createLogger({ service: 'pipeline', level: 'error', sink: () => undefined }),
  });
  return { bucket, ctx };
}

async function file(name: string, body: string): Promise<string> {
  const path = join(temp ?? '', name);
  await writeFile(path, body);
  return path;
}

const SOURCE = 'https://www2.census.gov/programs-surveys/school-finances/tables/2024/';

describe('datasets seed', () => {
  it('seeds a file with its edition record', async () => {
    const { bucket, ctx } = await context();
    const body = 'a hand-downloaded fixture file\n';
    const path = await file('elsec24t.xlsx', body);
    const outcome = await seedDataset(ctx, {
      dataset: 'school-finance',
      edition: '2024',
      file: path,
      sourceUrl: SOURCE,
    });
    const sha256 = createHash('sha256').update(body).digest('hex');
    expect(outcome).toEqual({
      exitCode: 0,
      key: 'datasets/school-finance/2024/elsec24t.xlsx',
      sha256,
      bytes: Buffer.byteLength(body),
    });
    expect(
      Buffer.from(
        (await bucket.getBytes(outcome.exitCode === 0 ? outcome.key : '')) ?? [],
      ).toString(),
    ).toBe(body);
    const record = await bucket.getJson(
      bucketKeys.dataset('school-finance', '2024', '_edition.json'),
      EditionRecordSchema,
    );
    expect(record).toEqual({
      dataset: 'school-finance',
      edition: '2024',
      downloaded_on: '2026-11-26',
      source_url: SOURCE,
      seeded: true,
      files: [
        {
          name: 'elsec24t.xlsx',
          url: SOURCE,
          sha256,
          bytes: Buffer.byteLength(body),
          etag: null,
          last_modified: null,
        },
      ],
    });
  });

  it('an unknown dataset id exits 2', async () => {
    const { bucket, ctx } = await context();
    const path = await file('x.csv', 'x\n');
    const outcome = await seedDataset(ctx, {
      dataset: 'nope',
      edition: '2026',
      file: path,
      sourceUrl: SOURCE,
    });
    expect(outcome.exitCode).toBe(2);
    await expect(bucket.head('datasets/nope/2026/x.csv')).resolves.toBeNull();
  });

  it('an http source URL exits 2', async () => {
    const { ctx } = await context();
    const path = await file('x.csv', 'x\n');
    const outcome = await seedDataset(ctx, {
      dataset: 'school-finance',
      edition: '2024',
      file: path,
      sourceUrl: 'http://www2.census.gov/x',
    });
    expect(outcome.exitCode).toBe(2);
  });

  it('a crawl host, a bad edition or a missing file exits 2', async () => {
    const { ctx } = await context();
    const path = await file('x.csv', 'x\n');
    const base = { dataset: 'school-finance', edition: '2024', file: path, sourceUrl: SOURCE };
    expect((await seedDataset(ctx, { ...base, dataset: 'unit-websites' })).exitCode).toBe(2);
    expect((await seedDataset(ctx, { ...base, edition: '24' })).exitCode).toBe(2);
    expect(
      (await seedDataset(ctx, { ...base, file: join(temp ?? '', 'absent.csv') })).exitCode,
    ).toBe(2);
    expect((await seedDataset(ctx, { ...base, file: '/dev/null' })).exitCode).toBe(2);
  });
});
