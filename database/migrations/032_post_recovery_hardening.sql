-- Harden the recovery/state-machine guarantees introduced in migration 031.
--
-- 1. repair compact result metadata without unsafe casts or scored-turn joins;
-- 2. serialize timer-window mutation on the debate row before locking a turn;
-- 3. keep timer start timestamps based on the database clock after lock waits.

-- First trust a valid persisted payload value, independently of whether scored
-- turn rows still exist. Malformed legacy JSON is ignored rather than aborting
-- the migration.
update solo_debates
set performance_score = case
      when coalesce(result_payload->>'performanceScore', '') ~ '^\\d{1,3}$'
        then greatest(0, least(100, (result_payload->>'performanceScore')::integer))
      else performance_score
    end,
    bonus_xp = case
      when coalesce(result_payload->>'bonusXP', '') ~ '^\\d{1,9}$'
        then greatest(0, (result_payload->>'bonusXP')::integer)
      else bonus_xp
    end
where status = 'completed'
  and result_payload is not null;

-- Only derive performance from turns when a valid compact/payload value is
-- still unavailable.
with scored as (
  select
    debate_id,
    greatest(
      0,
      least(
        100,
        round((avg(turn_score)::numeric / 50) * 100)::integer
      )
    ) as derived_performance
  from solo_debate_turns
  where turn_score is not null
  group by debate_id
)
update solo_debates d
set performance_score = s.derived_performance
from scored s
where d.id = s.debate_id
  and d.status = 'completed'
  and d.performance_score is null;

create or replace function start_solo_turn_window(
  p_debate_id uuid,
  p_user_id uuid,
  p_turn_id uuid,
  p_mode text,
  p_limit_seconds integer
)
returns jsonb
language plpgsql
as $$
declare
  v_started timestamptz;
  v_expires timestamptz;
  v_now timestamptz;
  v_remaining integer;
  v_finalization_token uuid;
  v_turn solo_debate_turns%rowtype;
begin
  if p_mode not in ('text', 'speech', 'rapid-rebuttal', 'prepared-speech') then
    raise exception 'unknown debate mode';
  end if;

  perform clear_stale_solo_finalization(p_debate_id, p_user_id, 300);

  -- Debate -> turn is the canonical lock order for solo state transitions.
  -- Holding this row lock prevents Finish from claiming finalization after the
  -- timer path has checked the barrier but before it mutates the turn.
  select finalization_token
  into v_finalization_token
  from solo_debates
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
  for update;

  if not found or v_finalization_token is not null then
    return null;
  end if;

  select *
  into v_turn
  from solo_debate_turns
  where id = p_turn_id
    and debate_id = p_debate_id
    and user_message is null
    and round_number = (
      select max(latest.round_number)
      from solo_debate_turns latest
      where latest.debate_id = p_debate_id
    )
  for update;

  if not found or v_turn.staged_user_message is not null then
    return null;
  end if;

  -- A lock wait must not consume the user's response allowance.
  v_now := clock_timestamp();

  if p_mode = 'text' then
    update solo_debate_turns
    set response_mode = 'text',
        response_window_started_at = null,
        response_window_expires_at = null
    where id = p_turn_id;

    return jsonb_build_object(
      'modeId', 'text',
      'startedAt', null,
      'expiresAt', null,
      'remainingSeconds', null,
      'expired', false
    );
  end if;

  if p_limit_seconds is null or p_limit_seconds <= 0 or p_limit_seconds > 3600 then
    raise exception 'invalid response-window limit';
  end if;

  select
    (response_windows->p_mode->>'startedAt')::timestamptz,
    (response_windows->p_mode->>'expiresAt')::timestamptz
  into v_started, v_expires
  from solo_debate_turns
  where id = p_turn_id
    and response_windows ? p_mode;

  if v_started is null or v_expires is null then
    v_started := v_now;
    v_expires := v_started + make_interval(secs => p_limit_seconds);

    update solo_debate_turns
    set response_windows = jsonb_set(
          response_windows,
          array[p_mode],
          jsonb_build_object('startedAt', v_started, 'expiresAt', v_expires),
          true
        )
    where id = p_turn_id;
  end if;

  update solo_debate_turns
  set response_mode = p_mode,
      response_window_started_at = v_started,
      response_window_expires_at = v_expires
  where id = p_turn_id;

  v_remaining := greatest(0, ceil(extract(epoch from (v_expires - clock_timestamp())))::integer);

  return jsonb_build_object(
    'modeId', p_mode,
    'startedAt', v_started,
    'expiresAt', v_expires,
    'remainingSeconds', v_remaining,
    'expired', v_remaining <= 0
  );
end;
$$;
