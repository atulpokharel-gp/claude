-- Zipax public-profile privacy controls.
--
-- Before this migration a developer who published a Zipax profile had two
-- knobs: the slug (profile is public yes/no) and the dimension allow-list
-- (which of the five scores show on /p/{slug} and the leaderboard). The
-- public leaderboard listed every published developer automatically, their
-- display name was always visible, and the sessions count and overall
-- score were always shown. The dev had no way to opt out of the
-- leaderboard while keeping /p/{slug}, no way to publish without their
-- display name, and no way to hide the sessions or overall columns.
--
-- This migration adds four per-user toggles so the dev picks exactly what
-- shows publicly: whether they appear on the leaderboard, whether their
-- display name is shown (versus an anonymous label), whether the overall
-- mean score is shown, and whether the sessions count is shown.
--
-- Defaults: leaderboard_opt_in is false for every new row (private by
-- default), the three "show_*" toggles default to true so the publish
-- experience with every toggle untouched looks the same as it did before.
-- To keep already-published developers on the leaderboard across the
-- rollout we backfill leaderboard_opt_in = true for the rows that would
-- have appeared on the pre-migration leaderboard (slug set, non-empty
-- dim allow-list).

alter table zipax_profile_prefs
  add column leaderboard_opt_in boolean not null default false,
  add column show_display_name  boolean not null default true,
  add column show_mean_score    boolean not null default true,
  add column show_sessions      boolean not null default true;

-- Backfill: keep anyone who was already on the pre-018 leaderboard listed.
update zipax_profile_prefs
   set leaderboard_opt_in = true
 where public_slug is not null
   and array_length(public_dims, 1) is not null
   and array_length(public_dims, 1) > 0;

-- --- functions ------------------------------------------------------------
--
-- Both SECURITY DEFINER functions now return the new toggles alongside the
-- existing payload so the TS layer can enforce them on render. The lookup
-- still never joins to scans or scores: the function hands back the opt-in
-- fields; the score read happens afterwards inside a tenant transaction.

drop function if exists zipax_public_profile(text);

create function zipax_public_profile(slug text)
  returns table(
    msp_id uuid,
    client_id uuid,
    user_hash text,
    display_name text,
    public_dims text[],
    show_display_name boolean,
    show_mean_score boolean,
    show_sessions boolean
  )
  language sql
  security definer
  stable
  as $$
    select msp_id, client_id, user_hash, display_name, public_dims,
           show_display_name, show_mean_score, show_sessions
      from zipax_profile_prefs
      where public_slug = slug
        and public_slug is not null
        and array_length(public_dims, 1) is not null;
  $$;
revoke all on function zipax_public_profile(text) from public;
grant execute on function zipax_public_profile(text) to zinloop_app;


drop function if exists zipax_public_leaderboard(integer, integer);

-- The cross-tenant leaderboard. Only rows with leaderboard_opt_in = true
-- are returned. The row still carries the show_* toggles so the UI can
-- hide the overall and sessions columns per-row, and swap the display name
-- for an anonymous label when the dev has show_display_name = false.
create function zipax_public_leaderboard(window_days integer default 30, max_rows integer default 200)
  returns table (
    msp_id uuid,
    client_id uuid,
    user_hash text,
    display_name text,
    public_slug text,
    public_dims text[],
    show_display_name boolean,
    show_mean_score boolean,
    show_sessions boolean,
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
        select msp_id, client_id, user_hash, display_name, public_slug, public_dims,
               show_display_name, show_mean_score, show_sessions
          from zipax_profile_prefs
          where public_slug is not null
            and leaderboard_opt_in = true
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
               p.show_display_name, p.show_mean_score, p.show_sessions,
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
           show_display_name, show_mean_score, show_sessions,
           dim_scores, mean_score, sessions_counted
      from per_user, capped
      where sessions_counted > 0
      order by mean_score desc, sessions_counted desc, user_hash asc
      limit (select rows from capped);
  $$;
revoke all on function zipax_public_leaderboard(integer, integer) from public;
grant execute on function zipax_public_leaderboard(integer, integer) to zinloop_app;
