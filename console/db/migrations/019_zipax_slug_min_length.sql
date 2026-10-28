-- Zipax: let developers pick short, memorable slugs.
--
-- The initial Zipax profile schema (migration 014) locked public_slug to
-- 14-32 lowercase alphanumerics. That matched the random slug the server
-- auto-generates on first publish, but it blocks every username people
-- normally pick (atul, biotrust, apgp). Settings also had no slug input,
-- so the lock was invisible — the dev got a random 14-char string with no
-- way to change it.
--
-- This migration loosens the check constraint to {3,32}. Every existing
-- row satisfies the tighter {14,32} rule and is therefore valid under the
-- looser one, so no backfill is needed. The uniqueness constraint on the
-- column is untouched; collisions still fail cleanly.

alter table zipax_profile_prefs
  drop constraint if exists zipax_profile_prefs_public_slug_check;

alter table zipax_profile_prefs
  add constraint zipax_profile_prefs_public_slug_check
    check (public_slug is null or public_slug ~ '^[a-z0-9]{3,32}$');
