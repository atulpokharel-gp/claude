-- Fix migration 019: it dropped the wrong-named constraint.
--
-- The original slug check was created inline by migration 014 as part of
-- the paxel_profile_prefs table definition, so Postgres named it
-- paxel_profile_prefs_public_slug_check. Migration 017 renamed the table
-- to zipax_profile_prefs but constraint names ride along by OID, so the
-- check kept its paxel_* name. Migration 019 then issued
--     drop constraint if exists zipax_profile_prefs_public_slug_check
-- which silently did nothing, and added a new {3,32}-char check next to
-- the old {14,32}-char one. Both constraints are therefore enforced on
-- prod today — the effective rule is still {14,32}, which blocks every
-- short custom slug the UI advertises as valid.
--
-- Drop the stale paxel-named constraint. The {3,32}-char zipax-named
-- check added in 019 remains and is the single source of truth from
-- here on. Every existing row still satisfies it (nothing in the table
-- was shorter than 14 chars before), so no backfill is needed.

alter table zipax_profile_prefs
  drop constraint if exists paxel_profile_prefs_public_slug_check;
