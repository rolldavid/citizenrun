-- MIG-M2-08: T-staging.bundle_rows, T-staging.district_geometry
create schema staging;

create unlogged table staging.bundle_rows (
  bundle_id uuid not null,
  file text not null,
  line int not null,
  id uuid,
  source_key text,
  data jsonb not null,
  primary key (bundle_id, file, line)
);
create index bundle_rows_key on staging.bundle_rows (bundle_id, file, source_key);

create unlogged table staging.district_geometry (
  bundle_id uuid not null,
  source_key text not null,
  lookup_geom geometry(MultiPolygon, 4326),
  display_geom geometry(MultiPolygon, 4326),
  label_point geometry(Point, 4326),
  outline_svg text,
  outline_bbox double precision[],
  geom_hash text not null,
  primary key (bundle_id, source_key)
);
