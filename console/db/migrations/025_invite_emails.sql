-- Email the invite link to the person being invited, through the same outbox
-- the alerts and weekly summaries already use. Until now an invite only showed
-- a link for the owner to copy and send by hand.
--
-- An invite email is different from the other mail:
--  * the invitee has no Zinloop account yet, so the row has no user_id;
--  * it's transactional, so it ignores the per-user alert/weekly preferences
--    and carries no unsubscribe link; and
--  * it belongs to the invite, not a user. Revoking the invite drops its
--    unsent email (ON DELETE CASCADE), and the sender skips an invite email
--    once the invite has been accepted or has expired.

alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check check (kind in ('alert', 'weekly', 'invite'));

-- Alert and weekly rows belong to a user (removing them drops their unsent
-- mail); an invite goes to someone who isn't a user yet.
alter table outbox alter column user_id drop not null;

-- Links an invite email to its invite so revoking the invite drops the email.
alter table outbox add column invite_id uuid references invites(id) on delete cascade;
