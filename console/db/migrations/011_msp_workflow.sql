-- Strengthens the MSP workflow:
--   * a lower-trust "technician" team role whose remediations need approval;
--   * per-client policies (risk thresholds, auto-apply, blocked publishers,
--     scheduled report recipients);
--   * a remediation queue (propose -> approve -> apply, with an audit trail);
--   * per-client report schedules (weekly/monthly) picked up by a cron job;
--   * PSA integrations (ConnectWise Manage, Autotask PSA, HaloPSA) and tickets
--     opened once per high-risk finding;
--   * RMM integrations (NinjaOne, Datto RMM, ConnectWise Automate) and the
--     device links a sync fills in.
--
-- Every new tenant table has forced row-level security, carries msp_id, and the
-- restrictive viewer policies that migration 005 defines for its pattern, so a
-- client viewer never reaches another client's data.

-- 1. Technician team role. --------------------------------------------------
--
-- A technician can see every client and request a remediation, but every
-- action with real-world effect (revoking a Microsoft 365 app, pushing a
-- config change, inviting someone) still needs an owner or member to approve
-- it. The role sits between viewer (one client, read-only) and member
-- (everything but billing/team changes).

alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('owner', 'member', 'technician', 'viewer'));

alter table invites drop constraint invites_role_check;
alter table invites add constraint invites_role_check check (role in ('member', 'technician', 'viewer'));

-- 2. Client policies. --------------------------------------------------------

create table client_policies (
  client_id              uuid primary key references clients(id) on delete cascade,
  msp_id                 uuid not null references msps(id) on delete cascade,
  -- Lowest severity to open a PSA ticket for: 'high' means only high-risk.
  ticket_threshold       text not null default 'high' check (ticket_threshold in ('high', 'medium', 'low')),
  -- When true, approved remediations run as soon as they're approved.
  auto_apply_approved    boolean not null default true,
  -- Publishers whose M365 apps may never be revoked without a four-eyes approval,
  -- even on an auto-apply policy (allowlist). Lowercase, 50 entries max.
  allowed_publishers     text[] not null default '{}'::text[] check (array_length(allowed_publishers, 1) is null or array_length(allowed_publishers, 1) <= 50),
  -- Publishers that must always be revoked when seen, no approval needed (blocklist).
  blocked_publishers     text[] not null default '{}'::text[] check (array_length(blocked_publishers, 1) is null or array_length(blocked_publishers, 1) <= 50),
  -- Extra client contacts for scheduled reports (comma-separated emails is awkward in SQL;
  -- an array fits better and the app checks each one).
  report_recipients      text[] not null default '{}'::text[] check (array_length(report_recipients, 1) is null or array_length(report_recipients, 1) <= 20),
  -- Which PSA integration to open tickets through for this client. Null = none.
  psa_integration_id     uuid,
  -- Optional opaque identifier the PSA calls this client in its own system.
  psa_company_id         text not null default '' check (length(psa_company_id) <= 100),
  -- Which RMM integration to use for device inventory. Null = none.
  rmm_integration_id     uuid,
  -- Optional opaque RMM "organization" id.
  rmm_organization_id    text not null default '' check (length(rmm_organization_id) <= 100),
  updated_at             timestamptz not null default now()
);
create index client_policies_msp on client_policies (msp_id);

alter table client_policies enable row level security;
alter table client_policies force row level security;
create policy tenant on client_policies using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_scope on client_policies as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null);

-- 3. Remediations (approval workflow). --------------------------------------

create table remediations (
  id             uuid primary key default gen_random_uuid(),
  msp_id         uuid not null references msps(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  -- What the remediation does, machine-readable:
  --   revoke_m365_app   payload = { agentId, appName, publisher }
  --   rotate_secret     payload = { deviceId, keyName }
  --   custom            payload = { summary, notes }
  action         text not null check (action ~ '^[a-z0-9_]{1,64}$'),
  -- Opaque, bounded JSON parameters for the action.
  payload        jsonb not null default '{}'::jsonb,
  -- A short human description so the queue reads at a glance.
  summary        text not null check (length(summary) between 1 and 500),
  -- A finding key, when the remediation is for a specific finding (dedupe + link).
  finding_key    text not null default '' check (length(finding_key) <= 600),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied', 'failed', 'cancelled')),
  requested_by   uuid references users(id) on delete set null,
  requested_at   timestamptz not null default now(),
  decided_by     uuid references users(id) on delete set null,
  decided_at     timestamptz,
  applied_at     timestamptz,
  last_error     text not null default '' check (length(last_error) <= 500)
);
-- Stops two technicians from queueing the same fix twice while one is still pending.
create unique index remediations_pending on remediations (client_id, action, finding_key) where status = 'pending';
create index remediations_msp_status on remediations (msp_id, status, requested_at desc);
create index remediations_client on remediations (client_id, requested_at desc);

alter table remediations enable row level security;
alter table remediations force row level security;
create policy tenant on remediations using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_scope on remediations as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null);

-- 4. Scheduled reports. ------------------------------------------------------

