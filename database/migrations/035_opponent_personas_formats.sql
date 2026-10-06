-- Opponent adversary controls (persona + difficulty) and expanded solo
-- practice formats (flash, cross-examination, socratic).
--
-- Persona changes HOW the AI opponent attacks; difficulty changes HOW HARD.
-- Both default to the previous single-opponent behaviour ('balanced' +
-- 'challenging'), so existing rows keep their meaning and no backfill is
-- needed. The format check constraints are widened in place; product_events
-- gains the same new format values plus a solo_debate_started event so the
-- funnel can distinguish the new formats from full debates.
--
-- The atomic-start RPC (migration 032) is replaced with persona/difficulty
-- parameters, the widened format allowlist, and a start event name that
-- follows the format. Legacy callers that omit the new parameters keep the
-- previous behaviour through the defaults.

alter table solo_debates
  add column if not exists persona text not null default 'balanced'
    check (persona in ('balanced', 'skeptic', 'lawyer', 'philosopher', 'economist', 'devils-advocate', 'expert')),
  add column if not exists difficulty text not null default 'challenging'
    check (difficulty in ('easy', 'challenging', 'expert'));

-- Widen the solo_debates.format check (added unnamed in 004; PostgreSQL names
-- it <table>_<column>_check deterministically). Idempotent: the drop is a
-- no-op when the widened constraint is already in place.
alter table solo_debates drop constraint if exists solo_debates_format_check;
alter table solo_debates
  add constraint solo_debates_format_check
  check (format in ('sprint', 'full', 'flash', 'cross-examination', 'socratic'));

-- product_events.format carries the same inline check from 004; widen it the
-- same way so the new formats can be recorded with their real value.
alter table product_events drop constraint if exists product_events_format_check;
alter table product_events
  add constraint product_events_format_check
  check (format in ('sprint', 'full', 'flash', 'cross-examination', 'socratic'));

-- Widen the product event allowlist: migration 021's list plus the new
-- solo_debate_started start event. The full 021 allowlist is re-declared so
-- this migration never narrows it.
alter table product_events drop constraint if exists product_events_name_check;
alter table product_events
  add constraint product_events_name_check check (name in (
    'daily_viewed', 'debate_started', 'sprint_started', 'full_debate_started',
    'solo_debate_started',
    'round_completed', 'debate_completed',
    'repair_started', 'repair_attempted', 'repair_demonstrated',
    'repair_episode_closed', 'repair_completed',
    'retest_started', 'retest_completed', 'retest_skill_demonstrated',
    'full_analysis_opened', 'progress_viewed', 'pvp_started', 'challenge_me_selected',
    'challenge_link_created', 'challenge_link_accepted'
  ));

create or replace function complete_solo_debate_start(
  p_user_id uuid,
  p_topic_id uuid,
  p_token uuid,
  p_side text,
  p_format text,
  p_persona text default 'balanced',
  p_difficulty text default 'challenging',
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
  if p_format not in ('sprint', 'full', 'flash', 'cross-examination', 'socratic') then
    raise exception 'invalid solo debate format' using errcode = '22023';
  end if;
  if p_persona not in ('balanced', 'skeptic', 'lawyer', 'philosopher', 'economist', 'devils-advocate', 'expert') then
    raise exception 'invalid opponent persona' using errcode = '22023';
  end if;
  if p_difficulty not in ('easy', 'challenging', 'expert') then
    raise exception 'invalid opponent difficulty' using errcode = '22023';
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
      persona,
      difficulty,
      coaching
    )
    values (
      p_user_id,
      p_topic_id,
      p_side,
      'active',
      1,
      p_format,
      p_persona,
      p_difficulty,
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
        persona = p_persona,
        difficulty = p_difficulty,
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
    case p_format
      when 'sprint' then 'sprint_started'
      when 'full' then 'full_debate_started'
      else 'solo_debate_started'
    end,
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
