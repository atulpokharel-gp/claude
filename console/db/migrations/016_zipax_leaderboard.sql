-- Public leaderboard across tenants.
--
-- Lists only developers who opted into a public profile (a public_slug
-- plus at least one dimension in public_dims). Builder-profile averages
-- are computed over the latest N days per (msp_id, user_hash, dimension),
-- then filtered to the public dim set. No cost, no tokens, no projects,
-- no messages — only what the dev already chose to publish on /p/{slug}.
--
-- Runs cross-tenant via SECURITY DEFINER so the unauthenticated
-- /leaderboard page can read it without a tenant transaction. The
-- function returns at most $2 rows and refuses an out-of-range window.

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
