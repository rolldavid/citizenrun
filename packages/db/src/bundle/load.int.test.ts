import { createHash } from 'node:crypto';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { civicId, newId, zctaKey } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  fixtureJobs,
  fixtureVersion,
  getTestBucket,
  getTestDb,
  getTestObject,
  insertFollow,
  insertUser,
  loadFixture,
  putTestObject,
  resetStorage,
  ringWkbHex,
  setUserDistricts,
  sha256Hex,
  snapshotCivic,
  squareWkbHex,
  testDataBucketClient,
  testMediaStore,
  writeFixtureBundle,
  zzBundle,
  zzGeometry,
  zzPhotoJpeg,
  HOLD_FAULTS,
} from '../testing/index.ts';
import type { FixtureBundleInput, FixtureRows } from '../testing/index.ts';
import { createMediaAssetWriter } from './assets.ts';
import { insertLoadingBundle, loadBundle, markBundleRejected } from './load.ts';
import { bucketReader } from './reader.ts';
import { clearStaging } from './stage.ts';
import { BundleStatsSchema } from './stats.ts';

// TEST-bundle-loader: loadBundle on fixture bundles in this worker's test buckets.

const TODAY = '2027-01-15';
const NOW = new Date('2027-01-15T06:00:00Z');
const LATER = new Date('2027-01-16T06:00:00Z');
const ALDER_DISTRICT = 'tiger:county:99001';
const BIRCH_DISTRICT = 'tiger:county:99003';

function version(minute: number): string {
  return fixtureVersion(`2027-01-15T06:${String(minute).padStart(2, '0')}:00Z`, 'full');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function input(
  minute: number,
  files: FixtureRows = zzBundle({ today: TODAY }),
): FixtureBundleInput {
  return { version: version(minute), files: structuredClone(files), geometry: zzGeometry() };
}

function rowsOf(files: FixtureRows, file: keyof FixtureRows): Record<string, unknown>[] {
  const found = files[file];
  if (found === undefined) {
    throw new Error(`No ${file} rows.`);
  }
  return found;
}

function only<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined || items.length !== 1) {
    throw new Error('Expected exactly one item.');
  }
  return item;
}

async function query<T extends Record<string, unknown>>(
  text: ReturnType<typeof sql>,
): Promise<T[]> {
  return getTestDb().execute<T>(text, 'objects');
}

async function count(table: string): Promise<number> {
  const [row] = await query<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return row?.n ?? -1;
}

async function changesOf(bundleId: string): Promise<
  {
    table_name: string;
    op: string;
    row_key: Record<string, string>;
    before: Record<string, unknown> | null;
  }[]
> {
  return query(
    sql`select table_name, op, row_key, before from bundle_changes where bundle_id = ${bundleId}::uuid order by id`,
  );
}

type OfficeTimes = {
  id: string;
  title: string;
  changed_at: string;
  updated_at: string;
  retired_at: string | null;
};

async function office(slug: string): Promise<OfficeTimes> {
  return only(
    await query<OfficeTimes>(
      sql`select id, title, ${iso('changed_at')} as changed_at, ${iso('updated_at')} as updated_at,
                 ${iso('retired_at')} as retired_at
          from offices where slug = ${slug}`,
    ),
  );
}

