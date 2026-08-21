-- Atomic profile point awards. Read-modify-write from TypeScript
-- (total_points = profile.total_points + n) loses points when one player has
-- two matches finish concurrently. This RPC performs the increment and level
-- recompute in a single statement and returns the new total.
-- p_points_per_level is passed from src/lib/gamification.ts so the constant
-- cannot drift between SQL and TypeScript.

create or replace function public.increment_total_points(
  p_user_id uuid,
  p_points integer,
  p_points_per_level integer
)
returns integer
language sql
as $$
  update public.profiles
  set total_points = public.profiles.total_points + p_points,
      level = floor((public.profiles.total_points + p_points) / greatest(p_points_per_level, 1)) + 1
  where id = p_user_id
  returning public.profiles.total_points;
$$;

revoke all on function public.increment_total_points(uuid, integer, integer) from anon, authenticated;
grant execute on function public.increment_total_points(uuid, integer, integer) to service_role;
