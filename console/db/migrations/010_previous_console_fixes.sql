-- Two fixes to the compatibility layer from 009, found in review:
--  * the old invite page marks the invite accepted before it adds the user,
--    so the trigger also counts an invite accepted in the same transaction
--    (accepted_at = now(), the transaction's start time) as still pending;
--  * the old console's session lookup now refreshes last_seen_at like the
--    current one does, so active users aren't signed out after 4 hours.

create or replace function users_no_viewer_as_member() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    if new.role = 'member'
       and exists (select 1 from invites i where i.msp_id = new.msp_id and i.email = new.email and i.role = 'viewer'
                   and ((i.accepted_at is null and i.expires_at > now()) or i.accepted_at = now()))
       and not exists (select 1 from invites i where i.msp_id = new.msp_id and i.email = new.email and i.role = 'member'
                   and ((i.accepted_at is null and i.expires_at > now()) or i.accepted_at = now())) then
      raise exception 'This invite is for a client login, not the team.';
    end if;
    return new;
  end $$;

create or replace function auth_check_session(p_token_hash bytea)
  returns table (user_id uuid, msp_id uuid, email text, msp_name text)
  language plpgsql volatile security definer set search_path = public
  as $$
  begin
    update sessions s set last_seen_at = now()
      from users u
      where s.token_hash = p_token_hash and s.expires_at > now()
        and u.id = s.user_id and u.role <> 'viewer'
        and s.last_seen_at > now() - interval '240 minutes'
        and s.last_seen_at < now() - interval '1 minute';
    return query
      select u.id, u.msp_id, u.email, m.name
      from sessions s join users u on u.id = s.user_id join msps m on m.id = s.msp_id
      where s.token_hash = p_token_hash and s.expires_at > now()
        and s.last_seen_at > now() - interval '240 minutes'
        and u.role <> 'viewer';
  end $$;
