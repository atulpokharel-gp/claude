-- Audit log, session controls (idle timeout, list and end sessions) and an
-- MSP-wide "require two-factor sign-in" setting.

create table audit_log (
  id          bigint generated always as identity primary key,
  msp_id      uuid not null references msps(id) on delete cascade,
  at          timestamptz not null default now(),
  user_id     uuid references users(id) on delete set null,
  -- Kept as text so the entry still says who acted after they're removed.
  actor_email text not null default '' check (length(actor_email) <= 320),
  action      text not null check (action ~ '^[a-z0-9_]{1,64}$'),
  target      text not null default '' check (length(target) <= 500),
  detail      jsonb not null default '{}',
  ip          text not null default '' check (length(ip) <= 64)
);
create index audit_log_msp_at on audit_log (msp_id, at desc);

alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy tenant on audit_log using (msp_id = current_msp()) with check (msp_id = current_msp());
-- The app can add entries and read them, never change or delete them.
grant select, insert on audit_log to zinloop_app;

alter table sessions
  add column id uuid not null default gen_random_uuid(),
  add column last_seen_at timestamptz not null default now(),
  add column ip text not null default '' check (length(ip) <= 64),
  add column user_agent text not null default '' check (length(user_agent) <= 300);
create unique index sessions_id on sessions (id);

alter table msps add column require_mfa boolean not null default false;

-- Sessions now also end after SESSION_IDLE_MINUTES without use, and each check
-- records when the session was last used (at most once a minute).
drop function auth_check_session(bytea);
create function auth_check_session(p_token_hash bytea, p_idle_minutes integer)
  returns table (user_id uuid, msp_id uuid, email text, msp_name text, role text, mfa boolean, require_mfa boolean, session_id uuid)
  language plpgsql volatile security definer set search_path = public
  as $$
  begin
    update sessions s set last_seen_at = now()
      where s.token_hash = p_token_hash and s.expires_at > now()
        and s.last_seen_at > now() - make_interval(mins => p_idle_minutes)
        and s.last_seen_at < now() - interval '1 minute';
    return query
      select u.id, u.msp_id, u.email, m.name, u.role, u.totp_enabled_at is not null, m.require_mfa, s.id
      from sessions s join users u on u.id = s.user_id join msps m on m.id = s.msp_id
      where s.token_hash = p_token_hash and s.expires_at > now()
        and s.last_seen_at > now() - make_interval(mins => p_idle_minutes);
  end $$;

-- auth_check_session runs as the owner and now updates sessions; RLS applies to it too.
do $$
begin
  execute format('create policy owner_touch on sessions for update to %I using (true) with check (true)', current_user);
  execute format('create policy owner_cleanup on audit_log for delete to %I using (true)', current_user);
end $$;

revoke all on function auth_check_session(bytea, integer) from public;
grant execute on function auth_check_session(bytea, integer) to zinloop_app;
