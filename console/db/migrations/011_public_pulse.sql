-- Public pulse counters for the free /check tool, visible at /live.
-- Only aggregate counts per day per bucket. No per-visitor data, no server
-- names, no key material. Written by SECURITY DEFINER so the app role can
-- bump counters without any wider access to this schema.

create table public_pulse (
  bucket text not null,
  day    date not null,
  count  bigint not null default 0,
  primary key (bucket, day)
);

-- Buckets fall into two families, both plain text so the view is easy to
-- read: "check_run" and "share_viewed" for totals, plus "grade:A".."grade:F"
-- for the share-link grade distribution.
create or replace function pulse_bump(p_bucket text, p_delta int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public_pulse(bucket, day, count)
  values (p_bucket, current_date, greatest(1, p_delta))
  on conflict (bucket, day) do update set count = public_pulse.count + excluded.count;
$$;

revoke all on function pulse_bump(text, int) from public;
grant execute on function pulse_bump(text, int) to zinloop_app;
grant select on public_pulse to zinloop_app;
