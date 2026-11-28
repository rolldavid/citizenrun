import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_MANIFEST_PATH } from '../seed/steps/020-sample-bundle.ts';
import {
  fixtureEnqueue,
  fixtureJobs,
  getTestDb,
  resetStorage,
  testMediaStore,
} from '../testing/index.ts';
import { createMediaAssetWriter } from './assets.ts';
import { insertLoadingBundle, loadBundle } from './load.ts';
import { diskReader } from './reader.ts';

// TEST-bundle-loader `loads the sample bundle`: loadBundle on the committed sample folder. The
// case's J-score.offices half arrives with that job.

const NOW = new Date('2027-03-05T12:00:00.000Z');
const LOAD_TIMEOUT_MS = 300_000;

async function count(table: string): Promise<number> {
  const [row] = await getTestDb().execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
    'objects',
  );
  return row?.n ?? -1;
}

beforeEach(async () => {
  await resetStorage();
});

describe('the loader on the sample bundle', () => {
  it('loads the sample bundle', { timeout: LOAD_TIMEOUT_MS }, async () => {
    const db = getTestDb();
    const reader = diskReader(SAMPLE_MANIFEST_PATH);
    const manifest = await reader.readManifest('manifest.json');
    const geometry = await reader.readManifest('../geometry/manifest.json');
    const bundleId = await db.transaction((tx) =>
      insertLoadingBundle(tx, { version: manifest.version, kind: 'full' }),
    );
    if (bundleId === null) throw new Error('No bundle row.');
    const result = await loadBundle(db, reader, 'manifest.json', {
      bundleId,
      approved: false,
      now: NOW,
      enqueue: await fixtureEnqueue(),
      media: createMediaAssetWriter(testMediaStore()),
    });
    expect(result.status).toBe('loaded');

    for (const file of manifest.files) {
      expect(await count(file.name), file.name).toBe(file.rows);
    }
    const zip = geometry.files.find((file) => file.name === 'zip_centroids');
    expect(await count('zip_centroids')).toBe(zip?.rows);

    const [bare] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from districts d
          where d.geometry_quality = 'exact'
            and not exists (select 1 from district_parts p where p.district_id = d.id)`,
      'objects',
    );
    expect(bare?.n).toBe(0);

    const withPowers = (
      await db.execute<{ id: string }>(
        sql`select distinct office_id::text as id from office_powers order by 1`,
        'objects',
      )
    ).map((row) => row.id);
    expect(withPowers.length).toBeGreaterThan(0);
    const queued = new Set<string>();
    for (const data of await fixtureJobs(db, 'score.issues')) {
      const { scope, officeIds } = data as { scope: string; officeIds: string[] };
      expect(scope).toBe('offices');
      for (const id of officeIds) queued.add(id);
    }
    expect([...queued].sort()).toEqual(withPowers);
  });
});
