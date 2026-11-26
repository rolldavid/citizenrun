import type { Db, Tx } from '@citizenrun/db';
import { roundHalfAwayFromZero } from '@citizenrun/shared';
import type { Level, LocationState, ViewerDistrict } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';

// Coordinates leave the API at six decimals (about 0.1 metre).
const COORDINATE_DECIMALS = 6;

// The reveal's tie order (ViewerDistrict): local, county, special, state, federal.
const LEVEL_ORDER: Readonly<Record<Level, number>> = {
  local: 0,
  county: 1,
  special: 2,
  state: 3,
  federal: 4,
};

function sixDecimals(value: number): number {
  return roundHalfAwayFromZero(value, COORDINATE_DECIMALS);
}

/** Live, non-placeholder offices of the given exact districts (E-ME-13 step 7). */
export async function countOfficesInDistricts(
  db: Db | Tx,
  exactIds: readonly string[],
): Promise<number> {
  if (exactIds.length === 0) {
    return 0;
  }
  // index: offices_district
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from offices
        where district_id = any(${sql.param([...exactIds])}::uuid[])
          and retired_at is null and not placeholder`,
    'objects',
  );
  return rows[0]?.n ?? 0;
}

type ViewerDistrictRow = {
  id: string;
  tile_id: number | string;
  name: string;
  level: Level;
  geometry_quality: ViewerDistrict['district']['geometryQuality'];
  outline_svg: string | null;
  outline_bbox: number[] | null;
  label_x: number | null;
  label_y: number | null;
};

function outlineOf(row: ViewerDistrictRow): ViewerDistrict['outline'] {
  const bbox = row.outline_bbox;
  if (row.outline_svg === null || bbox === null) {
    return null;
  }
  const [minX, minY, maxX, maxY] = bbox;
  if (minX === undefined || minY === undefined || maxX === undefined || maxY === undefined) {
    return null;
  }
  return { svg: row.outline_svg, bbox: [minX, minY, maxX, maxY] };
}

function compareNames(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** ViewerDistrict of each id: exact districts first, then by level local, county, special, state, federal, then name, then id. */
export async function viewerDistricts(
  db: Db | Tx,
  ids: readonly string[],
): Promise<ViewerDistrict[]> {
  if (ids.length === 0) {
    return [];
  }
  // Geometry never leaves SQL beyond the label point's two numbers (D-235). index: districts_pkey
  const rows = await db.execute<ViewerDistrictRow>(
    sql`select d.id, d.tile_id, d.name, d.level, d.geometry_quality, d.outline_svg, d.outline_bbox,
               st_x(d.label_point) as label_x, st_y(d.label_point) as label_y
        from districts d
        where d.id = any(${sql.param([...ids])}::uuid[])`,
    'objects',
  );
  const districts = rows.map((row): ViewerDistrict => {
    const approximate = row.geometry_quality !== 'exact';
    return {
      district: {
        id: row.id,
        tileId: Number(row.tile_id),
        name: row.name,
        level: row.level,
        geometryQuality: row.geometry_quality,
      },
      approximate,
      outline: outlineOf(row),
      labelPoint:
        row.label_x === null || row.label_y === null
          ? null
          : [sixDecimals(row.label_x), sixDecimals(row.label_y)],
    };
  });
  return districts.sort(
    (a, b) =>
      Number(a.approximate) - Number(b.approximate) ||
      LEVEL_ORDER[a.district.level] - LEVEL_ORDER[b.district.level] ||
      compareNames(a.district.name, b.district.name) ||
      compareNames(a.district.id, b.district.id),
  );
}

/** Me.location of one user (E-ME-01 step 3, D-529). */
export async function loadLocationState(
  db: Db | Tx,
  input: {
    userId: string;
    locationPrecision: 'exact' | 'approx' | null;
    districtsStaleAt: Date | null;
  },
): Promise<LocationState> {
  const { userId } = input;
  // index: user_districts_pkey
  const counted = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from user_districts where user_id = ${userId}`,
    'objects',
  );
  const districtCount = counted[0]?.n ?? 0;
  if (districtCount === 0) {
    return {
      isSet: false,
      precision: input.locationPrecision,
      districtCount: 0,
      bbox: null,
      placeName: null,
      officeCount: 0,
      needsConfirmation: input.districtsStaleAt !== null,
    };
  }
  // Geometry never leaves SQL beyond the four numbers of the extent (D-235). index: user_districts_pkey
  const extent = await db.execute<{
    west: number | null;
    south: number | null;
    east: number | null;
    north: number | null;
  }>(
    sql`select st_xmin(e) as west, st_ymin(e) as south, st_xmax(e) as east, st_ymax(e) as north
        from (select st_extent(d.geom) as e
              from user_districts ud
              join districts d on d.id = ud.district_id
              where ud.user_id = ${userId} and d.geom is not null) x`,
    'objects',
  );
  const box = extent[0];
  const bbox: LocationState['bbox'] =
    box === undefined ||
    box.west === null ||
    box.south === null ||
    box.east === null ||
    box.north === null
      ? null
      : [
          sixDecimals(box.west),
          sixDecimals(box.south),
          sixDecimals(box.east),
          sixDecimals(box.north),
        ];
  // index: user_districts_pkey
  const place = await db.execute<{ name: string }>(
    sql`select j.name
        from user_districts ud
        join districts d on d.id = ud.district_id
        join jurisdictions j on j.id = d.jurisdiction_id
        where ud.user_id = ${userId}
          and d.geometry_quality = 'exact'
          and d.retired_at is null
          and d.level in ('local', 'county')
        order by (d.level = 'local') desc, st_area(d.geom) asc nulls last, d.id
        limit 1`,
    'objects',
  );
  // index: user_districts_pkey
  const exactRows = await db.execute<{ id: string }>(
    sql`select d.id
        from user_districts ud
        join districts d on d.id = ud.district_id
        where ud.user_id = ${userId} and d.geometry_quality = 'exact'`,
    'objects',
  );
  return {
    isSet: true,
    precision: input.locationPrecision,
    districtCount,
    bbox,
    placeName: place[0]?.name ?? null,
    officeCount: await countOfficesInDistricts(
      db,
      exactRows.map((row) => row.id),
    ),
    needsConfirmation: input.districtsStaleAt !== null,
  };
}
