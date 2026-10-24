-- When each background job last ran, so the health check can say when
-- maintenance, email delivery or backups have stopped working.

create table job_runs (
  job         text primary key check (job ~ '^[a-z0-9_:-]{1,64}$'),
  last_ok_at  timestamptz,
  last_err_at timestamptz,
  last_error  text not null default '' check (length(last_error) <= 500)
);
-- Not tenant data. Only the owner (scripts) writes it; the app reads it through job_health().
alter table job_runs enable row level security;
alter table job_runs force row level security;
do $$
begin
  execute format('create policy owner_all on job_runs for all to %I using (true) with check (true)', current_user);
end $$;

create function job_health()
  returns table (job text, last_ok_at timestamptz, last_err_at timestamptz)
  language sql stable security definer set search_path = public
  as $$ select job, last_ok_at, last_err_at from job_runs $$;
revoke all on function job_health() from public;
grant execute on function job_health() to zinloop_app;
