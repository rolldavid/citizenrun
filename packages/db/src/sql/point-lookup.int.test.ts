import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from '../client.ts';
import {
  FIXTURE_POINT,
  getTestDb,
  insertDistrict,
  insertDistrictFallback,
} from '../testing/index.ts';
import { lookupDistrictsAtPoint } from './point-lookup.ts';

// TEST-point-lookup, the database cases: L-point-lookup on real PostGIS.

/** A rectangle in WKT, from longitudes and latitudes written as text with three decimals. */
function box(west: string, east: string, south = '30.000', north = '30.010'): string {
  return `POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`;
}

/** A polygon of `points` vertices on a circle of `radius` degrees around the point. */
function circle(lng: number, lat: number, radius: number, points: number): string {
  const ring = Array.from({ length: points }, (_, i) => {
    const angle = (2 * Math.PI * i) / points;
    return `${(lng + radius * Math.cos(angle)).toFixed(6)} ${(lat + radius * Math.sin(angle)).toFixed(6)}`;
  });
  return `POLYGON((${[...ring, ring[0] ?? ''].join(',')}))`;
}

async function retire(districtId: string): Promise<void> {
  await getTestDb().execute(sql`update districts set retired_at = now() where id = ${districtId}`);
}

async function ids(point: { lng: number; lat: number }): Promise<string[]> {
  return (await lookupDistrictsAtPoint(getTestDb(), point)).map((row) => row.id);
}

describe('lookupDistrictsAtPoint', () => {
  it('a point inside one district returns it', async () => {
    const district = await insertDistrict(getTestDb(), { level: 'local' });
    expect(await lookupDistrictsAtPoint(getTestDb(), FIXTURE_POINT)).toEqual([
      { id: district.id, level: 'local', geometryQuality: 'exact', approximate: false },
    ]);
  });

  it('border ties break by source key per layer', async () => {
    const db = getTestDb();
    const upper = await insertDistrict(db, {
      sourceKey: 'fixture:tie:B',
      level: 'local',
      wkt: box('-39.990', '-39.980'),
    });
    await insertDistrict(db, {
      sourceKey: 'fixture:tie:a',
      level: 'local',
      wkt: box('-39.980', '-39.970'),
    });
    const other = await insertDistrict(db, {
      sourceKey: 'fixture:other:1',
      level: 'local',
      wkt: box('-39.990', '-39.970'),
    });
    // 'B' (0x42) sorts before 'a' (0x61) in byte order; a locale-aware sort would pick 'a'.
    expect((await ids({ lng: -39.98, lat: 30.005 })).sort()).toEqual([upper.id, other.id].sort());
  });

  it('county unions are layers of their own', async () => {
    const db = getTestDb();
    const a = await insertDistrict(db, {
      sourceKey: 'county_union:ZZ:fixture-a',
      level: 'county',
      wkt: box('-39.990', '-39.970'),
    });
    const b = await insertDistrict(db, {
      sourceKey: 'county_union:ZZ:fixture-b',
      level: 'county',
      wkt: box('-39.980', '-39.960'),
    });
    const shared = await lookupDistrictsAtPoint(db, { lng: -39.975, lat: 30.005 });
    expect(shared.map((row) => row.id).sort()).toEqual([a.id, b.id].sort());
    expect(shared.every((row) => !row.approximate)).toBe(true);
    expect(await ids({ lng: -39.985, lat: 30.005 })).toEqual([a.id]);
  });

  it('approximate districts come last', async () => {
    const db = getTestDb();
    const upper = await insertDistrict(db, {
      sourceKey: 'fixture:tie:B',
      level: 'local',
      wkt: box('-39.990', '-39.980'),
    });
    const other = await insertDistrict(db, {
      sourceKey: 'fixture:other:1',
      level: 'local',
      wkt: box('-39.990', '-39.970'),
    });
    const approximate = await insertDistrict(db, {
      level: 'special',
      geometryQuality: 'county_approx',
    });
    await insertDistrictFallback(db, { districtId: approximate.id, viaDistrictId: upper.id });
    await insertDistrictFallback(db, { districtId: approximate.id, viaDistrictId: other.id });
    const found = await lookupDistrictsAtPoint(db, { lng: -39.985, lat: 30.005 });
    expect(found).toHaveLength(3);
    expect(
      found
        .slice(0, 2)
        .map((row) => row.id)
        .sort(),
    ).toEqual([upper.id, other.id].sort());
    expect(found[2]).toEqual({
      id: approximate.id,
      level: 'special',
      geometryQuality: 'county_approx',
      approximate: true,
    });
  });

  it('retired districts are left out', async () => {
    const db = getTestDb();
    const upper = await insertDistrict(db, {
      sourceKey: 'fixture:tie:B',
      level: 'local',
      wkt: box('-39.990', '-39.980'),
    });
    const other = await insertDistrict(db, {
      sourceKey: 'fixture:other:1',
      level: 'local',
      wkt: box('-39.990', '-39.970'),
    });
    const approximate = await insertDistrict(db, {
      level: 'special',
      geometryQuality: 'county_approx',
    });
    await insertDistrictFallback(db, { districtId: approximate.id, viaDistrictId: other.id });
    const point = { lng: -39.985, lat: 30.005 };
    await retire(upper.id);
    expect(await ids(point)).toEqual([other.id, approximate.id]);
    await retire(approximate.id);
    expect(await ids(point)).toEqual([other.id]);
  });

  it('a point outside every part returns nothing', async () => {
    await insertDistrict(getTestDb(), { level: 'local' });
    expect(await lookupDistrictsAtPoint(getTestDb(), { lng: 0, lat: 0 })).toEqual([]);
  });

  it('a district cut into many parts is returned once', async () => {
    const district = await insertDistrict(getTestDb(), {
      level: 'local',
      wkt: circle(FIXTURE_POINT.lng, FIXTURE_POINT.lat, 0.004, 200),
    });
    const [parts] = await getTestDb().execute<{ n: number }>(
      sql`select count(*)::int as n from district_parts where district_id = ${district.id}`,
      'objects',
    );
    expect(parts?.n).toBeGreaterThan(1);
    expect(await ids(FIXTURE_POINT)).toEqual([district.id]);
  });

  it('bad coordinates are refused', async () => {
    let sent = 0;
    const counting = {
      execute: (): never => {
        sent += 1;
        throw new Error('A statement was sent.');
      },
    } as unknown as Db;
    await expect(lookupDistrictsAtPoint(counting, { lng: 181, lat: 30 })).rejects.toThrow(
      RangeError,
    );
    await expect(lookupDistrictsAtPoint(counting, { lng: -40, lat: Number.NaN })).rejects.toThrow(
      RangeError,
    );
    await expect(lookupDistrictsAtPoint(counting, { lng: -40, lat: 90.5 })).rejects.toThrow(
      RangeError,
    );
    expect(sent).toBe(0);
  });
});
