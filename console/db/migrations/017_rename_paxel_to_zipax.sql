-- Rename "Paxel" to "Zipax" everywhere user-visible: tables, indexes, primary
-- keys, and the SECURITY DEFINER functions the console calls by name.
--
-- All renames are ALTER-based so existing rows survive. No data is copied,
-- dropped, or re-hashed. Row-level security policies and grants ride along
-- with the table on a rename (Postgres tracks them by OID, not name).
--
-- Note: this migration deliberately does NOT change the sha256 domain-separator
-- bytes the scanner uses when it computes `user_hash` and `project_hash`
-- ("paxel-user\x00..." / "paxel-project\x00..."). Those stay as-is in the Go
-- code so a laptop that has been uploading under Paxel keeps producing the
-- same hashes and its rows keep deduping with the historical table.

-- --- tables ---------------------------------------------------------------

alter table paxel_usage_events   rename to zipax_usage_events;
alter table paxel_profile_scores rename to zipax_profile_scores;
alter table paxel_profile_prefs  rename to zipax_profile_prefs;
alter table paxel_user_claims    rename to zipax_user_claims;

-- --- indexes --------------------------------------------------------------

alter index paxel_usage_events_bucket     rename to zipax_usage_events_bucket;
alter index paxel_usage_events_msp_day    rename to zipax_usage_events_msp_day;
alter index paxel_usage_events_client_day rename to zipax_usage_events_client_day;
alter index paxel_usage_events_user_day   rename to zipax_usage_events_user_day;
alter index paxel_usage_events_project    rename to zipax_usage_events_project;

alter index paxel_profile_scores_bucket     rename to zipax_profile_scores_bucket;
alter index paxel_profile_scores_user_day   rename to zipax_profile_scores_user_day;
alter index paxel_profile_scores_client_day rename to zipax_profile_scores_client_day;

alter index paxel_profile_prefs_client rename to zipax_profile_prefs_client;

alter index paxel_user_claims_client rename to zipax_user_claims_client;

-- --- primary-key constraints (auto-named <table>_pkey by Postgres) --------

alter index paxel_profile_prefs_pkey rename to zipax_profile_prefs_pkey;
alter index paxel_user_claims_pkey   rename to zipax_user_claims_pkey;

-- --- functions ------------------------------------------------------------
--
-- A function body is stored as text and keeps its original table references,
-- so after the rename above the old bodies would still work. We recreate
-- them under their new names so the TS code can call them by the new name,
-- and drop the old names in the same migration — there is no transitional
-- period where both names resolve.

drop function if exists paxel_public_profile(text);
drop function if exists paxel_resolve_claim(bytea);
drop function if exists paxel_public_leaderboard(integer, integer);

create function zipax_public_profile(slug text)
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
      from zipax_profile_prefs
      where public_slug = slug
        and public_slug is not null
        and array_length(public_dims, 1) is not null;
  $$;
revoke all on function zipax_public_profile(text) from public;
grant execute on function zipax_public_profile(text) to zinloop_app;

create function zipax_resolve_claim(h bytea)
  returns table(msp_id uuid, client_id uuid, user_hash text)
  language sql
  security definer
  stable
  as $$
    select msp_id, client_id, user_hash
      from zipax_user_claims
      where claim_hash = h;
  $$;
revoke all on function zipax_resolve_claim(bytea) from public;
grant execute on function zipax_resolve_claim(bytea) to zinloop_app;

create function zipax_public_leaderboard(window_days integer default 30, max_rows integer default 200)
  returns table (
    msp_id uuid,
    client_id uuid,
    user_hash text,
    display_name text,
    public_slug text,
    public_dims text[],
    dim_scores jsonb,
    mean_score integer,
    sessions_counted integer
  )
  language sql
  security definer
  stable
  as $$
    with
      capped as (
        select greatest(1, least(window_days, 365)) as days,
               greatest(1, least(max_rows, 500))    as rows
      ),
      prefs as (
        select msp_id, client_id, user_hash, display_name, public_slug, public_dims
          from zipax_profile_prefs
          where public_slug is not null
            and array_length(public_dims, 1) is not null
            and array_length(public_dims, 1) > 0
      ),
      scores as (
        select s.msp_id, s.user_hash, s.dimension,
               avg(s.score)::numeric as score,
               sum(s.sessions)       as sessions
          from zipax_profile_scores s, capped
          where s.bucket_day >= (current_date - make_interval(days => capped.days))
          group by s.msp_id, s.user_hash, s.dimension
      ),
      per_user as (
        select p.msp_id, p.client_id, p.user_hash, p.display_name, p.public_slug, p.public_dims,
               (
                 select coalesce(jsonb_object_agg(sc.dimension, round(sc.score)::int), '{}'::jsonb)
                   from scores sc
                   where sc.msp_id = p.msp_id and sc.user_hash = p.user_hash
                     and sc.dimension = any(p.public_dims)
               ) as dim_scores,
               coalesce(
                 (
                   select round(avg(sc.score))::int
                     from scores sc
                     where sc.msp_id = p.msp_id and sc.user_hash = p.user_hash
                       and sc.dimension = any(p.public_dims)
                 ),
                 0
               ) as mean_score,
               coalesce(
                 (
                   select sum(sc.sessions)::int
                     from scores sc
                     where sc.msp_id = p.msp_id and sc.user_hash = p.user_hash
                       and sc.dimension = any(p.public_dims)
                 ),
                 0
               ) as sessions_counted
          from prefs p
      )
    select msp_id, client_id, user_hash, display_name, public_slug, public_dims,
           dim_scores, mean_score, sessions_counted
      from per_user, capped
      where sessions_counted > 0
      order by mean_score desc, sessions_counted desc, user_hash asc
      limit (select rows from capped);
  $$;
revoke all on function zipax_public_leaderboard(integer, integer) from public;
grant execute on function zipax_public_leaderboard(integer, integer) to zinloop_app;
