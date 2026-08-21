-- Atomic distributed rate limiting. A single round-trip that creates or
-- advances the window and returns the resulting count + reset time.
-- Replaces the read-then-write pattern in src/lib/rateLimit.ts, which
-- undercounts when two serverless instances read the same row concurrently.

create or replace function public.increment_rate_limit(p_key text, p_window_ms integer)
returns table (new_count integer, new_reset_at timestamptz)
language sql
as $$
  insert into public.rate_limits (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update
    set count = case when public.rate_limits.reset_at <= now() then 1 else public.rate_limits.count + 1 end,
        reset_at = case
          when public.rate_limits.reset_at <= now() then now() + make_interval(secs => p_window_ms / 1000.0)
          else public.rate_limits.reset_at end
  returning public.rate_limits.count, public.rate_limits.reset_at;
$$;

revoke all on function public.increment_rate_limit(text, integer) from anon, authenticated;
grant execute on function public.increment_rate_limit(text, integer) to service_role;