create table report_schedules (
  id             uuid primary key default gen_random_uuid(),
  msp_id         uuid not null references msps(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  frequency      text not null check (frequency in ('weekly', 'monthly')),
  -- 0 = Sunday ... 6 = Saturday. For 'monthly' this is day-of-month 1..28.
  day_of_period  integer not null check (day_of_period between 0 and 28),
  -- Hour of day in UTC, 0..23.
  hour_utc       integer not null default 13 check (hour_utc between 0 and 23),
  -- Who to send to (team members or external contacts). An empty array means
  -- "team members with weekly_email on, plus the client's report_recipients".
  recipients     text[] not null default '{}'::text[] check (array_length(recipients, 1) is null or array_length(recipients, 1) <= 20),
  next_run_at    timestamptz not null,
  last_run_at    timestamptz,
  last_error     text not null default '' check (length(last_error) <= 500),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (client_id, frequency)
);
create index report_schedules_due on report_schedules (next_run_at) where active;

alter table report_schedules enable row level security;
alter table report_schedules force row level security;
create policy tenant on report_schedules using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_scope on report_schedules as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null);
-- The scheduler cron runs as the owner, across MSPs.
do $$ begin
  execute format('create policy owner_schedules on report_schedules for all to %I using (true) with check (true)', current_user);
  execute format('create policy owner_lookup on client_policies for select to %I using (true)', current_user);
end $$;

-- 5. PSA integrations. -------------------------------------------------------

create table psa_integrations (
  id             uuid primary key default gen_random_uuid(),
  msp_id         uuid not null references msps(id) on delete cascade,
  kind           text not null check (kind in ('connectwise', 'autotask', 'halopsa')),
  name           text not null check (length(name) between 1 and 200),
  base_url       text not null default '' check (length(base_url) <= 500),
  -- Credentials: the encrypted body contains vendor-specific fields (public_key,
  -- private_key, company_id, api_integrator, user_name, secret, client_id,
  -- client_secret, resource ...). See lib/psa.ts for each kind's shape.
  -- Decryption uses APP_SECRET.
  config_enc     text not null,
  -- 'live' makes real API calls; 'test' routes to the mock transport in lib/psa.ts.
  mode           text not null default 'test' check (mode in ('live', 'test')),
  active         boolean not null default true,
  last_check_at  timestamptz,
  last_error     text not null default '' check (length(last_error) <= 500),
  created_at     timestamptz not null default now()
);
create index psa_integrations_msp on psa_integrations (msp_id);

alter table psa_integrations enable row level security;
alter table psa_integrations force row level security;
create policy tenant on psa_integrations using (msp_id = current_msp()) with check (msp_id = current_msp());
-- Client viewers never see integrations.
create policy viewer_none on psa_integrations as restrictive to zinloop_app
  using (current_client() is null) with check (current_client() is null);

create table psa_tickets (
  id              uuid primary key default gen_random_uuid(),
  msp_id          uuid not null references msps(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  integration_id  uuid not null references psa_integrations(id) on delete cascade,
  finding_key     text not null check (length(finding_key) between 1 and 600),
  external_id     text not null default '' check (length(external_id) <= 200),
  summary         text not null check (length(summary) between 1 and 500),
  status          text not null default 'open' check (status in ('open', 'closed', 'failed')),
  last_error      text not null default '' check (length(last_error) <= 500),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  -- One ticket per finding at this client, so a repeat scan doesn't reopen it.
  unique (client_id, finding_key)
);
create index psa_tickets_msp on psa_tickets (msp_id, created_at desc);

alter table psa_tickets enable row level security;
alter table psa_tickets force row level security;
create policy tenant on psa_tickets using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_scope on psa_tickets as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null);

-- 6. RMM integrations. -------------------------------------------------------

create table rmm_integrations (
  id             uuid primary key default gen_random_uuid(),
  msp_id         uuid not null references msps(id) on delete cascade,
  kind           text not null check (kind in ('ninjaone', 'datto', 'automate')),
  name           text not null check (length(name) between 1 and 200),
  base_url       text not null default '' check (length(base_url) <= 500),
  config_enc     text not null,
  mode           text not null default 'test' check (mode in ('live', 'test')),
  active         boolean not null default true,
  last_sync_at   timestamptz,
  last_error     text not null default '' check (length(last_error) <= 500),
  created_at     timestamptz not null default now()
);
create index rmm_integrations_msp on rmm_integrations (msp_id);

alter table rmm_integrations enable row level security;
alter table rmm_integrations force row level security;
create policy tenant on rmm_integrations using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_none on rmm_integrations as restrictive to zinloop_app
  using (current_client() is null) with check (current_client() is null);

-- Device discoveries from an RMM; linked to a Zinloop device when hostnames match.
create table rmm_device_links (
  id             uuid primary key default gen_random_uuid(),
  msp_id         uuid not null references msps(id) on delete cascade,
  integration_id uuid not null references rmm_integrations(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  rmm_device_id  text not null check (length(rmm_device_id) between 1 and 200),
  hostname       text not null check (length(hostname) between 1 and 255),
  os             text not null default '' check (length(os) <= 50),
  -- Zinloop device, if a scan with the same hostname has arrived.
  device_id      uuid references devices(id) on delete set null,
  last_seen_at   timestamptz,
  tags           jsonb not null default '[]'::jsonb,
  unique (integration_id, rmm_device_id)
);
create index rmm_device_links_client on rmm_device_links (client_id);

alter table rmm_device_links enable row level security;
alter table rmm_device_links force row level security;
create policy tenant on rmm_device_links using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_scope on rmm_device_links as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null);

-- Keep foreign keys for client_policies to integrations consistent.
alter table client_policies
  add constraint client_policies_psa_fk foreign key (psa_integration_id) references psa_integrations(id) on delete set null,
  add constraint client_policies_rmm_fk foreign key (rmm_integration_id) references rmm_integrations(id) on delete set null;

-- Grants. --------------------------------------------------------------------

grant select, insert, update, delete on
  client_policies, remediations, report_schedules,
  psa_integrations, psa_tickets, rmm_integrations, rmm_device_links
  to zinloop_app;
