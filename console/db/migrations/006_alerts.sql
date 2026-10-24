-- Email alerts for new high-risk AI tools, and a weekly summary.
--
-- Emails are written to an outbox in the same transaction as whatever caused
-- them, and a separate job (npm run mail:send) delivers them with retries, so
-- a slow or broken mail server never fails a scan upload.

alter table users
  add column alert_emails boolean not null default true,
  add column weekly_email boolean not null default true;

-- High-risk findings already alerted on, per client, so each is emailed once.
create table seen_findings (
  client_id  uuid not null references clients(id) on delete cascade,
  msp_id     uuid not null references msps(id) on delete cascade,
  key        text not null check (length(key) <= 600),
  first_seen timestamptz not null default now(),
  primary key (client_id, key)
);
create index seen_findings_msp_first on seen_findings (msp_id, first_seen);

create table outbox (
  id          bigint generated always as identity primary key,
  msp_id      uuid not null references msps(id) on delete cascade,
  -- One email per (kind, subject of the email, recipient); a repeat insert is ignored.
  dedupe_key  text not null unique check (length(dedupe_key) <= 300),
  kind        text not null check (kind in ('alert', 'weekly')),
  to_email    text not null check (length(to_email) <= 320),
  subject     text not null check (length(subject) <= 300),
  body_text   text not null,
  body_html   text not null,
  -- For the List-Unsubscribe header; empty when APP_SECRET isn't set.
  unsubscribe_url text not null default '',
  created_at  timestamptz not null default now(),
  next_try_at timestamptz not null default now(),
  attempts    integer not null default 0,
  sent_at     timestamptz,
  last_error  text
);
create index outbox_pending on outbox (next_try_at) where sent_at is null;

do $$
declare t text;
begin
  foreach t in array array['seen_findings', 'outbox'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant on %I using (msp_id = current_msp()) with check (msp_id = current_msp())', t);
    -- Client viewers never see either.
    execute format('create policy viewer_none on %I as restrictive to zinloop_app
                      using (current_client() is null) with check (current_client() is null)', t);
  end loop;
  -- The mail sender runs as the owner, across MSPs; so does email_unsubscribe.
  execute format('create policy owner_send on outbox for all to %I using (true) with check (true)', current_user);
  execute format('create policy owner_unsubscribe on users for update to %I using (true) with check (true)', current_user);
end $$;

-- The app adds emails and alert records; it never edits or deletes sent mail.
grant select, insert on seen_findings, outbox to zinloop_app;

-- Unsubscribe links work without signing in: they carry a signed user id, and
-- this turns one kind of email off for that user only.
create function email_unsubscribe(p_user_id uuid, p_kind text)
  returns text
  language plpgsql volatile security definer set search_path = public
  as $$
  declare addr text;
  begin
    if p_kind = 'alert' then
      update users set alert_emails = false where id = p_user_id returning email into addr;
    elsif p_kind = 'weekly' then
      update users set weekly_email = false where id = p_user_id returning email into addr;
    end if;
    return addr;
  end $$;
revoke all on function email_unsubscribe(uuid, text) from public;
grant execute on function email_unsubscribe(uuid, text) to zinloop_app;
