-- Durable pre-AI solo submissions, DB-clock timing, and non-resettable timed attempts.
--
-- A user's accepted response is staged before any external provider call. The
-- generation lease prevents duplicate model work; a provider failure releases
-- only the lease, not the staged answer, so retries resume the same submission.
-- Timed-mode attempts are recorded per round and cannot be restarted by
-- switching away and back. All authoritative timing uses PostgreSQL's clock.

alter table solo_debate_turns
  add column if not exists response_windows jsonb not null default '{}'::jsonb,
  add column if not exists submission_token uuid,
  add column if not exists submission_started_at timestamptz,
  add column if not exists staged_user_message text,
  add column if not exists staged_input_mode text,
  add column if not exists staged_scores jsonb,
  add column if not exists staged_turn_score integer,
  add column if not exists staged_assessment jsonb,
  add column if not exists staged_training_meta jsonb,
  add column if not exists staged_mode text,
  add column if not exists staged_submitted_at timestamptz;

alter table solo_debate_turns
  drop constraint if exists solo_debate_turns_staged_mode_check;

alter table solo_debate_turns
  add constraint solo_debate_turns_staged_mode_check
  check (
    staged_mode is null
    or staged_mode in ('text', 'speech', 'rapid-rebuttal', 'prepared-speech')
  );

-- Preserve any already-issued migration-028 window when upgrading.
update solo_debate_turns
set response_windows =
  response_windows ||
  jsonb_build_object(
    response_mode,
    jsonb_build_object(
      'startedAt', response_window_started_at,
      'expiresAt', response_window_expires_at
    )
  )
where response_mode is not null
  and response_mode <> 'text'
  and response_window_started_at is not null
  and response_window_expires_at is not null
  and not (response_windows ? response_mode);

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
  v_now timestamptz := clock_timestamp();
  v_remaining integer;
begin
  if p_mode not in ('text', 'speech', 'rapid-rebuttal', 'prepared-speech') then
    raise exception 'unknown debate mode';
  end if;

  perform 1
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

  -- Once the user response has been durably staged, the round's training mode
  -- is immutable while opponent generation is retried.
  if exists (
    select 1 from solo_debate_turns
    where id = p_turn_id and staged_user_message is not null
  ) then
    return null;
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

