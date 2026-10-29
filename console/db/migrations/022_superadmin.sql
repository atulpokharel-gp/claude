-- Platform super-admin: one or more operator accounts that sit ABOVE all MSP
-- tenants. Unlike users (which belong to an msp and are confined by row-level
-- security), a super-admin can see across every company for an operations
-- dashboard: companies, users, sign-ups, totals.
--
-- The table carries no msp_id and is NOT reachable by the tenant app role
-- directly: RLS is forced with no permissive policy, so zinloop_app can only go
-- through the SECURITY DEFINER functions below. Those functions expose metadata
-- only (names, emails, roles, counts, dates) — never passwords, tokens, or
-- scan contents.

create table platform_admins (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (position('@' in email) > 1 and email = lower(email)),
  password_hash text not null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

alter table platform_admins enable row level security;
alter table platform_admins force row level security;
-- No policy granted to zinloop_app: the tenant role cannot read or write this
-- table at all. Only the table owner (migrations, the create-superadmin script)
-- and the definer functions below touch it.
revoke all on platform_admins from public;

-- ---- Auth (credential lookup + login timestamp) ----
create function superadmin_by_email(p_email text)
  returns table (id uuid, email text, password_hash text)
  language sql stable security definer set search_path = public as $$
    select id, email, password_hash from platform_admins where email = lower(p_email)
  $$;

create function superadmin_by_id(p_id uuid)
  returns table (id uuid, email text, last_login_at timestamptz)
  language sql stable security definer set search_path = public as $$
    select id, email, last_login_at from platform_admins where id = p_id
  $$;

create function superadmin_touch_login(p_id uuid)
  returns void language sql volatile security definer set search_path = public as $$
    update platform_admins set last_login_at = now() where id = p_id
  $$;

-- ---- Cross-tenant read models for the dashboard ----
create function superadmin_stats()
  returns table (companies bigint, users bigint, devices bigint, scans bigint, signups_30d bigint, new_companies_30d bigint)
  language sql stable security definer set search_path = public as $$
    select
      (select count(*) from msps),
      (select count(*) from users),
      (select count(*) from devices),
      (select count(*) from scans),
      (select count(*) from users where created_at > now() - interval '30 days'),
      (select count(*) from msps  where created_at > now() - interval '30 days')
  $$;

create function superadmin_companies()
  returns table (id uuid, name text, plan text, created_at timestamptz, users bigint, devices bigint, last_scan_at timestamptz)
  language sql stable security definer set search_path = public as $$
    select m.id, m.name, m.plan, m.created_at,
      (select count(*) from users u where u.msp_id = m.id),
      (select count(*) from devices d where d.msp_id = m.id),
      (select max(d.last_scan_at) from devices d where d.msp_id = m.id)
    from msps m
    order by m.created_at desc
  $$;

create function superadmin_users(p_limit int default 500)
  returns table (id uuid, email text, name text, role text, msp_id uuid, company text, created_at timestamptz)
  language sql stable security definer set search_path = public as $$
    select u.id, u.email, u.name, u.role, u.msp_id, m.name, u.created_at
    from users u join msps m on m.id = u.msp_id
    order by u.created_at desc
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
  $$;

create function superadmin_registrations(p_days int default 30)
  returns table (day date, users bigint, companies bigint)
  language sql stable security definer set search_path = public as $$
    select g::date,
      (select count(*) from users u where u.created_at::date = g::date),
      (select count(*) from msps  m where m.created_at::date = g::date)
    from generate_series((now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365))))::date, now()::date, interval '1 day') g
    order by g
  $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'superadmin_by_email(text)', 'superadmin_by_id(uuid)', 'superadmin_touch_login(uuid)',
    'superadmin_stats()', 'superadmin_companies()', 'superadmin_users(int)', 'superadmin_registrations(int)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to zinloop_app', fn);
  end loop;
end $$;
