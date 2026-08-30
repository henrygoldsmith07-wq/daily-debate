-- Google sign-in (Auth.js).
--
-- An account can now be reached two ways — email+password, or Google — but
-- there is still exactly one app_users row behind either, so every debate,
-- match and skill-ledger entry keeps its owner. Signing in with Google using
-- the address of an existing password account LINKS the two rather than
-- creating a second, empty account.
--
-- All additive. Existing rows keep their password hash and get NULL Google
-- columns, which is precisely "this account has no Google link yet".

-- A Google-only account has no password to store.
alter table app_users alter column password_hash drop not null;

-- Google's stable subject claim. Preferred over email when matching, because
-- it survives the user changing the address on their Google account.
alter table app_users add column if not exists google_sub text;
alter table app_users add column if not exists name text;
alter table app_users add column if not exists image text;

-- One Google identity may back at most one account.
create unique index if not exists app_users_google_sub_idx on app_users (google_sub);

-- app_sessions is no longer read or written: Auth.js keeps the session in a
-- signed JWT cookie instead of an opaque database token. The table is left in
-- place so this migration is reversible and a rollback still finds it.
-- Existing rows are inert — everyone signs in again once after deploy.
comment on table app_sessions is
  'Unused since the Auth.js migration; sessions are JWT cookies. Safe to drop.';