create or replace function claim_solo_turn_submission(
  p_debate_id uuid,
  p_user_id uuid,
  p_turn_id uuid,
  p_token uuid,
  p_mode text,
  p_require_window boolean,
  p_user_message text,
  p_input_mode text,
  p_scores jsonb,
  p_turn_score integer,
  p_assessment jsonb,
  p_training_meta jsonb,
  p_elapsed_seconds integer,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
as $$
declare
  v_turn solo_debate_turns%rowtype;
  v_now timestamptz := clock_timestamp();
  v_elapsed integer;
  v_training jsonb;
begin
  perform 1
  from solo_debates
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'debate-not-active');
  end if;

  select *
  into v_turn
  from solo_debate_turns
  where id = p_turn_id
    and debate_id = p_debate_id
  for update;

  if not found or v_turn.user_message is not null then
    return jsonb_build_object('claimed', false, 'reason', 'already-answered');
  end if;

  if v_turn.staged_user_message is not null then
    if v_turn.staged_user_message is distinct from p_user_message then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'submission-already-staged',
        'staged', jsonb_build_object(
          'userMessage', v_turn.staged_user_message,
          'inputMode', v_turn.staged_input_mode,
          'scores', v_turn.staged_scores,
          'turnScore', v_turn.staged_turn_score,
          'assessment', v_turn.staged_assessment,
          'trainingMeta', v_turn.staged_training_meta,
          'modeId', v_turn.staged_mode,
          'submittedAt', v_turn.staged_submitted_at
        )
      );
    end if;

    if v_turn.submission_started_at is not null
       and v_turn.submission_started_at >=
         v_now - make_interval(secs => greatest(p_stale_after_seconds, 30)) then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'submission-in-progress',
        'staged', jsonb_build_object(
          'userMessage', v_turn.staged_user_message,
          'inputMode', v_turn.staged_input_mode,
          'scores', v_turn.staged_scores,
          'turnScore', v_turn.staged_turn_score,
          'assessment', v_turn.staged_assessment,
          'trainingMeta', v_turn.staged_training_meta,
          'modeId', v_turn.staged_mode,
          'submittedAt', v_turn.staged_submitted_at
        )
      );
    end if;

    update solo_debate_turns
    set submission_token = p_token,
        submission_started_at = v_now
    where id = p_turn_id
    returning * into v_turn;

    return jsonb_build_object(
      'claimed', true,
      'reason', 'resumed',
      'resumed', true,
      'elapsedSeconds', v_turn.staged_training_meta->'elapsedSeconds',
      'staged', jsonb_build_object(
        'userMessage', v_turn.staged_user_message,
        'inputMode', v_turn.staged_input_mode,
        'scores', v_turn.staged_scores,
        'turnScore', v_turn.staged_turn_score,
        'assessment', v_turn.staged_assessment,
        'trainingMeta', v_turn.staged_training_meta,
        'modeId', v_turn.staged_mode,
        'submittedAt', v_turn.staged_submitted_at
      )
    );
  end if;

  if p_require_window then
    if v_turn.response_mode is distinct from p_mode
       or v_turn.response_window_started_at is null
       or v_turn.response_window_expires_at is null
       or v_now < v_turn.response_window_started_at
       or v_now > v_turn.response_window_expires_at then
      return jsonb_build_object('claimed', false, 'reason', 'timing-window-invalid');
    end if;
    v_elapsed := greatest(
      0,
      floor(extract(epoch from (v_now - v_turn.response_window_started_at)))::integer
    );
  else
    v_elapsed := case
      when p_elapsed_seconds is null then null
      else greatest(0, least(p_elapsed_seconds, 3600))
    end;
  end if;

  v_training := jsonb_set(
    coalesce(p_training_meta, '{}'::jsonb),
    '{elapsedSeconds}',
    coalesce(to_jsonb(v_elapsed), 'null'::jsonb),
    true
  );

  update solo_debate_turns
  set submission_token = p_token,
      submission_started_at = v_now,
      staged_user_message = p_user_message,
      staged_input_mode = p_input_mode,
      staged_scores = p_scores,
      staged_turn_score = p_turn_score,
      staged_assessment = p_assessment,
      staged_training_meta = v_training,
      staged_mode = p_mode,
      staged_submitted_at = v_now
  where id = p_turn_id
  returning * into v_turn;

  return jsonb_build_object(
    'claimed', true,
    'reason', 'staged',
    'resumed', false,
    'elapsedSeconds', v_elapsed,
    'staged', jsonb_build_object(
      'userMessage', v_turn.staged_user_message,
      'inputMode', v_turn.staged_input_mode,
      'scores', v_turn.staged_scores,
      'turnScore', v_turn.staged_turn_score,
      'assessment', v_turn.staged_assessment,
      'trainingMeta', v_turn.staged_training_meta,
      'modeId', v_turn.staged_mode,
      'submittedAt', v_turn.staged_submitted_at
    )
  );
end;
$$;

create or replace function release_solo_turn_submission(
  p_debate_id uuid,
  p_user_id uuid,
  p_turn_id uuid,
  p_token uuid
)
returns boolean
language plpgsql
as $$
declare
  affected integer := 0;
begin
  update solo_debate_turns t
  set submission_token = null,
      submission_started_at = null
  from solo_debates d
  where t.id = p_turn_id
    and t.debate_id = p_debate_id
    and d.id = t.debate_id
    and d.user_id = p_user_id
    and d.status = 'active'
    and t.user_message is null
    and t.submission_token = p_token;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

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

  return jsonb_build_object(
    'saved', true,
    'reason', 'saved',
    'completedTurn', to_jsonb(v_turn),
    'nextTurn', case when v_next.id is null then null else to_jsonb(v_next) end
  );
end;
$$;

create or replace function refresh_solo_debate_finalization(
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
  set finalization_started_at = now()
  where id = p_debate_id
    and user_id = p_user_id
    and status = 'active'
    and finalization_token = p_token;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;
