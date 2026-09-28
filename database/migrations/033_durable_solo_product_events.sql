-- Durable solo lifecycle analytics.
--
-- State-defining funnel events now commit in the same PostgreSQL transaction as
-- the solo state change they describe. HTTP/serverless telemetry is no longer
-- able to lose a round/debate/retest completion after the product state commits.
-- Partial unique indexes make replay/retry paths idempotent.

with ranked as (
  select
    id,
    row_number() over (
      partition by debate_id, name, round
      order by created_at asc, id asc
    ) as rn
  from product_events
  where debate_id is not null
    and round is not null
    and name = 'round_completed'
)
delete from product_events pe
using ranked r
where pe.id = r.id
  and r.rn > 1;

create unique index if not exists product_events_unique_round_completed
  on product_events(debate_id, name, round)
  where debate_id is not null
    and round is not null
    and name = 'round_completed';

with ranked as (
  select
    id,
    row_number() over (
      partition by debate_id, name
      order by created_at asc, id asc
    ) as rn
  from product_events
  where debate_id is not null
    and name in (
      'debate_completed',
      'retest_completed',
      'retest_skill_demonstrated'
    )
)
delete from product_events pe
using ranked r
where pe.id = r.id
  and r.rn > 1;

create unique index if not exists product_events_unique_completion_event
  on product_events(debate_id, name)
  where debate_id is not null
    and name in (
      'debate_completed',
      'retest_completed',
      'retest_skill_demonstrated'
    );

create or replace function finalize_solo_turn_submission(
  p_debate_id uuid,
  p_user_id uuid,
  p_turn_id uuid,
  p_token uuid,
  p_feedback text,
  p_next_round_number integer,
  p_next_ai_message text
)
returns jsonb
language plpgsql
as $$
declare
  v_turn solo_debate_turns%rowtype;
  v_next solo_debate_turns%rowtype;
  v_finalization_token uuid;
  v_format text;
  v_side text;
begin
  select finalization_token, format, side
  into v_finalization_token, v_format, v_side
  from solo_debates
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('saved', false, 'reason', 'debate-not-active');
  end if;

  if v_finalization_token is not null then
    return jsonb_build_object('saved', false, 'reason', 'debate-finalizing');
  end if;

  select *
  into v_turn
  from solo_debate_turns
  where id = p_turn_id
    and debate_id = p_debate_id
    and round_number = (
      select max(latest.round_number)
      from solo_debate_turns latest
      where latest.debate_id = p_debate_id
    )
  for update;

  if not found then
    return jsonb_build_object('saved', false, 'reason', 'stale-turn');
  end if;

  if v_turn.user_message is not null then
    return jsonb_build_object('saved', false, 'reason', 'already-answered');
  end if;

  if v_turn.submission_token is distinct from p_token
     or v_turn.staged_user_message is null then
    return jsonb_build_object('saved', false, 'reason', 'submission-claim-lost');
  end if;

  if p_next_round_number is not null then
    if p_next_round_number <> v_turn.round_number + 1 or p_next_ai_message is null then
      raise exception 'invalid next solo round';
    end if;

    insert into solo_debate_turns (debate_id, round_number, ai_message)
    values (p_debate_id, p_next_round_number, p_next_ai_message)
    returning * into v_next;
  end if;

  update solo_debate_turns
  set user_message = staged_user_message,
      input_mode = staged_input_mode,
      scores = staged_scores,
      turn_score = staged_turn_score,
      feedback = p_feedback,
      assessment = staged_assessment,
      training_meta = staged_training_meta,
      submission_token = null,
      submission_started_at = null,
      staged_user_message = null,
      staged_input_mode = null,
      staged_scores = null,
      staged_turn_score = null,
      staged_assessment = null,
      staged_training_meta = null,
      staged_mode = null,
      staged_submitted_at = null
  where id = p_turn_id
  returning * into v_turn;

  update solo_debates
  set round_count = coalesce(p_next_round_number, v_turn.round_number)
  where id = p_debate_id;

  insert into product_events (user_id, name, format, side, round, debate_id)
  values (
    p_user_id,
    'round_completed',
    v_format,
    v_side,
    v_turn.round_number,
    p_debate_id
  )
  on conflict do nothing;

  return jsonb_build_object(
    'saved', true,
    'reason', 'saved',
    'completedTurn', to_jsonb(v_turn),
    'nextTurn', case when v_next.id is null then null else to_jsonb(v_next) end
  );
end;
$$;

