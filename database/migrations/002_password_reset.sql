-- Single-use password reset tokens. Tokens are stored hashed (sha256, the
-- same scheme as session tokens); the raw value only ever lives in the reset
-- link handed to the user.

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_user_idx on password_reset_tokens(user_id);
create index if not exists password_reset_tokens_expiry_idx on password_reset_tokens(expires_at);

-- Sweep consumed and expired reset tokens alongside sessions and rate limits.
create or replace function cleanup_expired_backend_state()
returns void
language plpgsql
as $$
begin
  delete from app_sessions where expires_at <= now();
  delete from rate_limits where reset_at <= now();
  delete from password_reset_tokens where expires_at <= now() or used_at is not null;
end;
$$;
