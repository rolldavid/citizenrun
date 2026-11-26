import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { FIXTURE_POINT, getTestDb, insertDistrict } from '../testing/index.ts';
import { DISPLAY_BAND_FULL, SUBDIVIDE_MAX_VERTICES } from './district-geometry.ts';

// The district geometry fill (T-district_parts, T-district_display) through the factory, which
// runs the loader's own two statements.

/** A polygon of `points` vertices on a circle of `radius` degrees around the point. */
function circle(lng: number, lat: number, radius: number, points: number): string {
  const ring = Array.from({ length: points }, (_, i) => {
    const angle = (2 * Math.PI * i) / points;
    return `${(lng + radius * Math.cos(angle)).toFixed(6)} ${(lat + radius * Math.sin(angle)).toFixed(6)}`;
  });
  return `POLYGON((${[...ring, ring[0] ?? ''].join(',')}))`;
}

const ROUND = circle(FIXTURE_POINT.lng, FIXTURE_POINT.lat, 0.004, 300);

describe('the district geometry fill', () => {
  it('parts cover the district and nothing else', async () => {
    const district = await insertDistrict(getTestDb(), { level: 'local', wkt: ROUND });
    const [row] = await getTestDb().execute<{ parts: number; equal: boolean }>(
      sql`select count(*)::int as parts,
                 st_equals(st_union(p.geom), st_geomfromtext(${ROUND}, 4326)) as equal
          from district_parts p where p.district_id = ${district.id}`,
      'objects',
    );
    expect(row?.parts).toBeGreaterThan(1);
    expect(row?.equal).toBe(true);
  });

  it('no part has more than 128 vertices', async () => {
    expect(SUBDIVIDE_MAX_VERTICES).toBe(128);
    const district = await insertDistrict(getTestDb(), { level: 'local', wkt: ROUND });
    const [row] = await getTestDb().execute<{ most: number; kinds: string[] }>(
      sql`select max(st_npoints(geom))::int as most, array_agg(distinct geometrytype(geom)) as kinds
          from district_parts where district_id = ${district.id}`,
      'objects',
    );
    expect(row?.most).toBeLessThanOrEqual(128);
    expect(row?.kinds).toEqual(['POLYGON']);
  });

  it('band 3 is the display geometry in web mercator', async () => {
    expect(DISPLAY_BAND_FULL).toBe(3);
    const district = await insertDistrict(getTestDb(), { level: 'county', wkt: ROUND });
    const [row] = await getTestDb().execute<{ bands: number[]; srid: number; distance: number }>(
      sql`select array_agg(dd.zoom_band order by dd.zoom_band) as bands,
                 max(st_srid(dd.geom)) as srid,
                 max(st_hausdorffdistance(st_transform(dd.geom, 4326), d.geom)) as distance
          from district_display dd join districts d on d.id = dd.district_id
          where dd.district_id = ${district.id}`,
      'objects',
    );
    expect(row?.bands).toEqual([3]);
    expect(row?.srid).toBe(3857);
    expect(row?.distance).toBeLessThan(1e-9);
  });

  it('special districts get parts and no display rows', async () => {
    const district = await insertDistrict(getTestDb(), { level: 'special' });
    const [row] = await getTestDb().execute<{ parts: number; display: number }>(
      sql`select (select count(*)::int from district_parts where district_id = ${district.id}) as parts,
                 (select count(*)::int from district_display where district_id = ${district.id}) as display`,
      'objects',
    );
    expect(row).toEqual({ parts: 1, display: 0 });
  });
});
