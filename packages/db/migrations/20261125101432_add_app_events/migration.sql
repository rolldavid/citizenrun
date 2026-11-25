create table app_events (
  id bigint generated always as identity,
  user_id uuid,
  name text not null,
  props jsonb not null default '{}',
  platform text,
  created_at timestamptz not null default now(),
  constraint app_events_pkey primary key (created_at, id),
  constraint app_events_platform_check check (platform in ('ios', 'android', 'web'))
) partition by range (created_at);
create index app_events_user on app_events (user_id, created_at);
create index app_events_name on app_events (name, created_at);

select os_ensure_month_partitions('app_events', 24);
