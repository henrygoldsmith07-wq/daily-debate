-- Durable, retry-safe solo debate finalization.
--
-- Expensive summary/evaluation work happens outside the transaction, but a
-- short-lived claim prevents two requests doing it at the same time. The final
-- commit then updates debate state + profile rewards atomically and stores the
-- exact result payload so a lost HTTP response can be replayed safely.

alter table solo_debates
  add column if not exists result_payload jsonb,
  add column if not exists finalization_token uuid,
  add column if not exists finalization_started_at timestamptz;

create or replace function claim_solo_debate_finalization(
  p_debate_id uuid,
  p_user_id uuid,
  p_token uuid,
  p_stale_after_seconds integer default 180
)
returns boolean
language plpgsql
as $$
declare
  affected integer := 0;
begin
  update solo_debates
  set finalization_token = p_token,
      finalization_started_at = now()
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
    and (
      finalization_started_at is null
      or finalization_started_at < now() - make_interval(secs => greatest(p_stale_after_seconds, 30))
    );

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function release_solo_debate_finalization(
  p_debate_id uuid,
  p_user_id uuid,
  p_token uuid
)
returns boolean
language plpgsql
as $$
declare
  affected integer := 0;
begin
  update solo_debates
  set finalization_token = null,
      finalization_started_at = null
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
    and finalization_token = p_token;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function finalize_solo_debate(
  p_debate_id uuid,
  p_user_id uuid,
  p_token uuid,
  p_total_score integer,
  p_bonus_xp integer,
  p_points_per_level integer,
  p_activity_date date,
  p_completed_at timestamptz,
  p_coaching jsonb,
  p_result_payload jsonb,
  p_has_retest boolean,
  p_repair_result_id uuid,
  p_retest_observable boolean,
  p_retest_demonstrated boolean
)
returns boolean
language plpgsql
as $$
declare
  next_streak integer;
  affected integer := 0;
  retest_affected integer := 0;
begin
  -- Lock the debate first so only the active claimant can commit rewards.
  perform 1
  from solo_debates
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
    and finalization_token = p_token
  for update;

  if not found then
    return false;
  end if;

  select case
    when last_activity_date = p_activity_date then current_streak
    when last_activity_date = p_activity_date - 1 then current_streak + 1
    else 1
  end
  into next_streak
  from profiles
  where id = p_user_id
  for update;

  if next_streak is null then
    raise exception 'profile not found for solo debate finalization';
  end if;

  update profiles
  set total_points = total_points + p_total_score + p_bonus_xp,
      level = floor((total_points + p_total_score + p_bonus_xp) / greatest(p_points_per_level, 1)) + 1,
      current_streak = next_streak,
      longest_streak = greatest(longest_streak, next_streak),
      last_activity_date = p_activity_date
  where id = p_user_id;

  if p_has_retest then
    update repair_retests
    set completed_at = p_completed_at,
        observable = p_retest_observable,
        demonstrated = p_retest_demonstrated,
        updated_at = now()
    where user_id = p_user_id
      and assigned_debate_id = p_debate_id
      and (p_repair_result_id is null or repair_result_id = p_repair_result_id);

    get diagnostics retest_affected = row_count;

    -- A deliberate retest is durable state, not telemetry. If its assignment
    -- row disappeared, abort the whole completion rather than marking the
    -- debate complete without its learning-loop outcome.
    if retest_affected = 0 then
      raise exception 'repair retest assignment not found during solo finalization';
    end if;
  end if;

  update solo_debates
  set status = 'completed',
      total_score = p_total_score,
      completed_at = p_completed_at,
      coaching = p_coaching,
      result_payload = p_result_payload,
      finalization_token = null,
      finalization_started_at = null
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
    and finalization_token = p_token;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;
