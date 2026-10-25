-- Daily change-alert digests send one email per client per day. If a second
-- device uploads changes later the same day, those rows can't go in another
-- email (dedupe) and the 24h window closes before the next upload, so they
-- used to drop silently. Track per-row whether a digest has already covered
-- the row; a later run picks up still-uncovered rows regardless of age.
alter table scan_changes add column notified_at timestamptz;
create index scan_changes_pending_alerts
  on scan_changes (client_id, at)
  where notified_at is null;
