import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { geometry } from '../types.ts';

const multiPolygon4326 = geometry('MultiPolygon', 4326);
const polygon4326 = geometry('Polygon', 4326);
const point4326 = geometry('Point', 4326);
const multiPolygon3857 = geometry('MultiPolygon', 3857);

/**
 * Every government or organisation that has elected offices (T-jurisdictions). Written only by
 * the bundle load; a unit that leaves the public record is retired, never deleted (A4).
 */
export const jurisdictions = pgTable(
  'jurisdictions',
  {
    id: uuid('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    state: char('state', { length: 2 }).notNull(),
    censusId: text('census_id'),
    parentId: uuid('parent_id'),
    population: integer('population'),
    website: text('website'),
    timezone: text('timezone'),
    budgetCents: bigint('budget_cents', { mode: 'number' }),
    budgetYear: integer('budget_year'),
    censusActive: boolean('census_active'),
    labelPoint: point4326('label_point'),
    fieldMeta: jsonb('field_meta').$type<Record<string, unknown>>().notNull().default({}),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'jurisdictions_parent_id_fkey',
      columns: [table.parentId],
      foreignColumns: [table.id],
    }),
    unique('jurisdictions_source_key_key').on(table.sourceKey),
    unique('jurisdictions_census_id_key').on(table.censusId),
    check(
      'jurisdictions_kind_check',
      sql`${table.kind} in ('state', 'county', 'city', 'township', 'school_district', 'special_district', 'coop', 'party')`,
    ),
    check('jurisdictions_state_check', sql`${table.state} ~ '^[A-Z]{2}$'`),
    check('jurisdictions_website_check', sql`${table.website} like 'https://%'`),
    index('jurisdictions_state').on(table.state, table.kind),
    index('jurisdictions_parent')
      .on(table.parentId)
      .where(sql`${table.parentId} is not null`),
    index('jurisdictions_name_trgm').using('gin', table.name.op('gin_trgm_ops')),
  ],
);

export type JurisdictionRow = typeof jurisdictions.$inferSelect;
export type NewJurisdictionRow = typeof jurisdictions.$inferInsert;

/**
 * The area whose voters elect an office (T-districts). `geom` is the display geometry; point
 * lookups read `district_parts`. `tile_id` is assigned once and never changes (D-052).
 */
export const districts = pgTable(
  'districts',
  {
    id: uuid('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    tileId: bigint('tile_id', { mode: 'number' }).generatedAlwaysAsIdentity({
      maxValue: 9007199254740991,
    }),
    jurisdictionId: uuid('jurisdiction_id').notNull(),
    name: text('name').notNull(),
    level: text('level').notNull(),
    geom: multiPolygon4326('geom'),
    geomHash: text('geom_hash'),
    outlineSvg: text('outline_svg'),
    outlineBbox: doublePrecision('outline_bbox').array(),
    labelPoint: point4326('label_point'),
    geometryQuality: text('geometry_quality').notNull(),
    population: integer('population'),
    population18: integer('population_18'),
    lean: numeric('lean'),
    leanBasis: text('lean_basis'),
    fieldMeta: jsonb('field_meta').$type<Record<string, unknown>>().notNull().default({}),
    retiredAt: timestamp('retired_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'districts_jurisdiction_id_fkey',
      columns: [table.jurisdictionId],
      foreignColumns: [jurisdictions.id],
    }),
    unique('districts_source_key_key').on(table.sourceKey),
    unique('districts_tile_id_key').on(table.tileId),
    check(
      'districts_level_check',
      sql`${table.level} in ('local', 'county', 'state', 'federal', 'special')`,
    ),
    check(
      'districts_geometry_quality_check',
      sql`${table.geometryQuality} in ('exact', 'parent_fallback', 'county_approx')`,
    ),
    check('districts_lean_check', sql`${table.lean} between -100 and 100`),
    check(
      'districts_lean_basis_check',
      sql`${table.leanBasis} in ('precinct', 'county', 'precinct_2020_county_swing')`,
    ),
    check(
      'districts_outline_svg_check',
      sql`${table.outlineSvg} ~ '^[MLHVZmlhvz0-9 ,.-]+$' and char_length(${table.outlineSvg}) <= 20000`,
    ),
    check('districts_outline_bbox_check', sql`array_length(${table.outlineBbox}, 1) = 4`),
    index('districts_geom').using('gist', table.geom),
    index('districts_label_point').using('gist', table.labelPoint),
    index('districts_jurisdiction').on(table.jurisdictionId),
    index('districts_level').on(table.level),
  ],
);

