-- Atomic solo-debate creation and database-owned local-day finalization.
--
-- A debate start now has a short-lived claim before any external opening-model
-- call. Only the claim owner may atomically create/recover the active debate,
-- round 1, optional repair-retest assignment, and idempotent start analytics.
-- Crashes therefore leave a reclaimable lease, never a durable zero-turn debate.

alter table profiles
  add column if not exists timezone_initialized_at timestamptz;

-- Migration 031 already captured non-UTC browser zones for current users.
-- Mark those as initialized; UTC remains distinguishable from "legacy default"
-- until the next authenticated sign-in explicitly initializes it.
update profiles
set timezone_initialized_at = coalesce(timezone_initialized_at, now())
where timezone <> 'UTC';

-- Old builds could leave a zero-turn active debate only if the process died
-- between debate insertion and opening-turn insertion. Those rows contain no
-- user response or opponent content and are safe to discard once clearly stale.
delete from solo_debates d
where d.status = 'active'
  and d.created_at < clock_timestamp() - interval '10 minutes'
  and not exists (
    select 1 from solo_debate_turns t where t.debate_id = d.id
  );

do $$
begin
  if exists (
    select 1
    from solo_debates
    where status = 'active'
    group by user_id, topic_id
    having count(*) > 1
  ) then
    raise exception 'duplicate active solo debates must be repaired before migration 032';
  end if;
end;
$$;

create unique index if not exists solo_debates_one_active_per_user_topic
  on solo_debates(user_id, topic_id)
  where status = 'active';

create table if not exists solo_debate_start_claims (
  user_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid not null references daily_topics(id) on delete cascade,
  token uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  primary key (user_id, topic_id)
);

create index if not exists solo_debate_start_claims_started_idx
  on solo_debate_start_claims(started_at);

-- Product start events become exactly-once per debate. Historical duplicate
-- rows are collapsed before the unique index is installed.
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
      'sprint_started',
      'full_debate_started',
      'challenge_me_selected',
      'retest_started'
    )
)
delete from product_events pe
using ranked r
where pe.id = r.id
  and r.rn > 1;

create unique index if not exists product_events_unique_start_event
  on product_events(debate_id, name)
  where debate_id is not null
    and name in (
      'sprint_started',
      'full_debate_started',
      'challenge_me_selected',
      'retest_started'
    );

create or replace function claim_solo_debate_start(
  p_user_id uuid,
  p_topic_id uuid,
  p_token uuid,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
as $$
declare
  v_existing uuid;
  affected integer := 0;
begin
  select d.id
  into v_existing
  from solo_debates d
  where d.user_id = p_user_id
    and d.topic_id = p_topic_id
    and d.status = 'active'
    and exists (
      select 1 from solo_debate_turns t
      where t.debate_id = d.id and t.round_number = 1
    )
  order by d.created_at desc, d.id desc
  limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'existing-debate',
      'debateId', v_existing
    );
  end if;

  insert into solo_debate_start_claims (user_id, topic_id, token, started_at)
  values (p_user_id, p_topic_id, p_token, clock_timestamp())
  on conflict (user_id, topic_id) do nothing;

  get diagnostics affected = row_count;
  if affected > 0 then
    return jsonb_build_object('claimed', true, 'reason', 'claimed');
  end if;

  update solo_debate_start_claims
  set token = p_token,
      started_at = clock_timestamp()
  where user_id = p_user_id
    and topic_id = p_topic_id
    and started_at < clock_timestamp() - make_interval(secs => greatest(p_stale_after_seconds, 30));

  get diagnostics affected = row_count;
  if affected > 0 then
    return jsonb_build_object('claimed', true, 'reason', 'reclaimed');
  end if;

  return jsonb_build_object('claimed', false, 'reason', 'start-in-progress');
end;
$$;

create or replace function release_solo_debate_start(
  p_user_id uuid,
  p_topic_id uuid,
  p_token uuid
)
returns boolean
language plpgsql
as $$
declare
  affected integer := 0;
