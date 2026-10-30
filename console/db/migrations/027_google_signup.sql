-- Sign up with Google. An account created this way has no password: the owner
-- authenticates with Google (user_identities, migration 021) and can set a
-- password later with "Forgot password". So password_hash becomes nullable.
--
-- Password sign-in stays safe for these accounts: auth_find_user returns a null
-- hash and lib/auth.signIn compares against a dummy hash (constant time), so a
-- password attempt simply fails rather than erroring.
alter table users alter column password_hash drop not null;
