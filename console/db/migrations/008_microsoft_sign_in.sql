-- Sign in with Microsoft. A Zinloop user links their Microsoft work account
-- once (while signed in); after that, that account signs them in.
--
-- The account is identified by its tenant ID and object ID, which never change
-- and can't be chosen by the user. Email addresses are not used to match
-- accounts: in Microsoft Entra the email claim can be set by a tenant's admin
-- to any address, so matching on it would let another tenant take over an
-- account.

create table user_identities (
  user_id    uuid not null references users(id) on delete cascade,
  msp_id     uuid not null references msps(id) on delete cascade,
  provider   text not null check (provider in ('microsoft')),
  tenant_id  text not null check (tenant_id ~ '^[0-9a-f-]{36}$'),
  object_id  text not null check (object_id ~ '^[0-9a-f-]{36}$'),
  -- What to show in settings. Never used for matching.
  label      text not null default '' check (length(label) <= 320),
  created_at timestamptz not null default now(),
  primary key (user_id, provider),
  unique (provider, tenant_id, object_id)
);

alter table user_identities enable row level security;
alter table user_identities force row level security;
create policy tenant on user_identities using (msp_id = current_msp()) with check (msp_id = current_msp());
-- Client viewers only see and link their own client's accounts (users are already limited for them).
create policy viewer_scope on user_identities as restrictive to zinloop_app
  using (current_client() is null or user_id in (select id from users))
  with check (current_client() is null or user_id in (select id from users));
grant select, insert, delete on user_identities to zinloop_app;

-- Before sign-in: which Zinloop user a Microsoft account belongs to.
create function auth_find_identity(p_provider text, p_tenant_id text, p_object_id text)
  returns table (user_id uuid, msp_id uuid, email text, mfa boolean)
  language sql stable security definer set search_path = public
  as $$
    select u.id, u.msp_id, u.email, u.totp_enabled_at is not null
    from user_identities i join users u on u.id = i.user_id
    where i.provider = p_provider and i.tenant_id = lower(p_tenant_id) and i.object_id = lower(p_object_id)
  $$;
do $$
begin
  execute format('create policy owner_lookup on user_identities for select to %I using (true)', current_user);
end $$;
revoke all on function auth_find_identity(text, text, text) from public;
grant execute on function auth_find_identity(text, text, text) to zinloop_app;
