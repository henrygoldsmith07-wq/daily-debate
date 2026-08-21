-- Distributed rate limiting: replaces process-local Map with a table that
-- every serverless instance can read, so limits are global before serious
-- public use (PvP expansion). Upsert + expiry keeps it small.

create table if not exists public.rate_limits (
  key text primary key,
  count integer not null default 1,
  reset_at timestamptz not null
);

-- Allow service role (API routes use service client for this check) to
-- read/write. Authenticated users don't need direct access.
alter table public.rate_limits enable row level security;

-- No RLS policies needed: accessed only via service-role client.
-- Periodic cleanup: removes expired windows. Run via cron or on prune.
create or replace function public.cleanup_rate_limits()
returns void
language plpgsql
as $$
begin
  delete from public.rate_limits where reset_at < now();
end;
$$;
