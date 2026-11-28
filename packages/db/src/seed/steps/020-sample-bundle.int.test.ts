import { createLogger } from '@citizenrun/shared';
import { civicPhotoKey } from '@citizenrun/shared/storage';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { diskReader } from '../../bundle/reader.ts';
import {
  createTestBoss,
  getTestBucket,
  getTestDb,
  getTestObject,
  listTestKeys,
  resetStorage,
} from '../../testing/index.ts';
import { createEnqueue } from '../../queue/enqueue.ts';
import type { SeedContext } from '../index.ts';
import { SAMPLE_MANIFEST_PATH, loadSampleBundle } from './020-sample-bundle.ts';

// TEST-seed-sample-bundle (int:db): step 020 loads the committed sample through the loader.

const ANCHOR = new Date('2027-03-05T12:00:00.000Z');
// Loading the whole sample takes longer than the default case timeout.
const LOAD_TIMEOUT_MS = 300_000;

async function context(): Promise<SeedContext> {
  return {
    anchor: ANCHOR,
    media: await getTestBucket('media'),
    enqueue: createEnqueue(await createTestBoss()),
    log: createLogger({ service: 'api', level: 'error', sink: () => undefined }),
  };
}

async function one<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const [row] = await getTestDb().execute<T>(query, 'objects');
  if (row === undefined) {
    throw new Error('Expected a row.');
  }
  return row;
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  return (await one<{ n: number }>(query)).n;
}

beforeEach(async () => {
  await resetStorage();
});

describe('020-sample-bundle', () => {
  it('loads the sample through the loader', { timeout: LOAD_TIMEOUT_MS }, async () => {
    const manifest = await diskReader(SAMPLE_MANIFEST_PATH).readManifest('manifest.json');
    const result = await loadSampleBundle(getTestDb(), await context());
    expect(result).not.toBe('already_loaded');
    const row = await one<{ status: string; kind: string }>(
      sql`select status, kind from data_bundles where version = ${manifest.version}`,
    );
    expect(row).toEqual({ status: 'loaded', kind: 'full' });
    expect(manifest.assets.length).toBeGreaterThan(0);
    for (const asset of manifest.assets) {
      const key = civicPhotoKey(asset.sha256);
      expect(await getTestObject('media', key), key).not.toBeNull();
    }
    expect((await listTestKeys('media', 'civic/photos/')).length).toBe(manifest.assets.length);
  });

  it('a second run changes nothing', { timeout: LOAD_TIMEOUT_MS }, async () => {
    const db = getTestDb();
    const ctx = await context();
    await loadSampleBundle(db, ctx);
    const changes = await count(sql`select count(*)::int as n from bundle_changes`);
    const jobs = await count(sql`select count(*)::int as n from pgboss.job`);
    const offices = await count(sql`select count(*)::int as n from offices`);
    expect(await loadSampleBundle(db, ctx)).toBe('already_loaded');
    expect(await count(sql`select count(*)::int as n from bundle_changes`)).toBe(changes);
    expect(await count(sql`select count(*)::int as n from pgboss.job`)).toBe(jobs);
    expect(await count(sql`select count(*)::int as n from offices`)).toBe(offices);
    expect(await count(sql`select count(*)::int as n from data_bundles`)).toBe(1);
  });

  it('a row left rejected is loaded again', { timeout: LOAD_TIMEOUT_MS }, async () => {
    const db = getTestDb();
    const ctx = await context();
    const manifest = await diskReader(SAMPLE_MANIFEST_PATH).readManifest('manifest.json');
    await db.execute(
      sql`insert into data_bundles (id, version, kind, status)
          values ('019b76da-a800-7000-8000-000000000001'::uuid, ${manifest.version}, 'full', 'rejected')`,
    );
    const result = await loadSampleBundle(db, ctx);
    expect(result).not.toBe('already_loaded');
    const row = await one<{ id: string; status: string }>(
      sql`select id::text, status from data_bundles where version = ${manifest.version}`,
    );
    expect(row).toEqual({ id: '019b76da-a800-7000-8000-000000000001', status: 'loaded' });
    expect(await count(sql`select count(*)::int as n from offices`)).toBeGreaterThan(0);
  });
});
