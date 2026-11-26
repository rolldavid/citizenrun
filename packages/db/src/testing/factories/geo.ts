import { civicId } from '@citizenrun/shared';
import { eq, getColumns, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../client.ts';
import { districtFallbacks, districts, jurisdictions, zipCentroids } from '../../schema/geo.ts';
import type {
  DistrictFallbackRow,
  DistrictRow,
  JurisdictionRow,
  NewDistrictRow,
  NewJurisdictionRow,
  NewZipCentroidRow,
  ZipCentroidRow,
} from '../../schema/geo.ts';
import { insertDisplayBandFullSql, insertDistrictPartsSql } from '../../sql/district-geometry.ts';
import { nextDistrictOrdinal, nextSequence } from '../sequence.ts';

// The geography factories (TEST-harness-factories, milestone 2). Geometry is written through SQL
// and never returned to the test (00 section 5.6): the returned rows leave out `geom`,
// `label_point` and `point`.

/** The default fixture point: inside the square of the first district a test inserts. */
export const FIXTURE_POINT = { lat: 30.004321, lng: -39.995678 } as const;

/** A copy of a table's columns without the named ones, for a `returning` with no geometry. */
export function columnsWithout<T extends Record<string, unknown>, K extends keyof T & string>(
  columns: T,
  omit: readonly K[],
): Omit<T, K> {
  const left: Record<string, unknown> = {};
  for (const [name, column] of Object.entries(columns)) {
    if (!(omit as readonly string[]).includes(name)) {
      left[name] = column;
    }
  }
  return left as Omit<T, K>;
}

/** `fixture:<table>:<seq>`, the default source key of a civic fixture row. */
export function fixtureSourceKey(table: string, seq: number): string {
  return `fixture:${table}:${String(seq)}`;
}

/** A jurisdiction as a test sees it: every column but `label_point`. */
export type JurisdictionFixture = Omit<JurisdictionRow, 'labelPoint'>;

/**
 * A county `ZZ` named `Fixture County <seq>`, keyed `fixture:jurisdictions:<seq>`, its id the
 * civic id of that key; every fact null (`timezone` null: the `America/New_York` fallback).
 */
export function makeJurisdiction(
  overrides: Omit<Partial<NewJurisdictionRow>, 'labelPoint'> = {},
): NewJurisdictionRow {
  const seq = nextSequence();
  const sourceKey = overrides.sourceKey ?? fixtureSourceKey('jurisdictions', seq);
  return {
    kind: 'county',
    state: 'ZZ',
    name: `Fixture County ${String(seq)}`,
    ...overrides,
    id: overrides.id ?? civicId('jurisdictions', sourceKey),
    sourceKey,
  };
}

/** Writes makeJurisdiction(overrides) and returns the stored row without its geometry. */
export async function insertJurisdiction(
  db: Db | Tx,
  overrides: Omit<Partial<NewJurisdictionRow>, 'labelPoint'> = {},
): Promise<JurisdictionFixture> {
  const [row] = await db
    .insert(jurisdictions)
    .values(makeJurisdiction(overrides))
    .returning(columnsWithout(getColumns(jurisdictions), ['labelPoint']));
  if (row === undefined) {
    throw new Error('The jurisdictions insert returned no row.');
  }
  return row;
}

// Thousandths of a degree as WKT with three decimals: -39990 gives -39.990.
function degrees(thousandths: number): string {
  const sign = thousandths < 0 ? '-' : '';
  const whole = Math.abs(thousandths);
  return `${sign}${String(Math.floor(whole / 1000))}.${String(whole % 1000).padStart(3, '0')}`;
}

/**
 * The fixture square of the district with ordinal `k`: 0.01 degrees on a side, its south-west
 * corner at longitude -40.000 + 0.02 × (k mod 50) and latitude 30.000 + 0.02 × floor(k / 50),
 * built from integer thousandths so no corner prints as -39.980000000000004.
 */
export function fixtureSquareWkt(k: number): string {
  const west = -40000 + 20 * (k % 50);
  const south = 30000 + 20 * Math.floor(k / 50);
  const east = west + 10;
  const north = south + 10;
  const corners = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ].map(([x = 0, y = 0]) => `${degrees(x)} ${degrees(y)}`);
  return `POLYGON((${corners.join(',')}))`;
}

/** A district as a test sees it: every column but `geom` and `label_point`. */
export type DistrictFixture = Omit<DistrictRow, 'geom' | 'labelPoint'>;

/** The overrides of the District factory: any column but the geometry, and its shapes as WKT. */
export type DistrictOverrides = Omit<Partial<NewDistrictRow>, 'geom' | 'labelPoint'> & {
  /** The lookup geometry, a polygon or multipolygon in WKT, SRID 4326. */
  wkt?: string;
  /** The display geometry; defaults to `wkt`. */
  displayWkt?: string;
};

/**
 * A county-level exact district named `Fixture District <seq>`, keyed `fixture:districts:<seq>`,
 * with the outline path `M0 0L10 0L10 10L0 10Z`. The geometry columns are not in the made row:
 * insertDistrict writes them through SQL. Without a `jurisdictionId` the row names the civic id
 * of a fixture key; insertDistrict then creates a jurisdiction.
 */
export function makeDistrict(overrides: DistrictOverrides = {}): NewDistrictRow {
  const columns = columnsWithout(overrides, ['wkt', 'displayWkt']);
  const seq = nextSequence();
  const sourceKey = columns.sourceKey ?? fixtureSourceKey('districts', seq);
  return {
    level: 'county',
    geometryQuality: 'exact',
    name: `Fixture District ${String(seq)}`,
    outlineSvg: 'M0 0L10 0L10 10L0 10Z',
    jurisdictionId:
      columns.jurisdictionId ?? civicId('jurisdictions', fixtureSourceKey('jurisdictions', seq)),
    ...columns,
    id: columns.id ?? civicId('districts', sourceKey),
    sourceKey,
  };
}

