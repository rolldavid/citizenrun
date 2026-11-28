import { sql } from 'drizzle-orm';
import type { Tx } from '../../client.ts';
import { lookupDistrictsAtPoint } from '../../sql/point-lookup.ts';
import { SEED_USER_IDS, seedId } from '../ids.ts';
import type { SeedUserKey } from '../ids.ts';
import type { SeedContext, SeedStep } from '../index.ts';
import { SeedError } from '../step.ts';

// Seed step 030-locations (TEST-seed-locations): users 01 to 40 placed on eight
// points read from the loaded sample, with the districts the point lookup gives, office follows,
// bookmarks and two open field reports. No coordinate is stored or logged (INV-04).

/** The sample's four counties, in the order their points are taken. */
export const SEED_COUNTIES = ['37063', '37135', '53067', '53045'] as const;
/** The county whose offices users 41 to 45 follow. */
const DURHAM = '37063';
export const LOCATED_USERS = 40;
const FOLLOWS = 3;
const BOOKMARKS = 2;
const FOLLOWERS_WITHOUT_LOCATION = [41, 42, 43, 44, 45] as const;
const LOCATIONLESS_FOLLOWS = 2;
export const FIELD_REPORT_MESSAGE = 'Seed field report: the posted value looks out of date.';
export const FIELD_REPORT_LINK = 'https://example.test/seed-report';

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;

/** A point of the step: a district's label point, held in memory only. */
export type SeedPoint = { readonly lng: number; readonly lat: number };

function userKey(n: number): SeedUserKey {
  return String(n).padStart(2, '0') as SeedUserKey;
}

function userId(n: number): string {
  return SEED_USER_IDS[userKey(n)];
}

function at(anchor: Date, offsetMs: number): string {
  return new Date(anchor.getTime() + offsetMs).toISOString();
}

type PointRow = { id: string; lng: number; lat: number };

/** The county district of `geoid`, live, with its label point. */
async function countyPoint(tx: Tx, geoid: string): Promise<PointRow | undefined> {
  const [row] = await tx.execute<PointRow>(
    sql`select d.id, st_x(d.label_point) as lng, st_y(d.label_point) as lat
        from districts d
        where d.source_key = ${`tiger:county:${geoid}`} and d.retired_at is null
          and d.label_point is not null`,
    'objects',
  );
  return row;
}

/** The largest live city whose live exact district's label point the county's parts cover. */
async function municipalityPoint(tx: Tx, countyDistrictId: string): Promise<PointRow | undefined> {
  const [row] = await tx.execute<PointRow>(
    sql`select d.id, st_x(d.label_point) as lng, st_y(d.label_point) as lat
        from jurisdictions j
        join districts d on d.jurisdiction_id = j.id and d.geometry_quality = 'exact'
          and d.retired_at is null
        where j.kind = 'city' and j.retired_at is null and d.label_point is not null
          and exists (
            select 1 from district_parts p
            where p.district_id = ${countyDistrictId}::uuid and st_covers(p.geom, d.label_point)
          )
        order by j.population desc nulls last, j.source_key collate "C"
        limit 1`,
    'objects',
  );
  return row;
}

/**
 * The eight points in order: Durham County, its municipality, Orange County, its municipality,
 * Thurston County, its municipality, Mason County, its municipality. Throws SeedError naming the
 * missing point's number (1 to 8).
 */
export async function seedPoints(tx: Tx): Promise<SeedPoint[]> {
  const points: SeedPoint[] = [];
  for (const geoid of SEED_COUNTIES) {
    const county = await countyPoint(tx, geoid);
    if (county === undefined) {
      throw new SeedError(`sample point ${String(points.length + 1)} is missing`);
    }
    points.push({ lng: county.lng, lat: county.lat });
    const city = await municipalityPoint(tx, county.id);
    if (city === undefined) {
      throw new SeedError(`sample point ${String(points.length + 1)} is missing`);
    }
    points.push({ lng: city.lng, lat: city.lat });
  }
  return points;
}

/** The live offices of `districtIds`, distinct, by slug in byte order. */
async function officesOf(tx: Tx, districtIds: readonly string[]): Promise<string[]> {
  if (districtIds.length === 0) {
    return [];
  }
  const rows = await tx.execute<{ id: string }>(
    sql`select o.id from offices o
        where o.retired_at is null
          and o.district_id = any(${`{${districtIds.join(',')}}`}::uuid[])
        order by o.slug collate "C"`,
    'objects',
  );
  return rows.map((row) => row.id);
}

/** The first `limit` live offices of the jurisdiction of the county district, by slug. */
async function countyOffices(tx: Tx, geoid: string, limit: number): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(
    sql`select o.id from offices o
        join districts d on d.source_key = ${`tiger:county:${geoid}`} and d.retired_at is null
        where o.retired_at is null and o.jurisdiction_id = d.jurisdiction_id
        order by o.slug collate "C"
        limit ${limit}`,
    'objects',
  );
  return rows.map((row) => row.id);
}

