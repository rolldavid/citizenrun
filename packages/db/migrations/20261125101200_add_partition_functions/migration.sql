-- MIG-M1-01: month partitions for app_events, feed_events and feed_features (L-partitions)
create function os_ensure_month_partitions(parent regclass, months_ahead int)
returns int
language plpgsql
as $$
declare
  first_month date := date_trunc('month', now() at time zone 'utc')::date;
  lo date;
  hi date;
  part text;
  made int := 0;
begin
  for i in 0..months_ahead loop
    lo := (first_month + make_interval(months => i))::date;
    hi := (first_month + make_interval(months => i + 1))::date;
    part := parent::text || '_' || to_char(lo, 'YYYYMM');
    if to_regclass(part) is null then
      execute format(
        'create table %I partition of %s for values from (%L) to (%L)',
        part, parent, lo::text || ' 00:00:00+00', hi::text || ' 00:00:00+00');
      made := made + 1;
    end if;
  end loop;
  return made;
end
$$;

create function os_drop_month_partitions(parent regclass, keep_days int)
returns int
language plpgsql
as $$
declare
  r record;
  upper_bound timestamptz;
  dropped int := 0;
begin
  for r in
    select c.oid::regclass as part, c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = parent
  loop
    -- a partition is named <parent>_YYYYMM and ends at the first instant of the next month, UTC
    upper_bound := ((to_date(right(r.relname, 6), 'YYYYMM') + interval '1 month')::timestamp) at time zone 'utc';
    if upper_bound < now() - make_interval(days => keep_days) then
      execute format('drop table %s', r.part);
      dropped := dropped + 1;
    end if;
  end loop;
  return dropped;
end
$$;
