-- packages/db/sql/roles.sql — OPS-db-roles and OPS-db-settings. Run as the superuser. Idempotent.
create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists citext;
create extension if not exists unaccent;

do $$
begin
  if to_regrole('app_owner') is null then create role app_owner nologin; end if;
  if to_regrole('app_api') is null then create role app_api login; end if;
  if to_regrole('app_worker') is null then create role app_worker login; end if;
  if to_regrole('app_backup') is null then create role app_backup login; end if;
  if to_regrole('app_admin') is null then create role app_admin login; end if;
end
$$;

alter role app_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role app_api login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '{{API_VERIFIER}}';
alter role app_worker login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '{{WORKER_VERIFIER}}';
alter role app_backup login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '{{BACKUP_VERIFIER}}';
alter role app_admin login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '{{ADMIN_VERIFIER}}';

grant app_owner to app_api with inherit true, set true;
grant app_owner to app_worker with inherit true, set true;
grant app_owner to app_admin with inherit true, set true;
grant pg_monitor to app_worker;
grant pg_read_all_data to app_backup;

do $$
begin
  execute format('alter database %I owner to app_owner', current_database());
  execute format('revoke connect, temporary on database %I from public', current_database());
  execute format('grant connect on database %I to app_api, app_worker, app_backup, app_admin', current_database());
end
$$;
alter schema public owner to app_owner;

alter role app_api set role = 'app_owner';
alter role app_api set statement_timeout = '2s';
alter role app_worker set role = 'app_owner';
alter role app_worker set statement_timeout = 0;
alter role app_backup set default_transaction_read_only = on;
alter role app_backup set statement_timeout = 0;
alter role app_admin set role = 'app_owner';
alter role app_admin set statement_timeout = '2s';

-- OPS-db-settings (PC9-03). shared_buffers needs a restart; the bootstrap redeploys postgres once.
alter system set log_error_verbosity = 'terse';                 -- no DETAIL lines with values (CTL-26)
alter system set log_min_error_statement = 'panic';             -- the failing statement's text is not logged
alter system set log_statement = 'none';                        -- no statement text in the server log
alter system set log_parameter_max_length_on_error = 0;         -- no bind parameter values on errors
alter system set log_connections = off;
alter system set log_disconnections = off;
alter system set idle_in_transaction_session_timeout = '5min';  -- a stuck transaction cannot hold locks for ever
alter system set shared_buffers = '512MB';
alter system set effective_cache_size = '2GB';
alter system set work_mem = '16MB';
alter system set maintenance_work_mem = '512MB';
select pg_reload_conf();
