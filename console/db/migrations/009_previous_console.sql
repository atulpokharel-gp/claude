-- Keeps the console version from before migrations 004-008 working against
-- this database, so a deploy can roll back by starting the older image
-- (docs/deploy.md). That version calls auth_check_session with one argument
-- and doesn't know about client viewers, so:
--  * the one-argument lookup is back, but never returns a client viewer (the
--    old console would give them the whole MSP) and honours a 4-hour idle limit;
--  * the old invite page would turn a client-viewer invite into a team
--    member, so adding a member is refused while that email only has a
--    pending viewer invite.

create function auth_check_session(p_token_hash bytea)
  returns table (user_id uuid, msp_id uuid, email text, msp_name text)
  language sql stable security definer set search_path = public
  as $$
    select u.id, u.msp_id, u.email, m.name
    from sessions s join users u on u.id = s.user_id join msps m on m.id = s.msp_id
    where s.token_hash = p_token_hash and s.expires_at > now()
      and s.last_seen_at > now() - interval '240 minutes'
      and u.role <> 'viewer'
  $$;
revoke all on function auth_check_session(bytea) from public;
grant execute on function auth_check_session(bytea) to zinloop_app;

create function users_no_viewer_as_member() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    if new.role = 'member'
       and exists (select 1 from invites i where i.msp_id = new.msp_id and i.email = new.email
                   and i.role = 'viewer' and i.accepted_at is null and i.expires_at > now())
       and not exists (select 1 from invites i where i.msp_id = new.msp_id and i.email = new.email
                   and i.role = 'member' and i.accepted_at is null and i.expires_at > now()) then
      raise exception 'This invite is for a client login, not the team.';
    end if;
    return new;
  end $$;
create trigger users_no_viewer_as_member before insert on users
  for each row execute function users_no_viewer_as_member();
