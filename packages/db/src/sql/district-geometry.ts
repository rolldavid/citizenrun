import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** The most vertices ST_Subdivide leaves in one lookup part (D-210). */
export const SUBDIVIDE_MAX_VERTICES = 128;
/** The zoom band that holds the display geometry unsimplified (T-district_display). */
export const DISPLAY_BAND_FULL = 3;

/**
 * An insert of district_parts rows from a source yielding (district_id uuid, level text, geom
 * geometry in 4326): each geometry cut by ST_Subdivide, multi-part results split by ST_Dump. Rows
 * with a null geometry are skipped.
 */
export function insertDistrictPartsSql(source: SQL): SQL {
  return sql`insert into district_parts (district_id, level, geom)
    select s.district_id, s.level, piece.geom
    from (${source}) as s(district_id, level, geom)
    cross join lateral st_subdivide(s.geom, ${SUBDIVIDE_MAX_VERTICES}::int) as part(geom)
    cross join lateral st_dump(part.geom) as piece
    where s.geom is not null`;
}

/**
 * An insert of band-3 district_display rows from a source yielding (district_id, level, display
 * geom in 4326): ST_Multi(ST_Transform(geom, 3857)), skipping null geometries and level 'special'.
 */
export function insertDisplayBandFullSql(source: SQL): SQL {
  return sql`insert into district_display (district_id, zoom_band, level, geom)
    select s.district_id, ${DISPLAY_BAND_FULL}::smallint, s.level, st_multi(st_transform(s.geom, 3857))
    from (${source}) as s(district_id, level, geom)
    where s.geom is not null and s.level <> 'special'`;
}