create or replace function commit_staged_solo_turn_for_finish(
  p_debate_id uuid,
  p_user_id uuid,
  p_turn_id uuid,
  p_min_rounds integer,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
as $$
declare
  v_turn solo_debate_turns%rowtype;
  v_finalization_token uuid;
  v_now timestamptz := clock_timestamp();
  v_format text;
  v_side text;
begin
  perform clear_stale_solo_finalization(p_debate_id, p_user_id, p_stale_after_seconds);

  select finalization_token, format, side
  into v_finalization_token, v_format, v_side
  from solo_debates
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('saved', false, 'reason', 'debate-not-active');
  end if;

  if v_finalization_token is not null then
    return jsonb_build_object('saved', false, 'reason', 'debate-finalizing');
  end if;

  select *
  into v_turn
  from solo_debate_turns
  where id = p_turn_id
    and debate_id = p_debate_id
    and round_number = (
      select max(latest.round_number)
      from solo_debate_turns latest
      where latest.debate_id = p_debate_id
    )
  for update;

  if not found then
    return jsonb_build_object('saved', false, 'reason', 'stale-turn');
  end if;

  if v_turn.user_message is not null then
    insert into product_events (user_id, name, format, side, round, debate_id)
    values (
      p_user_id,
      'round_completed',
      v_format,
      v_side,
      v_turn.round_number,
      p_debate_id
    )
    on conflict do nothing;

    return jsonb_build_object('saved', true, 'reason', 'already-saved', 'completedTurn', to_jsonb(v_turn));
  end if;

  if v_turn.staged_user_message is null then
    return jsonb_build_object('saved', false, 'reason', 'no-staged-response');
  end if;

  if (
    select count(*)
    from solo_debate_turns answered
    where answered.debate_id = p_debate_id
      and answered.user_message is not null
  ) + 1 < greatest(p_min_rounds, 1) then
    return jsonb_build_object('saved', false, 'reason', 'minimum-rounds-not-met');
  end if;

  if v_turn.submission_token is not null
     and v_turn.submission_started_at is not null
     and v_turn.submission_started_at >=
       v_now - make_interval(secs => greatest(p_stale_after_seconds, 30)) then
    return jsonb_build_object('saved', false, 'reason', 'submission-in-progress');
  end if;

  update solo_debate_turns
  set user_message = staged_user_message,
      input_mode = staged_input_mode,
      scores = staged_scores,
      turn_score = staged_turn_score,
      feedback = null,
      assessment = staged_assessment,
      training_meta = staged_training_meta,
      submission_token = null,
      submission_started_at = null,
      staged_user_message = null,
      staged_input_mode = null,
      staged_scores = null,
      staged_turn_score = null,
      staged_assessment = null,
      staged_training_meta = null,
      staged_mode = null,
      staged_submitted_at = null
  where id = p_turn_id
  returning * into v_turn;

  update solo_debates
  set round_count = v_turn.round_number
  where id = p_debate_id;

  insert into product_events (user_id, name, format, side, round, debate_id)
  values (
    p_user_id,
    'round_completed',
    v_format,
    v_side,
    v_turn.round_number,
    p_debate_id
  )
  on conflict do nothing;

  return jsonb_build_object(
    'saved', true,
    'reason', 'saved-for-finish',
    'completedTurn', to_jsonb(v_turn)
  );
end;
$$;

create or replace function finalize_solo_debate_v3(
  p_debate_id uuid,
  p_user_id uuid,
  p_token uuid,
  p_total_score integer,
  p_bonus_xp integer,
  p_points_per_level integer,
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
  activity_date date;
  compact_performance integer;
  profile_timezone text;
  profile_streak integer;
  profile_last_activity date;
  debate_format text;
  debate_side text;
begin
  select format, side
  into debate_format, debate_side
  from solo_debates
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
    and finalization_token = p_token
  for update;

  if not found then
    return false;
  end if;

  if exists (
    select 1
    from solo_debate_turns
    where debate_id = p_debate_id
      and user_message is null
      and (
        staged_user_message is not null
        or submission_token is not null
      )
  ) then
    raise exception 'solo turn submission is still pending during finalization';
  end if;

  select timezone, current_streak, last_activity_date
  into profile_timezone, profile_streak, profile_last_activity
  from profiles
  where id = p_user_id
  for update;

  if not found or profile_timezone is null or btrim(profile_timezone) = '' then
    raise exception 'profile timezone unavailable during solo finalization';
  end if;

  activity_date := (clock_timestamp() at time zone profile_timezone)::date;
  compact_performance := nullif(p_result_payload->>'performanceScore', '')::integer;

  next_streak := case
    when profile_last_activity = activity_date then profile_streak
    when profile_last_activity = activity_date - 1 then profile_streak + 1
    else 1
  end;

  update profiles
  set total_points = total_points + p_total_score + p_bonus_xp,
      level = floor((total_points + p_total_score + p_bonus_xp) / greatest(p_points_per_level, 1)) + 1,
      current_streak = next_streak,
      longest_streak = greatest(longest_streak, next_streak),
      last_activity_date = activity_date
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

    if retest_affected = 0 then
      raise exception 'repair retest assignment not found during solo finalization';
    end if;
  end if;

  update solo_debates
  set status = 'completed',
      total_score = p_total_score,
      performance_score = compact_performance,
      bonus_xp = p_bonus_xp,
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
  if affected = 0 then
    return false;
  end if;

  insert into product_events (user_id, name, format, side, debate_id)
  values (p_user_id, 'debate_completed', debate_format, debate_side, p_debate_id)
  on conflict do nothing;

  if p_has_retest and p_retest_observable then
    insert into product_events (user_id, name, format, side, debate_id)
    values (p_user_id, 'retest_completed', debate_format, debate_side, p_debate_id)
    on conflict do nothing;

    if p_retest_demonstrated is true then
      insert into product_events (user_id, name, format, side, debate_id)
      values (p_user_id, 'retest_skill_demonstrated', debate_format, debate_side, p_debate_id)
      on conflict do nothing;
    end if;
  end if;

  return true;
end;
$$;
