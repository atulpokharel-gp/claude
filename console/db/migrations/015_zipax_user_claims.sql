-- Zipax per-developer identity claim.
--
-- Before this migration a client-portal viewer could edit any user_hash's
-- public-profile prefs scoped to their own client. That's wrong for a
-- "private per user" profile. The claim flow fixes it:
--
--   1. The scanner, on first `zinloop zipax` run, writes a per-device
--      claim token to a protected file (~/.zinloop/zipax-claim-token).
--   2. The scanner uploads the token alongside each run.
--   3. The console stores a hash of that token in zipax_user_claims keyed
--      by user_hash. On conflict the row re-binds to the latest device
--      upload — a reset moves the claim.
--   4. The developer visits /zipax/claim?token=<token>. The console
--      verifies the hash, then sets a signed cookie "zipax_dev" with
--      their (msp_id, user_hash). Only requests carrying that cookie
--      can save prefs for that user_hash.
--
-- The hash in storage uses the same sha256 scheme as upload_tokens so an
-- unauthenticated reader cannot replay the token.

create table zipax_user_claims (
  user_hash   text primary key check (user_hash ~ '^[0-9a-f]{16,64}$'),
  msp_id      uuid not null references msps(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  claim_hash  bytea not null unique,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz
);

create index zipax_user_claims_client on zipax_user_claims (client_id);

alter table zipax_user_claims enable row level security;
alter table zipax_user_claims force row level security;

-- Tenant and viewer policies.
create policy tenant on zipax_user_claims
  using (msp_id = current_msp()) with check (msp_id = current_msp());
create policy viewer_scope on zipax_user_claims as restrictive to zinloop_app
  using (current_client() is null or client_id = current_client())
  with check (current_client() is null);
create policy viewer_no_delete on zipax_user_claims as restrictive for delete to zinloop_app
  using (current_client() is null);

grant select, insert, update, delete on zipax_user_claims to zinloop_app;

-- Pre-tenant lookup for the /zipax/claim route: the token itself (hashed)
-- is the authenticator, so the function returns the (msp_id, client_id,
-- user_hash) a token hash maps to and nothing else. The caller then sets a
-- signed cookie binding that user_hash and may later check prefs edits
-- against it.
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
