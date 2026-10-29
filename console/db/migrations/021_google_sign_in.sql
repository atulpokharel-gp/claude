-- Sign in with Google. A second identity provider on user_identities, alongside
-- Microsoft. A Zinloop user links their Google account once (while signed in);
-- after that, that account signs them in.
--
-- Google accounts are matched on the OpenID Connect `sub` claim, which is stable
-- and can't be chosen by the user. We store `sub` in object_id and a constant
-- sentinel 'google' in tenant_id, so the existing (provider, tenant_id,
-- object_id) uniqueness and the auth_find_identity() lookup keep working without
-- change. Email is never used to match accounts (it can change, and a verified
-- email can still be reassigned), only shown as the label.

-- Replace the Microsoft-only CHECK constraints with provider-aware ones. The
-- original checks were declared inline, so drop whichever constraints mention
-- provider/tenant_id/object_id (leaving the label-length check in place).
do $$
declare c record;
begin
  for c in
    select con.conname, pg_get_constraintdef(con.oid) as def
    from pg_constraint con
    join pg_class t on t.oid = con.conrelid
    where t.relname = 'user_identities' and con.contype = 'c'
  loop
    if c.def ~ '(provider|tenant_id|object_id)' then
      execute format('alter table user_identities drop constraint %I', c.conname);
    end if;
  end loop;
end $$;

alter table user_identities
  add constraint user_identities_provider_check check (provider in ('microsoft', 'google')),
  add constraint user_identities_shape_check check (
    case provider
      when 'microsoft' then tenant_id ~ '^[0-9a-f-]{36}$' and object_id ~ '^[0-9a-f-]{36}$'
      when 'google'    then tenant_id = 'google' and object_id ~ '^[0-9]{1,40}$'
      else false
    end
  );

-- auth_find_identity() already filters on (provider, tenant_id, object_id) with
-- lower(), which works unchanged for Google: tenant_id 'google', object_id the
-- numeric sub. No function change is needed.
