-- Paxel builder profiles.
--
-- Each Claude Code session is scored on five dimensions on the laptop
-- (steering, execution, engineering, product-instinct, planning). The
-- scanner uploads only the integer scores and a small bag of counter
-- metrics per (user_hash, project_hash, dimension, day). Raw text of the
-- developer's prompts or edits never leaves the device.
--
-- Three views sit on top of these rows:
--   * Private  — the signed-in console or portal page for one dev;
--   * Public   — an unauthenticated /p/{slug} URL, off by default, where
--                the developer opts into which dimensions to show;
--   * Company  — anonymous team aggregates (averages, no names).
--
-- Both tables are tenant-scoped (msp_id with forced RLS) and client-scoped
-- for the portal viewer via the pattern migration 005 defines.

create table paxel_profile_scores (
  id            uuid primary key default gen_random_uuid(),
  msp_id        uuid not null references msps(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  device_id     uuid not null references devices(id) on delete cascade,

  tool          text not null check (length(tool) between 1 and 32),

  user_hash     text not null check (user_hash ~ '^[0-9a-f]{16,64}$'),
  user_label    text not null default '' check (length(user_label) <= 120),

  project_hash  text not null check (project_hash ~ '^[0-9a-f]{16,64}$'),
  project_label text not null default '' check (length(project_label) <= 200),

  -- One of 'steering', 'execution', 'engineering', 'product-instinct', 'planning'.
  dimension     text not null check (dimension ~ '^[a-z-]{3,32}$'),
  bucket_day    date not null,

  score         integer not null check (score between 0 and 100),
  sessions      integer not null default 1 check (sessions >= 1),
  -- Small bag of raw counter metrics so the UI can show the signal breakdown.
  -- The scanner caps each key at a short integer; we also cap total size on
  -- insert through the ingest shape check.
  metrics       jsonb not null default '{}'::jsonb,

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create unique index paxel_profile_scores_bucket on paxel_profile_scores
  (device_id, tool, user_hash, project_hash, dimension, bucket_day);

create index paxel_profile_scores_user_day on paxel_profile_scores
  (msp_id, user_hash, bucket_day desc);
create index paxel_profile_scores_client_day on paxel_profile_scores
  (client_id, bucket_day desc);

alter table paxel_profile_scores enable row level security;
alter table paxel_profile_scores force row level security;

create policy tenant on paxel_profile_scores
  using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_scope on paxel_profile_scores as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null);
create policy viewer_no_delete on paxel_profile_scores as restrictive for delete to zinloop_app
  using (current_client() is null);

grant select, insert, update, delete on paxel_profile_scores to zinloop_app;


-- Per-user preferences: whether a public profile is on, under what slug,
-- and which dimensions it shows. One row per (msp_id, user_hash).
--
-- The slug is a short random id (14+ URL-safe chars) chosen by the UI; the
-- public page at /p/{slug} looks the row up without a session. The lookup
-- is through a SECURITY DEFINER function that returns only this row,
-- never any PII — it does not join to scans or scores. The score read is
-- done afterwards against paxel_profile_scores filtered by user_hash,
-- which lands in a tenant query (msp_id discovered from the pref row).

create table paxel_profile_prefs (
  msp_id        uuid not null references msps(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  user_hash     text not null check (user_hash ~ '^[0-9a-f]{16,64}$'),
  display_name  text not null default '' check (length(display_name) <= 120),
  public_slug   text unique check (public_slug is null or public_slug ~ '^[a-z0-9]{14,32}$'),
  -- Dimensions the public profile shows, in order. Each must be one of
  -- the known dimension slugs; the UI validates before writing. Empty
  -- array means the public URL exists but shows nothing until the dev
  -- toggles at least one dimension.
  public_dims   text[] not null default '{}'::text[],
  updated_at    timestamptz not null default now(),
  primary key (msp_id, user_hash)
);

create index paxel_profile_prefs_client on paxel_profile_prefs (client_id);

alter table paxel_profile_prefs enable row level security;
alter table paxel_profile_prefs force row level security;

create policy tenant on paxel_profile_prefs
  using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_scope on paxel_profile_prefs as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client());
-- A viewer may update prefs for their own client only.
create policy viewer_update on paxel_profile_prefs as restrictive for update to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null or client_id = current_client());
create policy viewer_insert on paxel_profile_prefs as restrictive for insert to zinloop_app
  with check (current_client() is null or client_id = current_client());
create policy viewer_no_delete on paxel_profile_prefs as restrictive for delete to zinloop_app
  using (current_client() is null);

grant select, insert, update, delete on paxel_profile_prefs to zinloop_app;


-- Public slug lookup. The unauthenticated /p/{slug} page calls this to
-- find out which (msp_id, user_hash) a slug maps to, plus the display
-- name and the dimension allow-list. No join, no PII. The caller then
-- opens a tenant transaction on that msp_id and reads scores filtered to
-- that user_hash and dimension list.
create function paxel_public_profile(slug text)
  returns table(
    msp_id uuid,
    client_id uuid,
    user_hash text,
    display_name text,
    public_dims text[]
  )
  language sql
  security definer
  stable
  as $$
    select msp_id, client_id, user_hash, display_name, public_dims
      from paxel_profile_prefs
      where public_slug = slug
        and public_slug is not null
        and array_length(public_dims, 1) is not null;
  $$;
revoke all on function paxel_public_profile(text) from public;
grant execute on function paxel_public_profile(text) to zinloop_app;
