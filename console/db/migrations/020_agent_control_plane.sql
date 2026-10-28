-- Agent Control Plane v1: all runtime data belongs to one MSP.
-- Console and API run as zinloop_app. Agent token lookup happens before the
-- tenant is known via a narrowly scoped SECURITY DEFINER function.

create table cp_enrollments (
 id uuid primary key default gen_random_uuid(),
 msp_id uuid not null references msps(id) on delete cascade,
 client_id uuid references clients(id) on delete cascade,
 label text not null default '',
 token_hash bytea not null unique,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table cp_agents (
 id uuid primary key default gen_random_uuid(),
 msp_id uuid not null references msps(id) on delete cascade,
 client_id uuid references clients(id) on delete set null,
 name text not null check(length(name) between 1 and 100),
 framework text not null default 'custom' check(length(framework)<=80),
 status text not null default 'online' check(status in ('online','disabled')),
 last_seen timestamptz not null default now(),
 created_at timestamptz not null default now(),
 unique(msp_id,name)
);
create table cp_agent_tokens (
 id uuid primary key default gen_random_uuid(),
 msp_id uuid not null references msps(id) on delete cascade,
 agent_id uuid not null references cp_agents(id) on delete cascade,
 token_hash bytea not null unique,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create table cp_controls (
 id uuid primary key default gen_random_uuid(),
 msp_id uuid not null references msps(id) on delete cascade,
 agent_id uuid references cp_agents(id) on delete cascade,
 name text not null check(length(name) between 1 and 120),
 phase text not null check(phase in ('input','output','tool','all')),
 evaluator text not null check(evaluator in ('pii','prompt_injection','regex','list','json','sql')),
 effect text not null check(effect in ('block','warn')),
 config jsonb not null default '{}'::jsonb,
 enabled boolean not null default true,
 created_at timestamptz not null default now()
);
create table cp_events (
 id bigint generated always as identity primary key,
 msp_id uuid not null references msps(id) on delete cascade,
 agent_id uuid not null references cp_agents(id) on delete cascade,
 control_id uuid references cp_controls(id) on delete set null,
 at timestamptz not null default now(),
 phase text not null check(phase in ('input','output','tool','budget','execution')),
 outcome text not null check(outcome in ('allow','block','warn','error')),
 rule text not null default '',
 reason text not null default '',
 task_id uuid,
 model text not null default '',
 cost_usd numeric(12,6) not null default 0
);
create index cp_events_recent on cp_events(msp_id,at desc);
create table cp_budgets (
 agent_id uuid primary key references cp_agents(id) on delete cascade,
 msp_id uuid not null references msps(id) on delete cascade,
 limit_usd numeric(12,6) not null default 5 check(limit_usd>=0),
 spent_usd numeric(12,6) not null default 0 check(spent_usd>=0),
 reserved_usd numeric(12,6) not null default 0 check(reserved_usd>=0),
 allowed_models text[] not null default '{}',
 preferred_model text not null default '',
 updated_at timestamptz not null default now()
);
create table cp_tasks (
 id uuid primary key default gen_random_uuid(),
 msp_id uuid not null references msps(id) on delete cascade,
 client_id uuid references clients(id) on delete set null,
 title text not null check(length(title) between 1 and 200),
 description text not null default '' check(length(description)<=2000),
 status text not null default 'queued' check(status in ('queued','claimed','done','failed')),
 assigned_agent_id uuid references cp_agents(id) on delete set null,
 claimed_at timestamptz,
 lease_until timestamptz,
 budget_usd numeric(12,6) not null default 1 check(budget_usd>=0),
 spent_usd numeric(12,6) not null default 0 check(spent_usd>=0),
 reserved_usd numeric(12,6) not null default 0 check(reserved_usd>=0),
 preferred_model text not null default '',
 created_at timestamptz not null default now()
);
create table cp_reservations (
 id uuid primary key default gen_random_uuid(),
 msp_id uuid not null references msps(id) on delete cascade,
 agent_id uuid not null references cp_agents(id) on delete cascade,
 task_id uuid references cp_tasks(id) on delete set null,
 amount_usd numeric(12,6) not null check(amount_usd > 0),
 actual_usd numeric(12,6),
 status text not null default 'active' check(status in ('active','completed','cancelled')),
 created_at timestamptz not null default now()
);
create table cp_messages (
 id bigint generated always as identity primary key,
 msp_id uuid not null references msps(id) on delete cascade,
 task_id uuid not null references cp_tasks(id) on delete cascade,
 agent_id uuid references cp_agents(id) on delete set null,
 sender text not null default 'agent' check(sender in ('agent','operator')),
 kind text not null default 'progress' check(kind in ('progress','handoff','result','question')),
 body text not null check(length(body) between 1 and 4000),
 at timestamptz not null default now()
);
create index cp_messages_task_at on cp_messages(msp_id,task_id,at);

do $$
declare t text;
begin
 foreach t in array array['cp_enrollments','cp_agents','cp_agent_tokens','cp_controls','cp_events','cp_budgets','cp_tasks','cp_reservations','cp_messages'] loop
  execute format('alter table %I enable row level security', t);
  execute format('alter table %I force row level security', t);
  execute format('create policy cp_tenant on %I using (msp_id = current_msp()) with check (msp_id = current_msp())', t);
  execute format('grant select,insert,update,delete on %I to zinloop_app', t);
 end loop;
end $$;

grant usage, select on sequence cp_events_id_seq, cp_messages_id_seq to zinloop_app;

-- Only the migration owner can lookup opaque bearer hashes before the tenant
-- is known. Unprivileged runtime APIs never pass an MSP id as trusted input.
do $$
begin
 execute format('create policy cp_owner_lookup on cp_enrollments for select to %I using (true)', current_user);
 execute format('create policy cp_owner_agent_lookup on cp_agents for select to %I using (true)', current_user);
 execute format('create policy cp_owner_token_lookup on cp_agent_tokens for select to %I using (true)', current_user);
end $$;
create function cp_lookup_enrollment(p_hash bytea)
returns table(msp_id uuid, client_id uuid)
language sql stable security definer set search_path = public
as $$
 select e.msp_id, e.client_id from cp_enrollments e
 where e.token_hash=p_hash and e.revoked_at is null and e.expires_at>now()
 limit 1
$$;
create function cp_lookup_agent(p_hash bytea)
returns table(msp_id uuid, agent_id uuid)
language sql stable security definer set search_path = public
as $$
 select t.msp_id,t.agent_id from cp_agent_tokens t
 join cp_agents a on a.id=t.agent_id
 where t.token_hash=p_hash and t.revoked_at is null and a.status='online'
 limit 1
$$;
revoke all on function cp_lookup_enrollment(bytea),cp_lookup_agent(bytea) from public;
grant execute on function cp_lookup_enrollment(bytea),cp_lookup_agent(bytea) to zinloop_app;
