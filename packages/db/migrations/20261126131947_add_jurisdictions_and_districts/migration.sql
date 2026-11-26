CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY,
	"source_key" text NOT NULL CONSTRAINT "jurisdictions_source_key_key" UNIQUE,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"state" char(2) NOT NULL,
	"census_id" text CONSTRAINT "jurisdictions_census_id_key" UNIQUE,
	"parent_id" uuid,
	"population" integer,
	"website" text,
	"timezone" text,
	"budget_cents" bigint,
	"budget_year" integer,
	"census_active" boolean,
	"label_point" geometry(Point,4326),
	"field_meta" jsonb DEFAULT '{}' NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jurisdictions_kind_check" CHECK ("kind" in ('state', 'county', 'city', 'township', 'school_district', 'special_district', 'coop', 'party')),
	CONSTRAINT "jurisdictions_state_check" CHECK ("state" ~ '^[A-Z]{2}$'),
	CONSTRAINT "jurisdictions_website_check" CHECK ("website" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY,
	"source_key" text NOT NULL CONSTRAINT "districts_source_key_key" UNIQUE,
	"tile_id" bigint CONSTRAINT "districts_tile_id_key" UNIQUE GENERATED ALWAYS AS IDENTITY (sequence name "districts_tile_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9007199254740991 START WITH 1 CACHE 1),
	"jurisdiction_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" text NOT NULL,
	"geom" geometry(MultiPolygon,4326),
	"geom_hash" text,
	"outline_svg" text,
	"outline_bbox" double precision[],
	"label_point" geometry(Point,4326),
	"geometry_quality" text NOT NULL,
	"population" integer,
	"population_18" integer,
	"lean" numeric,
	"lean_basis" text,
	"field_meta" jsonb DEFAULT '{}' NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "districts_level_check" CHECK ("level" in ('local', 'county', 'state', 'federal', 'special')),
	CONSTRAINT "districts_geometry_quality_check" CHECK ("geometry_quality" in ('exact', 'parent_fallback', 'county_approx')),
	CONSTRAINT "districts_lean_check" CHECK ("lean" between -100 and 100),
	CONSTRAINT "districts_lean_basis_check" CHECK ("lean_basis" in ('precinct', 'county', 'precinct_2020_county_swing')),
	CONSTRAINT "districts_outline_svg_check" CHECK ("outline_svg" ~ '^[MLHVZmlhvz0-9 ,.-]+$' and char_length("outline_svg") <= 20000),
	CONSTRAINT "districts_outline_bbox_check" CHECK (array_length("outline_bbox", 1) = 4)
);
--> statement-breakpoint
CREATE TABLE "district_parts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "district_parts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"district_id" uuid NOT NULL,
	"level" text NOT NULL,
	"geom" geometry(Polygon,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "district_parts_level_check" CHECK ("level" in ('local', 'county', 'state', 'federal', 'special'))
);
--> statement-breakpoint
CREATE TABLE "district_fallbacks" (
	"district_id" uuid,
	"via_district_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "district_fallbacks_pkey" PRIMARY KEY("district_id","via_district_id"),
	CONSTRAINT "district_fallbacks_distinct_check" CHECK ("district_id" <> "via_district_id")
);
--> statement-breakpoint
CREATE TABLE "district_display" (
	"district_id" uuid,
	"zoom_band" smallint,
	"level" text NOT NULL,
	"geom" geometry(MultiPolygon,3857) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "district_display_pkey" PRIMARY KEY("district_id","zoom_band"),
	CONSTRAINT "district_display_zoom_band_check" CHECK ("zoom_band" between 0 and 3),
	CONSTRAINT "district_display_level_check" CHECK ("level" in ('local', 'county', 'state', 'federal'))
);
--> statement-breakpoint
CREATE TABLE "zip_centroids" (
	"zip" char(5) PRIMARY KEY,
	"state" char(2) NOT NULL,
	"point" geometry(Point,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zip_centroids_zip_check" CHECK ("zip" ~ '^[0-9]{5}$'),
	CONSTRAINT "zip_centroids_state_check" CHECK ("state" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE INDEX "jurisdictions_state" ON "jurisdictions" ("state","kind");--> statement-breakpoint
CREATE INDEX "jurisdictions_parent" ON "jurisdictions" ("parent_id") WHERE "parent_id" is not null;--> statement-breakpoint
CREATE INDEX "jurisdictions_name_trgm" ON "jurisdictions" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "districts_geom" ON "districts" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "districts_label_point" ON "districts" USING gist ("label_point");--> statement-breakpoint
CREATE INDEX "districts_jurisdiction" ON "districts" ("jurisdiction_id");--> statement-breakpoint
CREATE INDEX "districts_level" ON "districts" ("level");--> statement-breakpoint
CREATE INDEX "district_parts_geom" ON "district_parts" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "district_parts_district" ON "district_parts" ("district_id");--> statement-breakpoint
CREATE INDEX "district_fallbacks_via" ON "district_fallbacks" ("via_district_id");--> statement-breakpoint
CREATE INDEX "district_display_band0" ON "district_display" USING gist ("geom") WHERE "zoom_band" = 0;--> statement-breakpoint
CREATE INDEX "district_display_band1" ON "district_display" USING gist ("geom") WHERE "zoom_band" = 1;--> statement-breakpoint
CREATE INDEX "district_display_band2" ON "district_display" USING gist ("geom") WHERE "zoom_band" = 2;--> statement-breakpoint
CREATE INDEX "district_display_band3" ON "district_display" USING gist ("geom") WHERE "zoom_band" = 3;--> statement-breakpoint
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "jurisdictions"("id");--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id");--> statement-breakpoint
ALTER TABLE "district_parts" ADD CONSTRAINT "district_parts_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "district_fallbacks" ADD CONSTRAINT "district_fallbacks_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "district_fallbacks" ADD CONSTRAINT "district_fallbacks_via_district_id_fkey" FOREIGN KEY ("via_district_id") REFERENCES "districts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "district_display" ADD CONSTRAINT "district_display_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE;