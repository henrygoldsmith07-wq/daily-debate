-- Atomic solo-turn advancement + server-issued training windows.
--
-- A turn answer, next AI turn, and debate round_count now commit together.
-- Timed training modes use server timestamps tied to the pending turn; the
-- browser chooses when the window begins (after TTS), but cannot forge elapsed
-- time at submission.

alter table solo_debate_turns
  add column if not exists response_mode text,
  add column if not exists response_window_started_at timestamptz,
  add column if not exists response_window_expires_at timestamptz;

alter table solo_debate_turns
  drop constraint if exists solo_debate_turns_response_mode_check;

alter table solo_debate_turns
  add constraint solo_debate_turns_response_mode_check
  check (
    response_mode is null
    or response_mode in ('text', 'speech', 'rapid-rebuttal', 'prepared-speech')
  );

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
  v_mode text;
  v_started timestamptz;
  v_expires timestamptz;
begin
  if p_mode not in ('text', 'speech', 'rapid-rebuttal', 'prepared-speech') then
    raise exception 'unknown debate mode';
  end if;

  select t.response_mode, t.response_window_started_at, t.response_window_expires_at
  into v_mode, v_started, v_expires
  from solo_debate_turns t
  join solo_debates d on d.id = t.debate_id
  where t.id = p_turn_id
    and t.debate_id = p_debate_id
    and t.user_message is null
    and d.user_id = p_user_id
    and d.status = 'active'
  for update of t;

  if not found then
    return null;
  end if;

  if p_mode <> 'text' and v_mode = p_mode and v_started is not null and v_expires is not null then
    return jsonb_build_object(
      'modeId', v_mode,
      'startedAt', v_started,
      'expiresAt', v_expires
    );
  end if;

  if p_mode = 'text' then
    update solo_debate_turns
    set response_mode = 'text',
        response_window_started_at = null,
        response_window_expires_at = null
    where id = p_turn_id;

    return jsonb_build_object(
      'modeId', 'text',
      'startedAt', null,
      'expiresAt', null
    );
  end if;

  if p_limit_seconds is null or p_limit_seconds <= 0 or p_limit_seconds > 3600 then
    raise exception 'invalid response-window limit';
  end if;

  v_started := clock_timestamp();
  v_expires := v_started + make_interval(secs => p_limit_seconds);

  update solo_debate_turns
  set response_mode = p_mode,
      response_window_started_at = v_started,
      response_window_expires_at = v_expires
  where id = p_turn_id;

  return jsonb_build_object(
    'modeId', p_mode,
    'startedAt', v_started,
    'expiresAt', v_expires
  );
end;
$$;

create or replace function advance_solo_debate_turn(
  p_debate_id uuid,
  p_user_id uuid,
  p_turn_id uuid,
  p_received_at timestamptz,
  p_mode text,
  p_require_window boolean,
  p_user_message text,
  p_input_mode text,
  p_scores jsonb,
  p_turn_score integer,
  p_feedback text,
  p_assessment jsonb,
  p_training_meta jsonb,
  p_next_round_number integer,
  p_next_ai_message text
)
returns jsonb
language plpgsql
as $$
declare
  v_turn solo_debate_turns%rowtype;
  v_next solo_debate_turns%rowtype;
begin
  perform 1
  from solo_debates
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('saved', false, 'reason', 'debate-not-active');
  end if;

  select *
  into v_turn
  from solo_debate_turns
  where id = p_turn_id
    and debate_id = p_debate_id
  for update;

  if not found or v_turn.user_message is not null then
    return jsonb_build_object('saved', false, 'reason', 'already-answered');
  end if;

  if p_require_window and (
    v_turn.response_mode is distinct from p_mode
    or v_turn.response_window_started_at is null
    or v_turn.response_window_expires_at is null
    or p_received_at < v_turn.response_window_started_at
    or p_received_at > v_turn.response_window_expires_at
  ) then
    return jsonb_build_object('saved', false, 'reason', 'timing-window-invalid');
  end if;

  update solo_debate_turns
  set user_message = p_user_message,
      input_mode = p_input_mode,
      scores = p_scores,
      turn_score = p_turn_score,
      feedback = p_feedback,
      assessment = p_assessment,
      training_meta = p_training_meta
  where id = p_turn_id;

  if p_next_round_number is not null then
    if p_next_round_number <> v_turn.round_number + 1 or p_next_ai_message is null then
      raise exception 'invalid next solo round';
    end if;

    insert into solo_debate_turns (debate_id, round_number, ai_message)
    values (p_debate_id, p_next_round_number, p_next_ai_message)
    returning * into v_next;
  end if;

  update solo_debates
  set round_count = coalesce(p_next_round_number, v_turn.round_number)
  where id = p_debate_id;

  return jsonb_build_object(
    'saved', true,
    'reason', 'saved',
    'nextTurn', case when v_next.id is null then null else to_jsonb(v_next) end
  );
end;
$$;
