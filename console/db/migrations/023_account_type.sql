-- Account type on each tenant: "individual" (someone who signed up with a free
-- or consumer mailbox like gmail/outlook/yahoo) vs "organization" (a company
-- domain). It's derived from the sign-up email in lib/email-kind.ts and stored
-- here. Existing accounts default to organization.
alter table msps
  add column account_type text not null default 'organization'
    check (account_type in ('individual', 'organization'));

-- Surface it in the super-admin companies list. RETURNS TABLE changes shape, so
-- the function has to be dropped and recreated (create or replace can't widen it).
drop function if exists superadmin_companies();
create function superadmin_companies()
  returns table (id uuid, name text, plan text, account_type text, created_at timestamptz, users bigint, devices bigint, last_scan_at timestamptz)
  language sql stable security definer set search_path = public as $$
    select m.id, m.name, m.plan, m.account_type, m.created_at,
      (select count(*) from users u where u.msp_id = m.id),
      (select count(*) from devices d where d.msp_id = m.id),
      (select max(d.last_scan_at) from devices d where d.msp_id = m.id)
    from msps m
    order by m.created_at desc
  $$;
revoke all on function superadmin_companies() from public;
grant execute on function superadmin_companies() to zinloop_app;
