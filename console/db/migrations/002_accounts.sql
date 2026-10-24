-- Self-serve sign-up, plans, team invites, two-factor sign-in, rate limits,
-- Microsoft 365 connections and cleanup.

alter table msps
  add column plan text not null default 'free' check (plan in ('free', 'partner', 'msp')),
  add column client_estimate integer not null default 0 check (client_estimate >= 0),
  add column wants_partner boolean not null default false;

alter table users
  add column name text not null default '' check (length(name) <= 200),
  add column role text not null default 'member' check (role in ('owner', 'member')),
  -- The authenticator secret, encrypted with APP_SECRET (see lib/crypto.ts).
  add column totp_secret text,
  add column totp_enabled_at timestamptz,
  -- Last 30-second step accepted, so one code can't be used twice.
  add column totp_last_step bigint not null default 0;

-- Accounts made before this migration were made by hand for the founding user.
update users set role = 'owner';

-- Team invites. The link holds a random token; only its hash is stored.
create table invites (
  id          uuid primary key default gen_random_uuid(),
  msp_id      uuid not null references msps(id) on delete cascade,
  email       text not null check (email = lower(email) and length(email) <= 320),
  token_hash  bytea not null unique,
  invited_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_at timestamptz
);
alter table invites enable row level security;
alter table invites force row level security;
create policy tenant on invites using (msp_id = current_msp()) with check (msp_id = current_msp());

-- A client's Microsoft 365 tenant, connected through admin consent.
create table m365_tenants (
  client_id    uuid primary key references clients(id) on delete cascade,
  msp_id       uuid not null references msps(id) on delete cascade,
  tenant_id    text not null check (tenant_id ~ '^[0-9a-fA-F-]{36}$'),
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error   text,
  apps         jsonb not null default '[]'
);
alter table m365_tenants enable row level security;
alter table m365_tenants force row level security;
create policy tenant on m365_tenants using (msp_id = current_msp()) with check (msp_id = current_msp());

-- Attempts counted by rate_limit_hit. Not tenant data; only the function touches it.
create table rate_limits (
  key text not null,
  at  timestamptz not null default now()
);
create index rate_limits_key_at on rate_limits (key, at);
alter table rate_limits enable row level security;
alter table rate_limits force row level security;

-- Sign-in now also says whether the user has two-factor sign-in turned on.
drop function auth_find_user(text);
create function auth_find_user(p_email text)
  returns table (user_id uuid, msp_id uuid, password_hash text, mfa boolean)
  language sql stable security definer set search_path = public
  as $$ select id, msp_id, password_hash, totp_enabled_at is not null from users where email = lower(p_email) $$;

-- Records one attempt for p_key and says whether it is still within p_max
-- attempts in the last p_window_seconds.
create function rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
  returns boolean
  language plpgsql security definer set search_path = public
  as $$
  declare n integer;
  begin
    delete from rate_limits where key = p_key and at < now() - make_interval(secs => p_window_seconds);
    insert into rate_limits (key) values (p_key);
    select count(*) into n from rate_limits where key = p_key;
    return n <= p_max;
  end $$;

-- What an invite link is for, if it's still valid.
create function invite_check(p_token_hash bytea)
  returns table (invite_id uuid, msp_id uuid, email text, msp_name text)
  language sql stable security definer set search_path = public
  as $$
    select i.id, i.msp_id, i.email, m.name
    from invites i join msps m on m.id = i.msp_id
    where i.token_hash = p_token_hash and i.accepted_at is null and i.expires_at > now()
  $$;

-- Deletes expired sessions, invites and attempt records, and scans older than
-- p_keep_days except each device's newest one.
create function cleanup_expired(p_keep_days integer)
  returns table (sessions bigint, invites bigint, rate_limits bigint, scans bigint)
  language plpgsql security definer set search_path = public
  as $$
  declare s bigint; i bigint; r bigint; c bigint;
  begin
    delete from sessions where expires_at < now();
    get diagnostics s = row_count;
    delete from invites where expires_at < now() - interval '30 days';
    get diagnostics i = row_count;
    delete from rate_limits where at < now() - interval '1 day';
    get diagnostics r = row_count;
    delete from scans x
      where x.received_at < now() - make_interval(days => p_keep_days)
        and x.id <> (select y.id from scans y where y.device_id = x.device_id
                     order by y.scanned_at desc, y.received_at desc limit 1);
    get diagnostics c = row_count;
    return query select s, i, r, c;
  end $$;

-- The functions above run as the owner, which RLS also applies to.
do $$
begin
  execute format('create policy owner_lookup on invites for select to %I using (true)', current_user);
  execute format('create policy owner_all on rate_limits for all to %I using (true) with check (true)', current_user);
  execute format('create policy owner_cleanup on sessions for delete to %I using (true)', current_user);
  execute format('create policy owner_cleanup on invites for delete to %I using (true)', current_user);
  execute format('create policy owner_cleanup on scans for delete to %I using (true)', current_user);
  execute format('create policy owner_lookup on scans for select to %I using (true)', current_user);
  execute format('create policy owner_lookup on m365_tenants for select to %I using (true)', current_user);
end $$;

grant select, insert, update, delete on invites, m365_tenants to zinloop_app;
revoke all on function auth_find_user(text), rate_limit_hit(text, integer, integer), invite_check(bytea), cleanup_expired(integer) from public;
grant execute on function auth_find_user(text), rate_limit_hit(text, integer, integer), invite_check(bytea) to zinloop_app;
