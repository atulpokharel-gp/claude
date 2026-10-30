-- "Forgot password": a single-use, expiring reset link emailed to the address.
-- Mirrors the invites design: the link holds a random token and only its hash
-- is stored. The reset email goes through the same outbox as everything else.

create table password_resets (
  id          uuid primary key default gen_random_uuid(),
  msp_id      uuid not null references msps(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  bytea not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
alter table password_resets enable row level security;
alter table password_resets force row level security;
create policy tenant on password_resets using (msp_id = current_msp()) with check (msp_id = current_msp());

-- The token lookup and cleanup run as the owner, across tenants (the person
-- isn't signed in yet, so there's no current_msp).
do $$
begin
  execute format('create policy owner_lookup on password_resets for select to %I using (true)', current_user);
  execute format('create policy owner_cleanup on password_resets for delete to %I using (true)', current_user);
end $$;
grant select, insert, update, delete on password_resets to zinloop_app;

-- What a reset link is for, if it's still valid. Returns the account's current
-- email and MSP name so the reset page can show whose password it changes.
create function reset_check(p_token_hash bytea)
  returns table (reset_id uuid, user_id uuid, msp_id uuid, email text, msp_name text)
  language sql stable security definer set search_path = public
  as $$
    select r.id, r.user_id, r.msp_id, u.email, m.name
    from password_resets r join users u on u.id = r.user_id join msps m on m.id = r.msp_id
    where r.token_hash = p_token_hash and r.used_at is null and r.expires_at > now()
  $$;
revoke all on function reset_check(bytea) from public;
grant execute on function reset_check(bytea) to zinloop_app;

-- The reset email is transactional like an invite: it ignores the alert/weekly
-- preferences, carries no unsubscribe link, and is dropped once the reset is
-- used, expired or superseded (ON DELETE CASCADE from password_resets).
alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check check (kind in ('alert', 'weekly', 'invite', 'reset'));
alter table outbox add column reset_id uuid references password_resets(id) on delete cascade;