/** A timestamptz column as the ISO text Date.toISOString gives: the driver hands timestamps back as text here. */
function iso(column: string): ReturnType<typeof sql> {
  return sql`to_char(${sql.identifier(column)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** The ISO day `days` after a YYYY-MM-DD day. */
function shiftDay(day: unknown, days: number): string {
  return new Date(Date.parse(`${String(day)}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function officeSlug(index: number): string {
  return `zz-fixture-seat-${String(index).padStart(3, '0')}`;
}

beforeEach(async () => {
  await resetStorage();
  await clearStaging(getTestDb());
});

describe('loadBundle', () => {
  it('loads a ZZ bundle', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    const { bundleId, result } = await loadFixture(db, input(0, files), { now: NOW });
    expect(result.status).toBe('loaded');

    const expected: Record<string, number> = {
      jurisdictions: 5,
      districts: 5,
      district_fallbacks: 1,
      offices: 20,
      office_powers: 20,
      elections: 40,
      filing_tracks: 40,
      people: 20,
      person_aliases: 20,
      given_name_aliases: 1,
      officeholders: 20,
    };
    for (const [table, rows] of Object.entries(expected)) {
      expect(await count(table), table).toBe(rows);
      expect(rowsOf(files, table as keyof FixtureRows)).toHaveLength(rows);
    }
    for (const table of [
      'jurisdictions',
      'districts',
      'offices',
      'elections',
      'filing_tracks',
      'people',
      'officeholders',
    ] as const) {
      const rows = await query<{ id: string; source_key: string }>(
        sql`select id, source_key from ${sql.identifier(table)}`,
      );
      for (const row of rows) {
        expect(row.id).toBe(civicId(table, row.source_key));
      }
    }
    expect(result.stats.counts.offices).toEqual({ rows: 20, inserted: 20, updated: 0, retired: 0 });

    const jobs = await fixtureJobs(db, 'score.issues');
    const job = only(jobs) as { scope: string; officeIds: string[] };
    expect(job.scope).toBe('offices');
    const officeIds = (await query<{ id: string }>(sql`select id from offices order by id`)).map(
      (row) => row.id,
    );
    expect([...job.officeIds].sort()).toEqual(officeIds);

    expect(await count('district_parts')).toBeGreaterThanOrEqual(4);
    expect(await count('zip_centroids')).toBe(1);
    const [staged] = await query<{ n: number }>(
      sql`select (select count(*) from staging.bundle_rows)::int + (select count(*) from staging.district_geometry)::int as n`,
    );
    expect(staged?.n).toBe(0);
    const [bundle] = await query<{ status: string; loaded_at: string }>(
      sql`select status, ${iso('loaded_at')} as loaded_at from data_bundles where id = ${bundleId}::uuid`,
    );
    expect(bundle).toEqual({ status: 'loaded', loaded_at: NOW.toISOString() });
    // The headline deadline is derived from the tracks.
    const [election] = await query<{ n: number }>(
      sql`select count(*)::int as n from elections where filing_deadline is null or deadline_basis <> 'computed'`,
    );
    expect(election?.n).toBe(0);
  });

  it('same bundle twice changes nothing', async () => {
    const db = getTestDb();
    await loadFixture(db, input(0), { now: NOW });
    const before = await snapshotCivic(db);
    const jobsBefore = (await fixtureJobs(db, 'score.issues')).length;
    const { bundleId, result } = await loadFixture(db, input(1), { now: LATER });
    expect(result.status).toBe('loaded');
    expect(await changesOf(bundleId)).toEqual([]);
    expect(await snapshotCivic(db)).toEqual(before);
    expect((await fixtureJobs(db, 'score.issues')).length).toBe(jobsBefore);
    expect(result.stats.counts.offices).toEqual({ rows: 20, inserted: 0, updated: 0, retired: 0 });
  });

  it('retires, never deletes', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const gone = await office(officeSlug(1));
    const follow = await insertFollow(db, { targetId: gone.id });

    const second = structuredClone(files);
    const slug = officeSlug(1);
    const electionKeys = rowsOf(second, 'elections')
      .filter((row) => row.office_key === slug)
      .map((row) => row.source_key);
    second.offices = rowsOf(second, 'offices').filter((row) => row.source_key !== slug);
    second.office_powers = rowsOf(second, 'office_powers').filter((row) => row.office_key !== slug);
    second.elections = rowsOf(second, 'elections').filter((row) => row.office_key !== slug);
    second.filing_tracks = rowsOf(second, 'filing_tracks').filter(
      (row) => !electionKeys.includes(row.election_key),
    );
    second.officeholders = rowsOf(second, 'officeholders').filter((row) => row.office_key !== slug);
    const { bundleId, result } = await loadFixture(db, input(1, second), { now: LATER });
    expect(result.status).toBe('loaded');

    const retired = await office(slug);
    expect(retired.retired_at).toBe(LATER.toISOString());
    expect(await query(sql`select * from offices where id = ${gone.id}::uuid`)).toHaveLength(1);
    expect(
      await query(
        sql`select 1 from follows where follower_id = ${follow.followerId}::uuid and target_id = ${gone.id}::uuid`,
      ),
    ).toHaveLength(1);
    const elections = await query<{ retired_at: string | null }>(
      sql`select ${iso('retired_at')} as retired_at from elections where office_id = ${gone.id}::uuid`,
    );
    expect(elections).toEqual([
      { retired_at: LATER.toISOString() },
      { retired_at: LATER.toISOString() },
    ]);
    expect(
      await query(sql`select 1 from office_powers where office_id = ${gone.id}::uuid`),
    ).toEqual([]);
    expect(
      await query(
        sql`select 1 from filing_tracks t join elections e on e.id = t.election_id where e.office_id = ${gone.id}::uuid`,
      ),
    ).toEqual([]);

    const changes = await changesOf(bundleId);
    const deleted = (table: string) =>
      changes.filter((change) => change.table_name === table && change.op === 'delete');
    expect(deleted('office_powers').map((change) => change.row_key.office_id)).toEqual([gone.id]);
    expect(deleted('office_powers')[0]?.before).toMatchObject({
      power_id: 'zoning-land-use',
      relevance: 3,
    });
    expect(deleted('filing_tracks')).toHaveLength(2);
    expect(deleted('officeholders')).toHaveLength(1);
    expect(
      changes
        .filter((change) => change.op === 'retire')
        .map((change) => change.table_name)
        .sort(),
    ).toEqual(['elections', 'elections', 'offices']);
    expect(result.stats.counts.offices).toEqual({ rows: 19, inserted: 0, updated: 0, retired: 1 });
  });

  it('a reappearing row is un-retired', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const slug = officeSlug(2);
    const second = structuredClone(files);
    const electionKeys = rowsOf(second, 'elections')
      .filter((row) => row.office_key === slug)
      .map((row) => row.source_key);
    second.offices = rowsOf(second, 'offices').filter((row) => row.source_key !== slug);
    second.office_powers = rowsOf(second, 'office_powers').filter((row) => row.office_key !== slug);
    second.elections = rowsOf(second, 'elections').filter((row) => row.office_key !== slug);
    second.filing_tracks = rowsOf(second, 'filing_tracks').filter(
      (row) => !electionKeys.includes(row.election_key),
    );
    second.officeholders = rowsOf(second, 'officeholders').filter((row) => row.office_key !== slug);
    await loadFixture(db, input(1, second), { now: LATER });
    expect((await office(slug)).retired_at).not.toBeNull();

    const { bundleId, result } = await loadFixture(db, input(2, files), {
      now: new Date('2027-01-17T06:00:00Z'),
    });
    expect(result.status).toBe('loaded');
    const back = await office(slug);
    expect(back.retired_at).toBeNull();
    const update = (await changesOf(bundleId)).find(
      (change) => change.table_name === 'offices' && change.row_key.id === back.id,
    );
    expect(update?.op).toBe('update');
    expect(update?.before?.retired_at).not.toBeNull();
    expect(
      await query(sql`select 1 from office_powers where office_id = ${back.id}::uuid`),
    ).toHaveLength(1);
  });

  it('manual edits survive', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const admin = newId();
    const at = NOW.toISOString();
    await db.execute(
      sql`update offices set title = 'Fixture Corrected Title',
            overrides = jsonb_build_object('title', jsonb_build_object('value', 'Fixture Corrected Title',
              'suppressed', false, 'by', ${admin}::text, 'role', 'admin', 'at', ${at}::text))
          where slug = ${officeSlug(1)}`,
    );
    await db.execute(
      sql`update people set website = 'https://example.test/fixture-own-site',
            overrides = jsonb_build_object('website', jsonb_build_object('value', 'https://example.test/fixture-own-site',
              'suppressed', false, 'by', ${admin}::text, 'role', 'admin', 'at', ${at}::text))
          where slug = 'fixture-holder-001'`,
    );
    const owner = await insertUser(db);
    await db.execute(
      sql`update people set claimed_by = ${owner.id}::uuid,
            donate_url = 'https://example.test/fixture-donate',
            volunteer_url = 'https://example.test/fixture-volunteer',
            pending_links = jsonb_build_object('website', null, 'donate_url', null, 'volunteer_url', null, 'requested_at', ${at}::text),
            photo_pending_key = ${`people/${newId()}/${newId()}/320.jpg`}
          where slug = 'fixture-holder-002'`,
    );
    const ownerColumns = sql`select claimed_by, donate_url, volunteer_url, pending_links, photo_pending_key
      from people where slug = 'fixture-holder-002'`;
    const ownedBefore = await query(ownerColumns);

    const { result } = await loadFixture(db, input(1, files), { now: LATER });
    expect(result.status).toBe('loaded');
    expect((await office(officeSlug(1))).title).toBe('Fixture Corrected Title');
    const [person] = await query<{ website: string }>(
      sql`select website from people where slug = 'fixture-holder-001'`,
    );
    expect(person?.website).toBe('https://example.test/fixture-own-site');
    expect(await query(ownerColumns)).toEqual(ownedBefore);
    expect((ownedBefore[0] as { claimed_by: string }).claimed_by).toBe(owner.id);
  });

  it('a merged person writes to its survivor', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const keyOf = (slug: string): string => {
      const found = rowsOf(files, 'people').find((row) => row.slug === slug);
      return String(found?.source_key);
    };
    const keyA = keyOf('fixture-holder-002');
    const keyB = keyOf('fixture-holder-001');
    const idA = civicId('people', keyA);
    const idB = civicId('people', keyB);
    await db.execute(
      sql`update people set merged_into = ${idA}::uuid, retired_at = ${NOW.toISOString()}::timestamptz where id = ${idB}::uuid`,
    );
    const [bBefore] = await query(sql`select * from people where id = ${idB}::uuid`);

    const second = structuredClone(files);
    second.people = rowsOf(second, 'people').filter((row) => row.source_key !== keyA);
    second.person_aliases = rowsOf(second, 'person_aliases').filter(
      (row) => row.person_key !== keyA,
    );
    second.officeholders = rowsOf(second, 'officeholders').filter((row) => row.person_key !== keyA);
    const { result } = await loadFixture(db, input(1, second), { now: LATER });
    expect(result.status).toBe('loaded');

    const [a] = await query<{
      name: string;
      slug: string;
      source_key: string;
      retired_at: Date | null;
    }>(sql`select name, slug, source_key, retired_at from people where id = ${idA}::uuid`);
    expect(a).toEqual({
      name: 'Fixture Holder 001',
      slug: 'fixture-holder-002',
      source_key: keyA,
      retired_at: null,
    });
    expect(await query(sql`select * from people where id = ${idB}::uuid`)).toEqual([bBefore]);
    const holders = await query<{ person_id: string }>(
      sql`select h.person_id from officeholders h join offices o on o.id = h.office_id where o.slug = ${officeSlug(1)}`,
    );
    expect(holders.map((row) => row.person_id)).toEqual([idA]);
  });

  it('changed offices are marked', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    await db.execute(
      sql`update offices set title = 'Fixture Corrected Title',
            overrides = jsonb_build_object('title', jsonb_build_object('value', 'Fixture Corrected Title',
              'suppressed', false, 'by', ${newId()}::text, 'role', 'admin', 'at', ${NOW.toISOString()}::text))
          where slug = ${officeSlug(2)}`,
    );
    const second = structuredClone(files);
    const retitled = rowsOf(second, 'offices').find((row) => row.source_key === officeSlug(1));
    if (retitled === undefined) {
      throw new Error('No office 1.');
    }
    retitled.title = 'Fixture Renamed Seat';
    const election = rowsOf(second, 'elections').find((row) => row.office_key === officeSlug(3));
    const track = rowsOf(second, 'filing_tracks').find(
      (row) => row.election_key === election?.source_key,
    );
    if (track === undefined) {
      throw new Error('No track of office 3.');
    }
    track.closes_on = shiftDay(track.closes_on, -3);
    const { result } = await loadFixture(db, input(1, second), { now: LATER });
    expect(result.status).toBe('loaded');

    const one = await office(officeSlug(1));
    expect(one.changed_at).toBe(LATER.toISOString());
    expect(one.updated_at).toBe(LATER.toISOString());
    expect((await office(officeSlug(2))).changed_at).toBe(NOW.toISOString());
    const three = await office(officeSlug(3));
    expect(three.changed_at).toBe(LATER.toISOString());
    expect(three.updated_at).toBe(LATER.toISOString());
    const four = await office(officeSlug(4));
    expect(four.changed_at).toBe(NOW.toISOString());
    expect(four.updated_at).toBe(NOW.toISOString());
  });

  it('headline deadline follows the tracks', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const second = structuredClone(files);
    const track = rowsOf(second, 'filing_tracks')[0];
    if (track === undefined) {
      throw new Error('No track.');
    }
    const moved = shiftDay(track.closes_on, -5);
    track.closes_on = moved;
    const { result } = await loadFixture(db, input(1, second), { now: LATER });
    expect(result.status).toBe('loaded');
    const [election] = await query<{ filing_deadline: string; deadline_basis: string }>(
      sql`select filing_deadline::text, deadline_basis from elections where source_key = ${String(track.election_key)}`,
    );
    expect(election).toEqual({ filing_deadline: moved, deadline_basis: 'computed' });
  });

  it('search follows the title', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const second = structuredClone(files);
    const renamed = rowsOf(second, 'offices')[0];
    if (renamed === undefined) {
      throw new Error('No office.');
    }
    renamed.title = 'Fixture Lighthouse Keeper';
    await loadFixture(db, input(1, second), { now: LATER });
    const found = await query<{ slug: string }>(
      sql`select slug from offices where search @@ to_tsquery('english', 'lighthouse')`,
    );
    expect(found.map((row) => row.slug)).toEqual([renamed.slug]);
  });

  it('districts gone stale', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const near = await insertUser(db);
    const far = await insertUser(db);
    await setUserDistricts(db, near.id, [civicId('districts', ALDER_DISTRICT)]);
    await setUserDistricts(db, far.id, [civicId('districts', BIRCH_DISTRICT)]);

    const geometry = zzGeometry({ version: fixtureVersion('2027-01-10T00:00:00Z', 'geometry') });
    const moved = squareWkbHex(-41, 29.5, -40, 31.5);
    const hash = sha256Hex(moved);
    const row = geometry.states.ZZ?.find((candidate) => candidate.source_key === ALDER_DISTRICT);
    if (row === undefined) {
      throw new Error('No alder row.');
    }
    Object.assign(row, { lookup_wkb: moved, display_wkb: moved, geom_hash: hash });
    const second = structuredClone(files);
    const district = rowsOf(second, 'districts').find(
      (candidate) => candidate.source_key === ALDER_DISTRICT,
    );
    if (district === undefined) {
      throw new Error('No alder district.');
    }
    district.geom_hash = hash;
    const { result } = await loadFixture(
      db,
      { version: version(1), files: second, geometry },
      { now: LATER },
    );
    expect(result.status).toBe('loaded');
    const stale = await query<{ id: string; districts_stale_at: string | null }>(
      sql`select id, ${iso('districts_stale_at')} as districts_stale_at from users
          where id in (${near.id}::uuid, ${far.id}::uuid)`,
    );
    const byId = new Map(stale.map((user) => [user.id, user.districts_stale_at]));
    expect(byId.get(near.id)).toBe(LATER.toISOString());
    expect(byId.get(far.id)).toBeNull();
    const [stored] = await query<{ geom_hash: string }>(
      sql`select geom_hash from districts where source_key = ${ALDER_DISTRICT}`,
    );
    expect(stored?.geom_hash).toBe(hash);
  });

  it('assets are copied', async () => {
    const db = getTestDb();
    const photo = await zzPhotoJpeg();
    const sha = sha256(photo);
    const key = `civic/photos/${sha}.jpg`;
    const files = zzBundle({ today: TODAY, photoSha: sha });
    const first: FixtureBundleInput = {
      ...input(0, files),
      assets: [{ kind: 'photo', bytes: photo }],
    };
    const { result } = await loadFixture(db, first, { now: NOW });
    expect(result.status).toBe('loaded');

    const stored = await getTestObject('media', key);
    if (stored === null) {
      throw new Error('The photo was not copied.');
    }
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([320, 400]);
    expect(meta.exif).toBeUndefined();
    const person = sql`select photo_key, photo_width, photo_height, photo_credit, photo_license, photo_source_url
      from people where slug = 'fixture-holder-001'`;
    expect(await query(person)).toEqual([
      {
        photo_key: key,
        photo_width: 320,
        photo_height: 400,
        photo_credit: 'Fixture photo',
        photo_license: 'CC0-1.0',
        photo_source_url: 'https://example.test/fixture-photo',
      },
    ]);

    // A different image under the same key: a second load must neither read nor write it.
    const other = new Uint8Array(
      await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .jpeg()
        .toBuffer(),
    );
    await putTestObject('media', key, other, 'image/jpeg');
    const { client, bucket } = await getTestBucket('media');
    const head = async () =>
      (await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).LastModified;
    const modified = await head();
    const again = await loadFixture(
      db,
      { ...input(1, files), assets: [{ kind: 'photo', bytes: photo }] },
      { now: LATER },
    );
    expect(again.result.status).toBe('loaded');
    expect(await head()).toEqual(modified);
    expect(await getTestObject('media', key)).toEqual(other);
    expect(await query(person)).toEqual([
      expect.objectContaining({ photo_key: key, photo_width: 320, photo_height: 400 }),
    ]);
  });

  it('a failure inside the upsert changes nothing', async () => {
    const db = getTestDb();
    const before = await snapshotCivic(db);
    const fixture = input(0);
    const { manifestKey } = await writeFixtureBundle(fixture);
    const bundleId = await db.transaction((tx) =>
      insertLoadingBundle(tx, { version: fixture.version, kind: 'full' }),
    );
    if (bundleId === null) {
      throw new Error('No bundle row.');
    }
    await db.execute(
      sql`create function fixture_raise() returns trigger language plpgsql as $$ begin raise exception 'fixture failure'; end $$`,
    );
    await db.execute(
      sql`create trigger fixture_raise before insert on people for each row execute function fixture_raise()`,
    );
    try {
      await expect(
        loadBundle(db, bucketReader(testDataBucketClient(), manifestKey), 'manifest.json', {
          bundleId,
          approved: false,
          now: NOW,
          enqueue: () => Promise.reject(new Error('No job is enqueued before the upsert commits.')),
          media: createMediaAssetWriter(testMediaStore()),
        }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger fixture_raise on people`);
      await db.execute(sql`drop function fixture_raise()`);
    }
    expect(await snapshotCivic(db)).toEqual(before);
    expect(await count('bundle_changes')).toBe(0);
    const [bundle] = await query<{ status: string }>(
      sql`select status from data_bundles where id = ${bundleId}::uuid`,
    );
    expect(bundle?.status).toBe('loading');
  });

  it('geometry follows the hash', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadFixture(db, input(0, files), { now: NOW });
    const partsOf = async () =>
      query<{ source_key: string; ids: string; geom_hash: string }>(
        sql`select d.source_key, d.geom_hash, coalesce(string_agg(p.id::text, ',' order by p.id), '') as ids
            from districts d left join district_parts p on p.district_id = d.id
            group by d.source_key, d.geom_hash order by d.source_key`,
      );
    const first = await partsOf();

    // The same geometry version stages nothing and touches no district.
    await loadFixture(db, input(1, files), { now: LATER });
    expect(await partsOf()).toEqual(first);

    // A new version in which the Birch square becomes a 600-point ring.
    const ring: [number, number][] = Array.from({ length: 600 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 600;
      return [-39.5 + 0.4 * Math.cos(angle), 30 + 0.4 * Math.sin(angle)];
    });
    const wkb = ringWkbHex(ring);
    const hash = sha256Hex(wkb);
    const geometry = zzGeometry({ version: fixtureVersion('2027-01-10T00:00:00Z', 'geometry') });
    const row = geometry.states.ZZ?.find((candidate) => candidate.source_key === BIRCH_DISTRICT);
    if (row === undefined) {
      throw new Error('No birch row.');
    }
    Object.assign(row, { lookup_wkb: wkb, display_wkb: wkb, geom_hash: hash });
    geometry.zip = [
      { source_key: zctaKey('99001'), zip: '99001', state: 'ZZ', lng: -40.6, lat: 30.1 },
    ];
    const third = structuredClone(files);
    const district = rowsOf(third, 'districts').find(
      (candidate) => candidate.source_key === BIRCH_DISTRICT,
    );
    if (district === undefined) {
      throw new Error('No birch district.');
    }
    district.geom_hash = hash;
    const { result } = await loadFixture(
      db,
      { version: version(2), files: third, geometry },
      { now: LATER },
    );
    expect(result.status).toBe('loaded');

    const after = await partsOf();
    for (const before of first) {
      const now = after.find((candidate) => candidate.source_key === before.source_key);
      if (before.source_key === BIRCH_DISTRICT) {
        expect(now?.geom_hash).toBe(hash);
        expect(now?.ids).not.toBe(before.ids);
        expect(now?.ids.split(',').length).toBeGreaterThan(1);
      } else {
        expect(now).toEqual(before);
      }
    }
    const birchId = civicId('districts', BIRCH_DISTRICT);
    const [vertices] = await query<{ n: number }>(
      sql`select max(st_npoints(geom))::int as n from district_parts where district_id = ${birchId}::uuid`,
    );
    expect(vertices?.n).toBeLessThanOrEqual(129);
    const display = await query<{ srid: number; points: number }>(
      sql`select st_srid(geom) as srid, st_npoints(geom) as points from district_display
          where district_id = ${birchId}::uuid and zoom_band = 3`,
    );
    expect(display).toEqual([{ srid: 3857, points: 601 }]);
    const [zip] = await query<{ lng: number; lat: number }>(
      sql`select st_x(point) as lng, st_y(point) as lat from zip_centroids where zip = '99001'`,
    );
    expect(zip).toEqual({ lng: -40.6, lat: 30.1 });
    expect(await count('zip_centroids')).toBe(1);
  });

  it('approval skips the holds', async () => {
    const db = getTestDb();
    const entry = HOLD_FAULTS.find((candidate) => candidate.label === 'offices-over');
    if (entry === undefined) {
      throw new Error('No offices-over entry.');
    }
    const files = entry.first(TODAY);
    await loadFixture(db, input(0, files), { now: NOW });
    const changed = entry.build(input(1, files), files);
    const held = await loadFixture(db, changed, { now: LATER });
    expect(held.result.status).toBe('held');
    const approved = await loadFixture(db, entry.build(input(2, files), files), {
      now: LATER,
      approved: true,
    });
    expect(approved.result.status).toBe('loaded');
    expect(approved.result.stats.holds).toEqual([]);
  });

  it('stats', async () => {
    const db = getTestDb();
    const fixture = input(0);
    const { bundleId, result } = await loadFixture(db, fixture, { now: NOW });
    const [row] = await query<{ stats: unknown }>(
      sql`select stats from data_bundles where id = ${bundleId}::uuid`,
    );
    const stats = BundleStatsSchema.parse(row?.stats);
    expect(stats).toEqual(result.stats);
    expect(Object.keys(stats.datasets['census-gus'] ?? {}).sort()).toEqual([
      'downloaded_on',
      'edition',
    ]);
    expect(typeof stats.schema_version).toBe('number');
    expect(stats.geometry_version).toBe(fixture.geometry?.version);
    expect(stats.notices).toEqual({ deadline_changed: 0, new_candidacies: 0 });
    expect(stats.gates.every((gate) => gate.passed)).toBe(true);
    expect(stats.holds).toEqual([]);
  });

  it('a failed asset copy rejects at the assets gate', async () => {
    const db = getTestDb();
    const photo = await zzPhotoJpeg();
    const sha = sha256(photo);
    const fixture: FixtureBundleInput = {
      ...input(0, zzBundle({ today: TODAY, photoSha: sha })),
      assets: [{ kind: 'photo', bytes: photo }],
    };
    const before = await snapshotCivic(db);
    const { manifestKey } = await writeFixtureBundle(fixture);
    const bundleId = await db.transaction((tx) =>
      insertLoadingBundle(tx, { version: fixture.version, kind: 'full' }),
    );
    if (bundleId === null) {
      throw new Error('No bundle row.');
    }
    const store = testMediaStore();
    const result = await loadBundle(
      db,
      bucketReader(testDataBucketClient(), manifestKey),
      'manifest.json',
      {
        bundleId,
        approved: false,
        now: NOW,
        enqueue: () => Promise.reject(new Error('No job is enqueued for a rejected bundle.')),
        media: createMediaAssetWriter({
          ...store,
          put: () => Promise.reject(new Error('fixture store failure')),
        }),
      },
    );
    expect(result.status).toBe('rejected');
    const failed = result.stats.gates.filter((gate) => !gate.passed);
    expect(failed).toEqual([{ name: 'assets', passed: false, detail: `photo ${sha}` }]);
    expect(result.stats.gates.filter((gate) => gate.name === 'assets')).toHaveLength(1);
    const [row] = await query<{ status: string; stats: unknown }>(
      sql`select status, stats from data_bundles where id = ${bundleId}::uuid`,
    );
    expect(row?.status).toBe('rejected');
    expect(BundleStatsSchema.parse(row?.stats)).toEqual(result.stats);
    expect(await snapshotCivic(db)).toEqual(before);
    const [staged] = await query<{ n: number }>(
      sql`select (select count(*) from staging.bundle_rows)::int + (select count(*) from staging.district_geometry)::int as n`,
    );
    expect(staged?.n).toBe(0);
  });

  it('inserts the loading row once per version and records a job-level rejection', async () => {
    const db = getTestDb();
    const version = fixtureVersion('2027-01-15T07:00:00Z', 'full');
    const first = await db.transaction((tx) => insertLoadingBundle(tx, { version, kind: 'full' }));
    expect(first).not.toBeNull();
    expect(
      await db.transaction((tx) => insertLoadingBundle(tx, { version, kind: 'full' })),
    ).toBeNull();
    if (first === null) {
      throw new Error('No bundle row.');
    }
    await markBundleRejected(db, first, 'superseded', null);
    await markBundleRejected(db, first, 'load_error', 'Error');
    const [row] = await query<{ status: string; stats: unknown }>(
      sql`select status, stats from data_bundles where id = ${first}::uuid`,
    );
    expect(row?.status).toBe('rejected');
    const stats = BundleStatsSchema.parse(row?.stats);
    expect(stats.gates).toEqual([
      { name: 'superseded', passed: false, detail: null },
      { name: 'load_error', passed: false, detail: 'Error' },
    ]);
    expect(stats.counts).toEqual({});
  });
});