async function seedLocations(tx: Tx, ctx: SeedContext): Promise<void> {
  const { anchor } = ctx;
  const ids = `{${Object.values(SEED_USER_IDS).join(',')}}`;

  // 1. What the step owns, for every seed user.
  await tx.execute(sql`delete from user_districts where user_id = any(${ids}::uuid[])`);
  await tx.execute(
    sql`delete from follows where follower_id = any(${ids}::uuid[]) and target_type = 'office'`,
  );
  await tx.execute(sql`delete from bookmarks where user_id = any(${ids}::uuid[])`);
  await tx.execute(sql`delete from field_reports where user_id = any(${ids}::uuid[])`);
  await tx.execute(
    sql`update users set location_precision = null, districts_stale_at = null
        where id = any(${ids}::uuid[])`,
  );

  // 2 to 5. The points, the located users, their follows and bookmarks.
  const points = await seedPoints(tx);
  const located = at(anchor, -DAY_MS);
  const firstFollowed = new Map<number, string>();
  let districtRows = 0;
  let follows = 0;
  let bookmarks = 0;
  for (let n = 1; n <= LOCATED_USERS; n += 1) {
    const point = points[(n - 1) % points.length];
    if (point === undefined) {
      throw new SeedError(`sample point ${String(((n - 1) % 8) + 1)} is missing`);
    }
    const user = userId(n);
    const districts = (await lookupDistrictsAtPoint(tx, point)).map((row) => row.id);
    for (const districtId of districts) {
      await tx.execute(
        sql`insert into user_districts (user_id, district_id, created_at)
            values (${user}::uuid, ${districtId}::uuid, ${located}::timestamptz)`,
      );
    }
    districtRows += districts.length;
    await tx.execute(
      sql`update users set location_precision = 'exact', districts_stale_at = null
          where id = ${user}::uuid`,
    );
    const offices = await officesOf(tx, districts);
    if (offices.length < FOLLOWS + BOOKMARKS) {
      throw new SeedError(`seed user ${userKey(n)} has fewer than five offices`);
    }
    for (let j = 0; j < FOLLOWS; j += 1) {
      await tx.execute(
        sql`insert into follows (follower_id, target_type, target_id, created_at)
            values (${user}::uuid, 'office', ${offices[j]}::uuid,
                    ${at(anchor, -DAY_MS + (n * 60 + j) * SECOND_MS)}::timestamptz)`,
      );
      follows += 1;
    }
    firstFollowed.set(n, offices[0] ?? '');
    for (let j = 0; j < BOOKMARKS; j += 1) {
      await tx.execute(
        sql`insert into bookmarks (user_id, office_id, created_at)
            values (${user}::uuid, ${offices[FOLLOWS + j]}::uuid,
                    ${at(anchor, -DAY_MS + (n * 60 + 10 + j) * SECOND_MS)}::timestamptz)`,
      );
      bookmarks += 1;
    }
  }

  // Users 41 to 45: the first two Durham County offices, with no location.
  const durham = await countyOffices(tx, DURHAM, LOCATIONLESS_FOLLOWS);
  if (durham.length < LOCATIONLESS_FOLLOWS) {
    throw new SeedError('the sample has fewer than two Durham County offices');
  }
  for (const n of FOLLOWERS_WITHOUT_LOCATION) {
    for (let j = 0; j < LOCATIONLESS_FOLLOWS; j += 1) {
      await tx.execute(
        sql`insert into follows (follower_id, target_type, target_id, created_at)
            values (${userId(n)}::uuid, 'office', ${durham[j]}::uuid,
                    ${at(anchor, -DAY_MS + (n * 60 + j) * SECOND_MS)}::timestamptz)`,
      );
      follows += 1;
    }
  }

  // 6. Two open field reports on the first followed office of users 01 and 02.
  let reports = 0;
  for (const n of [1, 2]) {
    const createdAt = new Date(anchor.getTime() - (3 - n) * HOUR_MS);
    await tx.execute(
      sql`insert into field_reports (id, user_id, office_id, field, message, source_url, status,
                                     created_at)
          values (${seedId('field-report', n, createdAt)}::uuid, ${userId(n)}::uuid,
                  ${firstFollowed.get(n) ?? ''}::uuid, null, ${FIELD_REPORT_MESSAGE},
                  ${FIELD_REPORT_LINK}, 'open', ${createdAt.toISOString()}::timestamptz)`,
    );
    reports += 1;
  }

  // 7. Counts only: never a point, a coordinate or a district id.
  ctx.log.info('seed.locations', {
    locatedUsers: LOCATED_USERS,
    userDistricts: districtRows,
    follows,
    bookmarks,
    fieldReports: reports,
  });
}

export const step: SeedStep = { name: '030-locations', run: seedLocations };
