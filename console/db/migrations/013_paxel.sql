-- Paxel: AI coding habits profiler.
--
-- Records how many LLM tokens each developer burned, split by AI coding tool
-- (Claude Code, Codex, Aider, Cursor, Copilot) and by project. The scanner
-- reads each tool's local session logs on the laptop, aggregates by
-- (tool, project, model, user, day) and uploads the counts. No prompts, no
-- generated code, no file paths past a hashed project id and the project's
-- folder name — only numbers and tool/model/project labels.
--
-- Rows are tenant-scoped like every other table: msp_id, forced RLS,
-- restrictive viewer policies via the pattern migration 005 defines.
--
-- Dedupe is per (device_id, tool, session_id, bucket_day). The scanner may
-- re-upload the same day's bucket as more usage lands (common case: it runs
-- daily and the current day's bucket keeps growing). On conflict we take the
-- larger counts, so a late-arriving upload with fewer rows cannot regress
-- today's number.

create table paxel_usage_events (
  id                 uuid primary key default gen_random_uuid(),
  msp_id             uuid not null references msps(id) on delete cascade,
  client_id          uuid not null references clients(id) on delete cascade,
  device_id          uuid not null references devices(id) on delete cascade,

  -- Which AI coding tool: 'claude-code', 'codex', 'aider', 'cursor', 'copilot'.
  tool               text not null check (length(tool) between 1 and 32),

  -- A hex-encoded hash of the OS user name on the device plus the device
  -- hostname. We never see the real user name. The scanner computes it the
  -- same way every run so the same person on the same laptop merges.
  user_hash          text not null check (user_hash ~ '^[0-9a-f]{16,64}$'),

  -- A short display label the person recognizes: usually the project
  -- folder's basename. 1-120 chars, trimmed by the scanner.
  user_label         text not null default '' check (length(user_label) <= 120),

  -- Hex hash of the project's absolute path on the device.
  project_hash       text not null check (project_hash ~ '^[0-9a-f]{16,64}$'),
  project_label      text not null default '' check (length(project_label) <= 200),

  -- Model as reported by the tool, free text (e.g. "claude-opus-4-7",
  -- "gpt-5-codex"). Trimmed to 80 chars. Empty when the tool didn't say.
  model              text not null default '' check (length(model) <= 80),

  -- The day this bucket covers, in UTC.
  bucket_day         date not null,

  -- Session id as reported by the tool, truncated to 80 chars. Lets us
  -- dedupe within a day when the same session is re-uploaded. Empty for
  -- tools that don't expose one; a short synthetic id ("day-only") is then
  -- used so the unique index still holds.
  session_id         text not null default '' check (length(session_id) <= 80),

  input_tokens       bigint not null default 0 check (input_tokens >= 0),
  output_tokens      bigint not null default 0 check (output_tokens >= 0),
  cache_read_tokens  bigint not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),

  -- Estimated cost in US cents (integer). The scanner knows the pricing
  -- table for Anthropic/OpenAI models; it writes 0 for unknown models.
  cost_usd_cents     bigint not null default 0 check (cost_usd_cents >= 0),

  -- How many assistant messages this bucket covers.
  messages           integer not null default 0 check (messages >= 0),

  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);

-- One row per (device, tool, user, project, model, day, session). On upload
-- conflict, keep the larger counts (see store.ts).
create unique index paxel_usage_events_bucket on paxel_usage_events
  (device_id, tool, user_hash, project_hash, model, bucket_day, session_id);

create index paxel_usage_events_msp_day on paxel_usage_events
  (msp_id, bucket_day desc);
create index paxel_usage_events_client_day on paxel_usage_events
  (client_id, bucket_day desc);
create index paxel_usage_events_user_day on paxel_usage_events
  (msp_id, user_hash, bucket_day desc);
create index paxel_usage_events_project on paxel_usage_events
  (msp_id, project_hash, bucket_day desc);

alter table paxel_usage_events enable row level security;
alter table paxel_usage_events force row level security;

-- Tenant isolation: every row must match the signed-in MSP, and client
-- viewers see only their own client's rows (same pattern as migration 005).
create policy tenant on paxel_usage_events
  using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_scope on paxel_usage_events as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null);
create policy viewer_no_delete on paxel_usage_events as restrictive for delete to zinloop_app
  using (current_client() is null);

grant select, insert, update, delete on paxel_usage_events to zinloop_app;
