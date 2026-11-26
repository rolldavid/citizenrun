import { sql } from 'drizzle-orm';
import type { Db } from '../client.ts';
import {
  DISPLAY_BAND_FULL,
  insertDisplayBandFullSql,
  insertDistrictPartsSql,
} from '../sql/district-geometry.ts';

// The geometry step of PIPE-loader-geometry (D-208, D-210, D-204), after the main
// transaction has committed: one transaction per staged state, touching only the districts whose
// staged geom_hash differs from the stored one. Geometry writes no bundle_changes; a revert does
// not undo it.

/**
 * Writes each staged state's changed district geometry, its lookup parts and its band 3 display
 * row; then, when the ZIP centroids were staged, replaces them; then empties
 * staging.district_geometry of the bundle. Returns the number of districts rewritten.
 */
export async function applyGeometry(
  db: Db,
  bundleId: string,
  states: readonly string[],
  zipStaged: boolean,
): Promise<{ districts: number }> {
  const b = sql`${bundleId}::uuid`;
  let districts = 0;
  for (const state of states) {
    districts += await db.transaction(async (tx) => {
      await tx.execute(
        sql`create temp table geom_changed (
              id uuid primary key, level text not null, geometry_quality text not null,
              lookup_geom geometry(MultiPolygon, 4326), display_geom geometry(MultiPolygon, 4326),
              label_point geometry(Point, 4326), outline_svg text, outline_bbox double precision[],
              geom_hash text not null) on commit drop`,
      );
      // index: district_geometry_pkey; districts_source_key_key; jurisdictions_pkey
      const changed = await tx.execute<{ id: string }>(
        sql`insert into geom_changed
            select d.id, d.level, d.geometry_quality, g.lookup_geom, g.display_geom, g.label_point,
                   g.outline_svg, g.outline_bbox, g.geom_hash
            from staging.district_geometry g
            join districts d on d.source_key = g.source_key
            join jurisdictions j on j.id = d.jurisdiction_id
            where g.bundle_id = ${b} and j.state = ${state} and d.geom_hash is distinct from g.geom_hash
            returning id`,
        'objects',
      );
      if (changed.length === 0) {
        return 0;
      }
      await tx.execute(
        sql`update districts d
            set geom = c.display_geom, outline_svg = c.outline_svg, outline_bbox = c.outline_bbox,
                label_point = c.label_point, geom_hash = c.geom_hash
            from geom_changed c where d.id = c.id`,
      );
      // index: district_parts_district
      await tx.execute(
        sql`delete from district_parts where district_id in (select id from geom_changed)`,
      );
      await tx.execute(
        insertDistrictPartsSql(
          sql`select id, level, lookup_geom from geom_changed where geometry_quality = 'exact'`,
        ),
      );
      // index: district_display_pkey
      await tx.execute(
        sql`delete from district_display
            where zoom_band = ${DISPLAY_BAND_FULL} and district_id in (select id from geom_changed)`,
      );
      await tx.execute(
        insertDisplayBandFullSql(
          sql`select id, level, display_geom from geom_changed where geometry_quality = 'exact'`,
        ),
      );
      return changed.length;
    });
  }
  if (zipStaged) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from zip_centroids`);
      // index: bundle_rows_key
      await tx.execute(
        sql`insert into zip_centroids (zip, state, point)
            select data ->> 'zip', data ->> 'state',
                   st_setsrid(st_makepoint((data ->> 'lng')::float8, (data ->> 'lat')::float8), 4326)
            from staging.bundle_rows
            where bundle_id = ${b} and file = 'zip_centroids'`,
      );
    });
  }
  // index: district_geometry_pkey
  await db.execute(sql`delete from staging.district_geometry where bundle_id = ${b}`);
  return { districts };
}
