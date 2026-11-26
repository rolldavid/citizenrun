-- The block sums of one state's districts and the validity of their lookup geometry, run by psql
-- in the pipeline's scratch database. The blocks and the districts arrive on psql's standard
-- input, each block of rows ended by a line holding \. ; every \copy stays on one line.
create table blocks (geoid text primary key, p1 int not null, p3 int not null, lng float8 not null, lat float8 not null);
create table districts (key text primary key, wkb text not null);
\copy blocks (geoid, p1, p3, lng, lat) from pstdin with (format csv)
\copy districts (key, wkb) from pstdin with (format csv)
alter table blocks add column pt geometry(Point, 4326);
update blocks set pt = st_setsrid(st_makepoint(lng, lat), 4326);
create index blocks_pt on blocks using gist (pt);
alter table districts add column geom geometry(MultiPolygon, 4326);
update districts set geom = st_multi(st_setsrid(st_geomfromwkb(decode(wkb, 'hex')), 4326));
\copy (select 'INVALID', key from districts where not st_isvalid(geom) order by key) to pstdout with (format csv)
create table district_parts as select key, st_subdivide(geom, 128) as geom from districts where st_isvalid(geom);
create index district_parts_geom on district_parts using gist (geom);
analyze blocks;
analyze district_parts;
\copy (select key, sum(p1), sum(p3), count(*) from (select distinct d.key, b.geoid, b.p1, b.p3 from blocks b join district_parts d on st_covers(d.geom, b.pt)) x group by key order by key) to pstdout with (format csv)