begin
  delete from solo_debate_start_claims
  where user_id = p_user_id
    and topic_id = p_topic_id
    and token = p_token;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function complete_solo_debate_start(
  p_user_id uuid,
  p_topic_id uuid,
  p_token uuid,
  p_side text,
  p_format text,
  p_coaching jsonb,
  p_ai_message text,
  p_side_rule text default null,
  p_repair_result_id uuid default null,
  p_repair_debate_id uuid default null,
  p_target_kind text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_debate solo_debates%rowtype;
  v_turn solo_debate_turns%rowtype;
  v_claim_exists boolean := false;
  v_created boolean := false;
  v_retest_assigned boolean := false;
  v_coaching jsonb := coalesce(p_coaching, '{}'::jsonb);
begin
  if p_side not in ('for', 'against') then
    raise exception 'invalid solo debate side' using errcode = '22023';
  end if;
  if p_format not in ('sprint', 'full') then
    raise exception 'invalid solo debate format' using errcode = '22023';
  end if;
  if p_ai_message is null or btrim(p_ai_message) = '' then
    raise exception 'AI opening is required' using errcode = '22023';
  end if;

  select true
  into v_claim_exists
  from solo_debate_start_claims
  where user_id = p_user_id
    and topic_id = p_topic_id
    and token = p_token
  for update;

  if not coalesce(v_claim_exists, false) then
    select d.*
    into v_debate
    from solo_debates d
    where d.user_id = p_user_id
      and d.topic_id = p_topic_id
      and d.status = 'active'
      and exists (
        select 1 from solo_debate_turns t
        where t.debate_id = d.id and t.round_number = 1
      )
    order by d.created_at desc, d.id desc
    limit 1;

    if v_debate.id is not null then
      select *
      into v_turn
      from solo_debate_turns
      where debate_id = v_debate.id and round_number = 1;

      return jsonb_build_object(
        'ok', true,
        'reason', 'existing-debate',
        'created', false,
        'debate', to_jsonb(v_debate),
        'turn', to_jsonb(v_turn),
        'retestAssigned', false
      );
    end if;

    return jsonb_build_object('ok', false, 'reason', 'claim-lost');
  end if;

  select d.*
  into v_debate
  from solo_debates d
  where d.user_id = p_user_id
    and d.topic_id = p_topic_id
    and d.status = 'active'
  order by d.created_at desc, d.id desc
  limit 1
  for update;

  if v_debate.id is null then
    insert into solo_debates (
      user_id,
      topic_id,
      side,
      status,
      round_count,
      format,
      coaching
    )
    values (
      p_user_id,
      p_topic_id,
      p_side,
      'active',
      1,
      p_format,
      v_coaching
    )
    returning * into v_debate;
    v_created := true;
  else
    -- Repair a legacy zero-turn orphan under the winning start claim.
    update solo_debates
    set side = p_side,
        round_count = 1,
        format = p_format,
        coaching = v_coaching
    where id = v_debate.id
    returning * into v_debate;
  end if;

  select *
  into v_turn
  from solo_debate_turns
  where debate_id = v_debate.id
    and round_number = 1
  for update;

  if v_turn.id is null then
    insert into solo_debate_turns (debate_id, round_number, ai_message)
    values (v_debate.id, 1, p_ai_message)
    returning * into v_turn;
  end if;

  if p_repair_result_id is not null then
    if p_repair_debate_id is null or p_target_kind is null then
      raise exception 'incomplete repair retest assignment' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('repair-retest:' || p_repair_result_id::text, 727296)
    );

    if not exists (
      select 1
      from repair_results rr
      where rr.id = p_repair_result_id
        and rr.user_id = p_user_id
        and rr.debate_id = p_repair_debate_id
        and rr.target_kind = p_target_kind
        and rr.succeeded = true
    ) then
      raise exception 'repair retest anchor is no longer valid';
    end if;

    update repair_retests
    set completed_at = v_debate.created_at,
        observable = false,
        demonstrated = null,
        updated_at = v_debate.created_at
    where user_id = p_user_id
      and repair_result_id = p_repair_result_id
      and completed_at is null;

    insert into repair_retests (
      repair_result_id,
      user_id,
      repair_debate_id,
      target_kind,
      assigned_debate_id,
      assigned_at
    )
    values (
      p_repair_result_id,
      p_user_id,
      p_repair_debate_id,
      p_target_kind,
      v_debate.id,
      v_debate.created_at
    )
    on conflict (repair_result_id, assigned_debate_id) do nothing;

    v_retest_assigned := exists (
      select 1
      from repair_retests
      where repair_result_id = p_repair_result_id
        and assigned_debate_id = v_debate.id
    );
  end if;

  insert into product_events (user_id, name, format, side, reason, debate_id)
  values (
    p_user_id,
    case when p_format = 'sprint' then 'sprint_started' else 'full_debate_started' end,
    p_format,
    p_side,
    p_side_rule,
    v_debate.id
  )
  on conflict do nothing;

  if p_side_rule is not null then
    insert into product_events (user_id, name, format, side, reason, debate_id)
    values (
      p_user_id,
      'challenge_me_selected',
      p_format,
      p_side,
      p_side_rule,
      v_debate.id
    )
    on conflict do nothing;
  end if;

  if v_retest_assigned then
    insert into product_events (user_id, name, format, side, reason, debate_id)
    values (
      p_user_id,
      'retest_started',
      p_format,
      p_side,
      p_target_kind,
      v_debate.id
    )
    on conflict do nothing;
  end if;

  delete from solo_debate_start_claims
  where user_id = p_user_id
    and topic_id = p_topic_id
    and token = p_token;

  return jsonb_build_object(
    'ok', true,
    'reason', case when v_created then 'created' else 'recovered-orphan' end,
    'created', v_created,
    'debate', to_jsonb(v_debate),
    'turn', to_jsonb(v_turn),
    'retestAssigned', v_retest_assigned
  );
