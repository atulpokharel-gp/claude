-- Client viewer logins: read-only accounts for someone at a client company,
-- who can see that one client's results and nothing else.
--
-- A viewer is a user with role 'viewer' and a client_id. When the app works for
-- a viewer it also sets app.client_id (see lib/db.ts), and the restrictive
-- policies below then hide every other client's rows and refuse any change to
-- client data, whatever the query says.

alter table users drop constraint users_role_check;
alter table users
  add column client_id uuid references clients(id) on delete cascade,
  add constraint users_role_check check (role in ('owner', 'member', 'viewer')),
  add constraint users_viewer_client check ((role = 'viewer') = (client_id is not null));

alter table invites
  add column role text not null default 'member' check (role in ('member', 'viewer')),
  add column client_id uuid references clients(id) on delete cascade,
  add constraint invites_viewer_client check ((role = 'viewer') = (client_id is not null));

create function current_client() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.client_id', true), '')::uuid $$;
grant execute on function current_client() to zinloop_app;

-- Restrictive policies are ANDed with the tenant policy. For a normal MSP
-- session current_client() is null and they change nothing.
create policy viewer_scope on clients as restrictive to zinloop_app
  using (current_client() is null or id = current_client())
  with check (current_client() is null);
create policy viewer_no_delete on clients as restrictive for delete to zinloop_app
  using (current_client() is null);

do $$
declare t text;
begin
  foreach t in array array['devices', 'scans', 'm365_tenants', 'risk_snapshots'] loop
    execute format(
      'create policy viewer_scope on %I as restrictive to zinloop_app
         using (current_client() is null or client_id = current_client())
         with check (current_client() is null)', t);
    execute format(
      'create policy viewer_no_delete on %I as restrictive for delete to zinloop_app
         using (current_client() is null)', t);
  end loop;
  -- Viewers never see upload tokens, invites or the audit log, and can't change team settings.
  foreach t in array array['upload_tokens', 'invites'] loop
    execute format(
      'create policy viewer_none on %I as restrictive to zinloop_app
         using (current_client() is null) with check (current_client() is null)', t);
  end loop;
end $$;

-- Viewers may add audit entries (their own sign-ins and password changes) but not read the log.
create policy viewer_no_read on audit_log as restrictive for select to zinloop_app
  using (current_client() is null);
create policy viewer_no_change on msps as restrictive for update to zinloop_app
  using (current_client() is null);
-- A viewer sees only accounts for their own client, and changes only those.
create policy viewer_scope on users as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null or client_id = current_client());

-- The session check now also says which client a viewer belongs to.
drop function auth_check_session(bytea, integer);
create function auth_check_session(p_token_hash bytea, p_idle_minutes integer)
  returns table (user_id uuid, msp_id uuid, email text, msp_name text, role text, mfa boolean, require_mfa boolean, session_id uuid, client_id uuid, client_name text)
  language plpgsql volatile security definer set search_path = public
  as $$
  begin
    update sessions s set last_seen_at = now()
      where s.token_hash = p_token_hash and s.expires_at > now()
        and s.last_seen_at > now() - make_interval(mins => p_idle_minutes)
        and s.last_seen_at < now() - interval '1 minute';
    return query
      select u.id, u.msp_id, u.email, m.name, u.role, u.totp_enabled_at is not null, m.require_mfa, s.id, u.client_id, c.name
      from sessions s join users u on u.id = s.user_id join msps m on m.id = s.msp_id
        left join clients c on c.id = u.client_id
      where s.token_hash = p_token_hash and s.expires_at > now()
        and s.last_seen_at > now() - make_interval(mins => p_idle_minutes);
  end $$;
revoke all on function auth_check_session(bytea, integer) from public;
grant execute on function auth_check_session(bytea, integer) to zinloop_app;

-- The invite check also says what the invite is for.
drop function invite_check(bytea);
create function invite_check(p_token_hash bytea)
  returns table (invite_id uuid, msp_id uuid, email text, msp_name text, role text, client_id uuid, client_name text)
  language sql stable security definer set search_path = public
  as $$
    select i.id, i.msp_id, i.email, m.name, i.role, i.client_id, c.name
    from invites i join msps m on m.id = i.msp_id left join clients c on c.id = i.client_id
    where i.token_hash = p_token_hash and i.accepted_at is null and i.expires_at > now()
  $$;
revoke all on function invite_check(bytea) from public;
grant execute on function invite_check(bytea) to zinloop_app;