/**
 * Writes a district in one transaction, creating its jurisdiction when none is given. An exact
 * district gets `geom` = ST_Multi of the display WKT, `geom_hash` = the hex SHA-256 of the lookup
 * geometry's well-known binary, `label_point` = ST_PointOnSurface(geom), `outline_bbox` the bounds
 * of geom in EPSG:3857, then its `district_parts` and band 3 of `district_display` through the
 * loader's own statements. Each district takes the next ordinal; without a `wkt` its shape is the
 * fixture square of that ordinal. An approximate district has no geometry, parts or display rows.
 */
export async function insertDistrict(
  db: Db | Tx,
  overrides: DistrictOverrides = {},
): Promise<DistrictFixture> {
  const ordinal = nextDistrictOrdinal();
  return db.transaction(async (tx) => {
    const jurisdictionId = overrides.jurisdictionId ?? (await insertJurisdiction(tx)).id;
    const values = makeDistrict({ ...overrides, jurisdictionId });
    const id = values.id;
    if (values.geometryQuality !== 'exact') {
      await tx.insert(districts).values(values);
    } else {
      const wkt = overrides.wkt ?? fixtureSquareWkt(ordinal);
      const displayWkt = overrides.displayWkt ?? wkt;
      await tx.insert(districts).values({
        ...values,
        geom: sql`st_multi(st_geomfromtext(${displayWkt}, 4326))`,
        geomHash: sql`encode(sha256(st_asbinary(st_multi(st_geomfromtext(${wkt}, 4326)))), 'hex')`,
      });
      await tx.execute(
        sql`update districts
            set label_point = st_pointonsurface(districts.geom),
                outline_bbox = array[st_xmin(b.g), st_ymin(b.g), st_xmax(b.g), st_ymax(b.g)]
            from (select st_transform(geom, 3857) as g from districts where id = ${id}::uuid) b
            where districts.id = ${id}::uuid`,
      );
      await tx.execute(
        insertDistrictPartsSql(
          sql`select ${id}::uuid, ${values.level}::text, st_multi(st_geomfromtext(${wkt}, 4326))`,
        ),
      );
      await tx.execute(
        insertDisplayBandFullSql(
          sql`select ${id}::uuid, ${values.level}::text, st_multi(st_geomfromtext(${displayWkt}, 4326))`,
        ),
      );
    }
    const [row] = await tx
      .select(columnsWithout(getColumns(districts), ['geom', 'labelPoint']))
      .from(districts)
      .where(eq(districts.id, id));
    if (row === undefined) {
      throw new Error('The districts insert returned no row.');
    }
    return row;
  });
}

/**
 * Writes a `district_fallbacks` row. Without a `districtId` it first inserts a `county_approx`
 * district of level `special`; without a `viaDistrictId` an exact district. Refuses (throws) when
 * the via district is not exact (T-district_fallbacks).
 */
export async function insertDistrictFallback(
  db: Db | Tx,
  overrides: { districtId?: string; viaDistrictId?: string } = {},
): Promise<DistrictFallbackRow> {
  return db.transaction(async (tx) => {
    const districtId =
      overrides.districtId ??
      (await insertDistrict(tx, { level: 'special', geometryQuality: 'county_approx' })).id;
    const viaDistrictId = overrides.viaDistrictId ?? (await insertDistrict(tx)).id;
    const [via] = await tx
      .select({ geometryQuality: districts.geometryQuality })
      .from(districts)
      .where(eq(districts.id, viaDistrictId));
    if (via?.geometryQuality !== 'exact') {
      throw new RangeError('A fallback must stand in through an exact district.');
    }
    const [row] = await tx
      .insert(districtFallbacks)
      .values({ districtId, viaDistrictId })
      .returning();
    if (row === undefined) {
      throw new Error('The district_fallbacks insert returned no row.');
    }
    return row;
  });
}

/** A ZIP centroid as a test sees it: every column but `point`. */
export type ZipCentroidFixture = Omit<ZipCentroidRow, 'point'>;

/** The overrides of the ZipCentroid factory: any column but `point`, and the point's place. */
export type ZipCentroidOverrides = Omit<Partial<NewZipCentroidRow>, 'point'> & {
  lng?: number;
  lat?: number;
};

/** A `ZZ` centroid with the ZIP `000<nn>`, `nn` the sequence number modulo 100. */
export function makeZipCentroid(
  overrides: Omit<Partial<NewZipCentroidRow>, 'point'> = {},
): Omit<NewZipCentroidRow, 'point'> {
  const seq = nextSequence();
  return {
    zip: `000${String(seq % 100).padStart(2, '0')}`,
    state: 'ZZ',
    ...overrides,
  };
}

/** Writes makeZipCentroid with its point at (-39.995, 30.005) unless `lng` and `lat` are given. */
export async function insertZipCentroid(
  db: Db | Tx,
  overrides: ZipCentroidOverrides = {},
): Promise<ZipCentroidFixture> {
  const { lng = -39.995, lat = 30.005, ...columns } = overrides;
  const [row] = await db
    .insert(zipCentroids)
    .values({
      ...makeZipCentroid(columns),
      point: sql`st_setsrid(st_makepoint(${lng}, ${lat}), 4326)`,
    })
    .returning(columnsWithout(getColumns(zipCentroids), ['point']));
  if (row === undefined) {
    throw new Error('The zip_centroids insert returned no row.');
  }
  return row;
}
