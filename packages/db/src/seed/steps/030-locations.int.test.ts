import { createLogger } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../client.ts';
import { createEnqueue } from '../../queue/enqueue.ts';
import { lookupDistrictsAtPoint } from '../../sql/point-lookup.ts';
import {
  captureLogs,
  createTestBoss,
  getTestBucket,
  getTestDb,
  resetStorage,
} from '../../testing/index.ts';
import { SEED_USER_IDS } from '../ids.ts';
import type { SeedUserKey } from '../ids.ts';
import { runSeed } from '../index.ts';
import { FIELD_REPORT_LINK, FIELD_REPORT_MESSAGE } from './030-locations.ts';

// TEST-seed-locations: runSeed with steps 000 to 030 on the committed sample.

const NOW = new Date('2027-03-05T12:00:30.000Z');
const ANCHOR = new Date('2027-03-05T12:00:00.000Z');
const SEED_TIMEOUT_MS = 300_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function key(n: number): SeedUserKey {
  return String(n).padStart(2, '0') as SeedUserKey;
}

async function seed(now: Date = NOW): Promise<void> {
  const capture = captureLogs();
  await runSeed(getTestDb(), {
    appEnv: 'local',
    allowStaging: false,
    now,
    media: await getTestBucket('media'),
    enqueue: createEnqueue(await createTestBoss()),
    log: createLogger({ service: 'api', level: 'info', sink: capture.sink }),
  });
}

async function rows<T extends Record<string, unknown>>(
  db: Db,
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return db.execute<T>(query, 'objects');
}

/** The eight points, recomputed here from the loaded bundle with the step's queries. */
async function points(db: Db): Promise<{ lng: number; lat: number }[]> {
  const out: { lng: number; lat: number }[] = [];
  for (const geoid of ['37063', '37135', '53067', '53045']) {
    const [county] = await rows<{ id: string; lng: number; lat: number }>(
      db,
      sql`select id, st_x(label_point) as lng, st_y(label_point) as lat from districts
          where source_key = ${`tiger:county:${geoid}`} and retired_at is null`,
    );
    expect(county, geoid).toBeDefined();
    if (county === undefined) continue;
    out.push({ lng: county.lng, lat: county.lat });
    const [city] = await rows<{ lng: number; lat: number }>(
      db,
      sql`select st_x(d.label_point) as lng, st_y(d.label_point) as lat
          from jurisdictions j
          join districts d on d.jurisdiction_id = j.id and d.geometry_quality = 'exact'
            and d.retired_at is null
          where j.kind = 'city' and j.retired_at is null and d.label_point is not null
            and exists (select 1 from district_parts p
                        where p.district_id = ${county.id}::uuid and st_covers(p.geom, d.label_point))
          order by j.population desc nulls last, j.source_key collate "C" limit 1`,
    );
    expect(city, `${geoid} municipality`).toBeDefined();
    if (city !== undefined) out.push({ lng: city.lng, lat: city.lat });
  }
  return out;
}

async function districtsOf(db: Db, user: string): Promise<string[]> {
  return (
    await rows<{ id: string }>(
      db,
      sql`select district_id::text as id from user_districts where user_id = ${user}::uuid order by 1`,
    )
  ).map((row) => row.id);
}

async function officeOrder(db: Db, districtIds: readonly string[]): Promise<string[]> {
  return (
    await rows<{ id: string }>(
      db,
      sql`select o.id::text as id from offices o
          where o.retired_at is null and o.district_id = any(${`{${districtIds.join(',')}}`}::uuid[])
          order by o.slug collate "C"`,
    )
  ).map((row) => row.id);
}

async function counts(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of ['user_districts', 'follows', 'bookmarks', 'field_reports']) {
    const [row] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    );
    out[table] = row?.n ?? -1;
  }
  return out;
}

beforeEach(async () => {
  await resetStorage();
  captureLogs().clear();
});

