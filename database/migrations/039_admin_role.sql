-- Admin role binding (additive).
--
-- WHY THIS EXISTS
-- The admin gate used to be a single string comparison between the request's
-- email and the CORPUS_ADMIN_EMAILS environment allowlist. That made the
-- allowlist SELF-CLAIMABLE:
--
--   * `app_users.email` is asserted by the person signing up, and this
--     codebase has no email-verification flow at all;
--   * `app_users.email` is UNIQUE, so registering an allowlisted address
--     that did not yet have an account conferred admin over every corpus,
--     ops and analytics surface in the product — and simultaneously locked
--     the legitimate administrator out, because their address could no
--     longer be registered.
--
-- Admin is now bound to a DATABASE ROLE. Only an operator with database
-- access can grant it (scripts/set-admin.mjs), so self-registration can
-- never confer it and no request body can set it. The env allowlist stays
-- as a second, independent factor: both must hold, so an operator can also
-- revoke access without a database round-trip.
--
-- This migration is additive. The column has a constant default of false, so
-- a new build against an old schema (and an old build against the new one)
-- keeps working; accounts are granted the role out of band.

alter table app_users
  add column if not exists is_admin boolean not null default false;

create index if not exists app_users_admin_idx
  on app_users (id) where is_admin;

-- Append-only record of who granted or revoked the role, when, and why.
create table if not exists admin_role_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  email text not null,
  action text not null check (action in ('grant', 'revoke')),
  actor text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists admin_role_grants_user_idx
  on admin_role_grants (user_id, created_at desc);
