-- Agent Guard console: first schema.
--
-- Every table that holds an MSP's data has an msp_id column and a row-level
-- security policy, so a query can only ever see the signed-in MSP's rows. The
-- app connects as agentguard_app, which owns nothing and can't bypass RLS. It
-- sets app.msp_id at the start of each transaction (see lib/db.ts).
--
-- The few lookups that must happen before we know the MSP (sign-in, session
-- check, scanner upload token) go through SECURITY DEFINER functions that
-- return only what the caller needs.

create table msps (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now()
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  msp_id        uuid not null references msps(id) on delete cascade,
  email         text not null check (email = lower(email) and length(email) <= 320),
  password_hash text not null,
  created_at    timestamptz not null default now()
);
create unique index users_email on users (email);

create table sessions (
  token_hash bytea primary key,
  user_id    uuid not null references users(id) on delete cascade,
  msp_id     uuid not null references msps(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_expires on sessions (expires_at);

create table clients (
  id               uuid primary key default gen_random_uuid(),
  msp_id           uuid not null references msps(id) on delete cascade,
  name             text not null check (length(name) between 1 and 200),
  industry         text not null default '' check (length(industry) <= 200),
  staff            integer not null default 0 check (staff >= 0),
  devices_expected integer not null default 0 check (devices_expected >= 0),
  created_at       timestamptz not null default now()
);
create index clients_msp on clients (msp_id);

-- Tokens laptops use to send scans for one client. Only a hash is stored; the
-- token itself is shown once when it's created.
create table upload_tokens (
  id         uuid primary key default gen_random_uuid(),
  msp_id     uuid not null references msps(id) on delete cascade,
  client_id  uuid not null references clients(id) on delete cascade,
  token_hash bytea not null unique,
  label      text not null default '' check (length(label) <= 200),
  created_at timestamptz not null default now(),
  last_used  timestamptz,
  revoked_at timestamptz
);

create table devices (
  id           uuid primary key default gen_random_uuid(),
  msp_id       uuid not null references msps(id) on delete cascade,
  client_id    uuid not null references clients(id) on delete cascade,
  hostname     text not null check (length(hostname) between 1 and 255),
  os           text not null default '' check (length(os) <= 50),
  first_seen   timestamptz not null default now(),
  last_scan_at timestamptz,
  unique (client_id, hostname)
);

create table scans (
  id          uuid primary key default gen_random_uuid(),
  msp_id      uuid not null references msps(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  device_id   uuid not null references devices(id) on delete cascade,
  received_at timestamptz not null default now(),
  scanned_at  timestamptz not null,
  report      jsonb not null
);
create index scans_device_latest on scans (device_id, received_at desc);

-- Row-level security on every tenant table.
do $$
declare t text;
begin
  foreach t in array array['msps', 'users', 'sessions', 'clients', 'upload_tokens', 'devices', 'scans'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

create function current_msp() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.msp_id', true), '')::uuid $$;

create policy tenant on msps using (id = current_msp()) with check (id = current_msp());
do $$
declare t text;
begin
  foreach t in array array['users', 'sessions', 'clients', 'upload_tokens', 'devices', 'scans'] loop
    execute format('create policy tenant on %I using (msp_id = current_msp()) with check (msp_id = current_msp())', t);
  end loop;
end $$;

-- Pre-tenant lookups. Each returns the minimum and is safe to call by anyone
-- holding the app role.
create function auth_find_user(p_email text)
  returns table (user_id uuid, msp_id uuid, password_hash text)
  language sql stable security definer set search_path = public
  as $$ select id, msp_id, password_hash from users where email = lower(p_email) $$;

create function auth_check_session(p_token_hash bytea)
  returns table (user_id uuid, msp_id uuid, email text, msp_name text)
  language sql stable security definer set search_path = public
  as $$
    select u.id, u.msp_id, u.email, m.name
    from sessions s join users u on u.id = s.user_id join msps m on m.id = s.msp_id
    where s.token_hash = p_token_hash and s.expires_at > now()
  $$;

create function upload_check_token(p_token_hash bytea)
  returns table (client_id uuid, msp_id uuid)
  language sql security definer set search_path = public
  as $$
    update upload_tokens set last_used = now()
    where token_hash = p_token_hash and revoked_at is null
    returning client_id, msp_id
  $$;

-- The app role. Created without login here; the deploy sets its password.
do $$
begin
  if not exists (select from pg_roles where rolname = 'agentguard_app') then
    create role agentguard_app nologin;
  end if;
end $$;
grant usage on schema public to agentguard_app;
grant select, insert, update, delete on msps, users, sessions, clients, upload_tokens, devices, scans to agentguard_app;
revoke all on function auth_find_user(text), auth_check_session(bytea), upload_check_token(bytea) from public;
grant execute on function current_msp(), auth_find_user(text), auth_check_session(bytea), upload_check_token(bytea) to agentguard_app;