describe('030-locations', () => {
  it('forty users are located from the bundle', { timeout: SEED_TIMEOUT_MS }, async () => {
    await seed();
    const db = getTestDb();
    const eight = await points(db);
    expect(eight).toHaveLength(8);
    for (let n = 1; n <= 40; n += 1) {
      const user = SEED_USER_IDS[key(n)];
      const point = eight[(n - 1) % 8];
      if (point === undefined) throw new Error('no point');
      const expected = (await lookupDistrictsAtPoint(db, point)).map((row) => row.id).sort();
      expect(expected.length, key(n)).toBeGreaterThan(0);
      expect(await districtsOf(db, user), key(n)).toEqual(expected);
      const [row] = await rows<{ precision: string | null; stale: string | null }>(
        db,
        sql`select location_precision as precision, districts_stale_at::text as stale
            from users where id = ${user}::uuid`,
      );
      expect(row?.precision).toBe('exact');
      expect(row?.stale).toBeNull();
    }
    const [dated] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from user_districts
          where created_at <> ${new Date(ANCHOR.getTime() - DAY_MS).toISOString()}::timestamptz`,
    );
    expect(dated?.n).toBe(0);
    const unlocated = [
      ...Array.from({ length: 9 }, (_, i) => SEED_USER_IDS[key(41 + i)]),
      SEED_USER_IDS.admin,
    ];
    for (const user of unlocated) {
      expect(await districtsOf(db, user)).toEqual([]);
      const [row] = await rows<{ precision: string | null }>(
        db,
        sql`select location_precision as precision from users where id = ${user}::uuid`,
      );
      expect(row?.precision).toBeNull();
    }
  });

  it('follows and bookmarks follow slug order', { timeout: SEED_TIMEOUT_MS }, async () => {
    await seed();
    const db = getTestDb();
    for (let n = 1; n <= 40; n += 1) {
      const user = SEED_USER_IDS[key(n)];
      const order = await officeOrder(db, await districtsOf(db, user));
      const follows = await rows<{ id: string; created: Date }>(
        db,
        sql`select target_id::text as id, created_at as created from follows
            where follower_id = ${user}::uuid and target_type = 'office' order by created_at`,
      );
      expect(
        follows.map((row) => row.id),
        key(n),
      ).toEqual(order.slice(0, 3));
      follows.forEach((row, j) => {
        expect(new Date(row.created).getTime()).toBe(
          ANCHOR.getTime() - DAY_MS + (n * 60 + j) * 1000,
        );
      });
      const bookmarks = await rows<{ id: string; created: Date }>(
        db,
        sql`select office_id::text as id, created_at as created from bookmarks
            where user_id = ${user}::uuid order by created_at`,
      );
      expect(
        bookmarks.map((row) => row.id),
        key(n),
      ).toEqual(order.slice(3, 5));
      bookmarks.forEach((row, j) => {
        expect(new Date(row.created).getTime()).toBe(
          ANCHOR.getTime() - DAY_MS + (n * 60 + 10 + j) * 1000,
        );
      });
    }
    const durham = (
      await rows<{ id: string }>(
        db,
        sql`select o.id::text as id from offices o
            join districts d on d.source_key = 'tiger:county:37063'
            where o.retired_at is null and o.jurisdiction_id = d.jurisdiction_id
            order by o.slug collate "C" limit 2`,
      )
    ).map((row) => row.id);
    expect(durham).toHaveLength(2);
    for (let n = 41; n <= 45; n += 1) {
      const follows = await rows<{ id: string }>(
        db,
        sql`select target_id::text as id from follows
            where follower_id = ${SEED_USER_IDS[key(n)]}::uuid and target_type = 'office'
            order by created_at`,
      );
      expect(
        follows.map((row) => row.id),
        key(n),
      ).toEqual(durham);
    }
    for (let n = 46; n <= 49; n += 1) {
      const follows = await rows<{ n: number }>(
        db,
        sql`select count(*)::int as n from follows where follower_id = ${SEED_USER_IDS[key(n)]}::uuid`,
      );
      expect(follows[0]?.n).toBe(0);
    }
  });

  it('two open field reports', { timeout: SEED_TIMEOUT_MS }, async () => {
    await seed();
    const db = getTestDb();
    const reports = await rows<{
      user_id: string;
      office_id: string;
      field: string | null;
      message: string;
      source_url: string;
      status: string;
      created: Date;
    }>(
      db,
      sql`select user_id::text, office_id::text, field, message, source_url, status,
                 created_at as created
          from field_reports order by created_at`,
    );
    expect(reports).toHaveLength(2);
    for (const [i, n] of [1, 2].entries()) {
      const report = reports[i];
      const user = SEED_USER_IDS[key(n)];
      const [first] = await rows<{ id: string }>(
        db,
        sql`select target_id::text as id from follows
            where follower_id = ${user}::uuid and target_type = 'office'
            order by created_at limit 1`,
      );
      expect(report).toEqual(
        expect.objectContaining({
          user_id: user,
          office_id: first?.id,
          field: null,
          message: FIELD_REPORT_MESSAGE,
          source_url: FIELD_REPORT_LINK,
          status: 'open',
        }),
      );
      expect(new Date(report?.created ?? 0).getTime()).toBe(
        ANCHOR.getTime() - (3 - n) * 60 * 60 * 1000,
      );
    }
  });

  it('idempotent across anchors', { timeout: SEED_TIMEOUT_MS }, async () => {
    await seed();
    const db = getTestDb();
    const first = await counts(db);
    expect(first['field_reports']).toBe(2);
    expect(first['bookmarks']).toBe(80);
    expect(first['follows']).toBe(40 * 3 + 5 * 2);
    await seed(new Date(NOW.getTime() + DAY_MS));
    expect(await counts(db)).toEqual(first);
    // The second run's rows are dated from its own anchor, one day later.
    const [dated] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from user_districts where created_at <> ${ANCHOR.toISOString()}::timestamptz`,
    );
    expect(dated?.n).toBe(0);
  });

  it('no coordinate is stored or logged', { timeout: SEED_TIMEOUT_MS }, async () => {
    await seed();
    const lines = captureLogs().lines;
    const located = lines.filter((line) => line.parsed['event'] === 'seed.locations');
    expect(located).toHaveLength(1);
    expect(located[0]?.parsed).toEqual(
      expect.objectContaining({ locatedUsers: 40, fieldReports: 2 }),
    );
    for (const line of lines) {
      expect(line.raw).not.toMatch(/\d\.\d{4,}/);
      expect(line.raw).not.toMatch(/"(lat|lng|latitude|longitude|point)"/);
    }
    const columns = await rows<{ table_name: string; column_name: string }>(
      getTestDb(),
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'public' and table_name in ('users', 'user_districts')
            and (data_type in ('double precision', 'real', 'numeric')
                 or udt_name in ('geometry', 'geography', 'point'))`,
    );
    expect(columns).toEqual([]);
  });
});