export type DistrictRow = typeof districts.$inferSelect;
export type NewDistrictRow = typeof districts.$inferInsert;

/**
 * Lookup geometry cut into small polygons, so a point lookup reads a few small shapes (D-210).
 * Only exact districts have parts.
 */
export const districtParts = pgTable(
  'district_parts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    districtId: uuid('district_id').notNull(),
    level: text('level').notNull(),
    geom: polygon4326('geom').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'district_parts_district_id_fkey',
      columns: [table.districtId],
      foreignColumns: [districts.id],
    }).onDelete('cascade'),
    check(
      'district_parts_level_check',
      sql`${table.level} in ('local', 'county', 'state', 'federal', 'special')`,
    ),
    index('district_parts_geom').using('gist', table.geom),
    index('district_parts_district').on(table.districtId),
  ],
);

export type DistrictPartRow = typeof districtParts.$inferSelect;
export type NewDistrictPartRow = typeof districtParts.$inferInsert;

/** For a district with no boundary of its own, the exact districts whose area stands in for it. */
export const districtFallbacks = pgTable(
  'district_fallbacks',
  {
    districtId: uuid('district_id').notNull(),
    viaDistrictId: uuid('via_district_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'district_fallbacks_pkey',
      columns: [table.districtId, table.viaDistrictId],
    }),
    foreignKey({
      name: 'district_fallbacks_district_id_fkey',
      columns: [table.districtId],
      foreignColumns: [districts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'district_fallbacks_via_district_id_fkey',
      columns: [table.viaDistrictId],
      foreignColumns: [districts.id],
    }).onDelete('cascade'),
    check('district_fallbacks_distinct_check', sql`${table.districtId} <> ${table.viaDistrictId}`),
    index('district_fallbacks_via').on(table.viaDistrictId),
  ],
);

export type DistrictFallbackRow = typeof districtFallbacks.$inferSelect;
export type NewDistrictFallbackRow = typeof districtFallbacks.$inferInsert;

/** One pre-simplified Web Mercator geometry per district and zoom band (D-204). */
export const districtDisplay = pgTable(
  'district_display',
  {
    districtId: uuid('district_id').notNull(),
    zoomBand: smallint('zoom_band').notNull(),
    level: text('level').notNull(),
    geom: multiPolygon3857('geom').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'district_display_pkey', columns: [table.districtId, table.zoomBand] }),
    foreignKey({
      name: 'district_display_district_id_fkey',
      columns: [table.districtId],
      foreignColumns: [districts.id],
    }).onDelete('cascade'),
    check('district_display_zoom_band_check', sql`${table.zoomBand} between 0 and 3`),
    check(
      'district_display_level_check',
      sql`${table.level} in ('local', 'county', 'state', 'federal')`,
    ),
    index('district_display_band0')
      .using('gist', table.geom)
      .where(sql`${table.zoomBand} = 0`),
    index('district_display_band1')
      .using('gist', table.geom)
      .where(sql`${table.zoomBand} = 1`),
    index('district_display_band2')
      .using('gist', table.geom)
      .where(sql`${table.zoomBand} = 2`),
    index('district_display_band3')
      .using('gist', table.geom)
      .where(sql`${table.zoomBand} = 3`),
  ],
);

export type DistrictDisplayRow = typeof districtDisplay.$inferSelect;
export type NewDistrictDisplayRow = typeof districtDisplay.$inferInsert;

/** ZIP Code Tabulation Area centroids for place search (D-209, D-212). */
export const zipCentroids = pgTable(
  'zip_centroids',
  {
    zip: char('zip', { length: 5 }).primaryKey(),
    state: char('state', { length: 2 }).notNull(),
    point: point4326('point').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('zip_centroids_zip_check', sql`${table.zip} ~ '^[0-9]{5}$'`),
    check('zip_centroids_state_check', sql`${table.state} ~ '^[A-Z]{2}$'`),
  ],
);

export type ZipCentroidRow = typeof zipCentroids.$inferSelect;
export type NewZipCentroidRow = typeof zipCentroids.$inferInsert;
