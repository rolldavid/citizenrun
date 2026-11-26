import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../client.ts';

export type DistrictLevel = 'local' | 'county' | 'state' | 'federal' | 'special';
export type GeometryQuality = 'exact' | 'parent_fallback' | 'county_approx';
export type PointDistrictRow = {
  readonly id: string;
  readonly level: DistrictLevel;
  readonly geometryQuality: GeometryQuality;
  readonly approximate: boolean;
};

type LookupDbRow = {
  id: string;
  level: DistrictLevel;
  geometry_quality: GeometryQuality;
  approximate: boolean;
};

/**
 * The districts whose lookup parts cover the point: one per boundary layer (a county_union: or
 * sldl_union: district is a layer of its own), ties to the smaller source_key in byte order, then
 * the approximate districts they stand in for. Empty when no part covers the point.
 * L-point-lookup (D-210). The point is only a bound parameter: nothing is logged or stored
 * (INV-04).
 */
export async function lookupDistrictsAtPoint(
  db: Db | Tx,
  point: { readonly lng: number; readonly lat: number },
): Promise<readonly PointDistrictRow[]> {
  const { lng, lat } = point;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new RangeError('The longitude is not a number between -180 and 180.');
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError('The latitude is not a number between -90 and 90.');
  }
  // index: district_parts_geom, district_fallbacks_via
  const rows = await db.execute<LookupDbRow>(
    sql`select id, level, geometry_quality, approximate from (
          with pt as (
            select st_setsrid(st_makepoint(${lng}, ${lat}), 4326) as g
          ), hit as (
            select distinct p.district_id
            from district_parts p, pt
            where st_covers(p.geom, pt.g)
          ), exact as (
            select distinct on (case when d.source_key ~ '^(county|sldl)_union:' then d.source_key
                                     else regexp_replace(d.source_key, ':[^:]*$', '') end)
                   d.id, d.level, d.geometry_quality
            from hit h
            join districts d on d.id = h.district_id
            where d.retired_at is null
            order by case when d.source_key ~ '^(county|sldl)_union:' then d.source_key
                          else regexp_replace(d.source_key, ':[^:]*$', '') end,
                     d.source_key collate "C"
          )
          select id, level, geometry_quality, false as approximate from exact
          union all
          select distinct d.id, d.level, d.geometry_quality, true
          from exact e
          join district_fallbacks f on f.via_district_id = e.id
          join districts d on d.id = f.district_id
          where d.retired_at is null
        ) r
        order by r.approximate, r.id`,
    'objects',
  );
  return rows.map((row) => ({
    id: row.id,
    level: row.level,
    geometryQuality: row.geometry_quality,
    approximate: row.approximate,
  }));
}