end;
$$;

-- Finalization v3 reads the profile timezone inside the same transaction that
-- updates streak state. Application/server clock or a failed profile read can
-- no longer silently substitute UTC for a durable local-day mutation.
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
begin
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
  return affected > 0;
end;
$$;

drop function if exists finalize_solo_debate(
  uuid, uuid, uuid, integer, integer, integer, date, timestamptz,
  jsonb, jsonb, boolean, uuid, boolean, boolean
);

drop function if exists finalize_solo_debate_v2(
  uuid, uuid, uuid, integer, integer, integer, timestamptz, text,
  jsonb, jsonb, boolean, uuid, boolean, boolean
);

create or replace function cleanup_expired_backend_state()
returns void
language plpgsql
as $$
begin
  delete from app_sessions where expires_at <= now();
  delete from rate_limits where reset_at <= now();
  delete from password_reset_tokens where expires_at <= now() or used_at is not null;
  update challenge_invites
  set status = 'expired'
  where status = 'open' and expires_at <= now();

  delete from solo_debate_start_claims
  where started_at < clock_timestamp() - interval '10 minutes';

  delete from solo_debates d
  where d.status = 'active'
    and d.created_at < clock_timestamp() - interval '10 minutes'
    and not exists (
      select 1 from solo_debate_turns t where t.debate_id = d.id
    );

  update solo_debates
  set finalization_token = null,
      finalization_started_at = null
  where status = 'active'
    and finalization_token is not null
    and (
      finalization_started_at is null
      or finalization_started_at < clock_timestamp() - interval '10 minutes'
    );

  update solo_debate_turns t
  set submission_token = null,
      submission_started_at = null
  from solo_debates d
  where d.id = t.debate_id
    and d.status = 'active'
    and t.user_message is null
    and t.submission_token is not null
    and (
      t.submission_started_at is null
      or t.submission_started_at < clock_timestamp() - interval '10 minutes'
    );
end;
$$;
