-- Daily risk counts per client, for the trend chart on the overview.
-- Written whenever a client's data changes and once a day by maintenance.

create table risk_snapshots (
  client_id uuid not null references clients(id) on delete cascade,
  msp_id    uuid not null references msps(id) on delete cascade,
  day       date not null,
  high      integer not null default 0 check (high >= 0),
  medium    integer not null default 0 check (medium >= 0),
  low       integer not null default 0 check (low >= 0),
  tools     integer not null default 0 check (tools >= 0),
  people    integer not null default 0 check (people >= 0),
  primary key (client_id, day)
);
create index risk_snapshots_msp_day on risk_snapshots (msp_id, day);

alter table risk_snapshots enable row level security;
alter table risk_snapshots force row level security;
create policy tenant on risk_snapshots using (msp_id = current_msp()) with check (msp_id = current_msp());

-- Maintenance lists clients (to snapshot each MSP) and trims old snapshots.
do $$
begin
  execute format('create policy owner_lookup on clients for select to %I using (true)', current_user);
  execute format('create policy owner_cleanup on risk_snapshots for delete to %I using (true)', current_user);
end $$;

grant select, insert, update, delete on risk_snapshots to zinloop_app;
