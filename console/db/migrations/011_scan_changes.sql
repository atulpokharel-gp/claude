-- Per-scan version history: what changed on this device since its last scan.
-- Each incoming scan writes one row here with the delta. The row makes the
-- "what's new today" view fast (no re-diffing jsonb on every page view) and
-- gives the change-alert path a durable record for dedupe and audit.

create table scan_changes (
  id            uuid primary key default gen_random_uuid(),
  msp_id        uuid not null references msps(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  device_id     uuid not null references devices(id) on delete cascade,
  scan_id       uuid not null references scans(id) on delete cascade,
  prev_scan_id  uuid references scans(id) on delete set null,
  at            timestamptz not null default now(),
  added         integer not null default 0 check (added >= 0),
  removed       integer not null default 0 check (removed >= 0),
  changed       integer not null default 0 check (changed >= 0),
  risk_up       integer not null default 0 check (risk_up >= 0),
  risk_down     integer not null default 0 check (risk_down >= 0),
  returned      integer not null default 0 check (returned >= 0),
  delta         jsonb not null
);
create unique index scan_changes_scan on scan_changes (scan_id);
create index scan_changes_device_latest on scan_changes (device_id, at desc);
create index scan_changes_client_recent on scan_changes (client_id, at desc);

alter table scan_changes enable row level security;
alter table scan_changes force row level security;
create policy tenant on scan_changes using (msp_id = current_msp()) with check (msp_id = current_msp());

grant select, insert, update, delete on scan_changes to zinloop_app;
