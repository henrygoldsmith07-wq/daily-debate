-- Atomic/scalable topic-category novelty rewards.
--
-- "Unfamiliar topic" used to scan every completed debate and then decide in
-- application code. That became unbounded as history grew and two concurrent
-- finalizations could both observe a category as new. Persist normalized
-- category exposure once and let the finalization transaction own the reward.

create table if not exists user_category_exposure (
  user_id uuid not null references profiles(id) on delete cascade,
  category_key text not null,
  first_debate_id uuid not null,
  first_seen_at timestamptz not null,
  primary key (user_id, category_key),
  check (category_key <> '' and category_key = lower(btrim(category_key)))
);

create index if not exists user_category_exposure_first_seen_idx
  on user_category_exposure(user_id, first_seen_at desc);

-- Existing completed debates must count as prior exposure so deploying this
-- migration cannot re-award novelty for categories the learner already used.
insert into user_category_exposure (user_id, category_key, first_debate_id, first_seen_at)
select distinct on (sd.user_id, lower(btrim(dt.category)))
  sd.user_id,
  lower(btrim(dt.category)) as category_key,
  sd.id,
  coalesce(sd.completed_at, sd.created_at) as first_seen_at
from solo_debates sd
join daily_topics dt on dt.id = sd.topic_id
where sd.status = 'completed'
  and dt.category is not null
  and btrim(dt.category) <> ''
order by
  sd.user_id,
  lower(btrim(dt.category)),
  coalesce(sd.completed_at, sd.created_at) asc,
  sd.id asc
on conflict (user_id, category_key) do nothing;

create or replace function finalize_solo_debate_v4(
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
  p_retest_demonstrated boolean,
  p_current_category text
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
  retest_reason text;
  v_category_key text;
  exposure_rows integer := 0;
  final_bonus_xp integer := greatest(coalesce(p_bonus_xp, 0), 0);
  durable_result_payload jsonb;
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

  -- Category novelty is durable state, not an application-layer history scan.
  -- The unique key serializes concurrent first exposures for the same user and
  -- normalized category. Because this runs inside finalization, a failed
  -- finalization cannot consume the novelty reward.
  v_category_key := lower(btrim(coalesce(p_current_category, '')));
  if v_category_key <> '' then
    insert into user_category_exposure (user_id, category_key, first_debate_id, first_seen_at)
    values (p_user_id, v_category_key, p_debate_id, p_completed_at)
    on conflict (user_id, category_key) do nothing;
    get diagnostics exposure_rows = row_count;
  end if;

  if exposure_rows = 1 then
    final_bonus_xp := final_bonus_xp + 10;
  end if;

  durable_result_payload := jsonb_set(
    coalesce(p_result_payload, '{}'::jsonb),
    '{bonusXP}',
    to_jsonb(final_bonus_xp),
    true
  );

  if exposure_rows = 1 then
    durable_result_payload := jsonb_set(
      durable_result_payload,
      '{rewardEvents}',
      coalesce(durable_result_payload->'rewardEvents', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
          'kind', 'unfamiliar-topic',
          'xp', 10,
          'label', 'Debated an unfamiliar topic'
        )),
      true
    );
  end if;

  next_streak := case
    when profile_last_activity = activity_date then profile_streak
    when profile_last_activity = activity_date - 1 then profile_streak + 1
    else 1
  end;

  update profiles
  set total_points = total_points + p_total_score + final_bonus_xp,
      level = floor((total_points + p_total_score + final_bonus_xp) / greatest(p_points_per_level, 1)) + 1,
      current_streak = next_streak,
      longest_streak = greatest(longest_streak, next_streak),
      last_activity_date = activity_date
  where id = p_user_id;

  if p_has_retest then
    select target_kind
    into retest_reason
    from repair_retests
    where user_id = p_user_id
      and assigned_debate_id = p_debate_id
      and (p_repair_result_id is null or repair_result_id = p_repair_result_id)
    limit 1;

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
      bonus_xp = final_bonus_xp,
      completed_at = p_completed_at,
      coaching = p_coaching,
      result_payload = durable_result_payload,
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
    insert into product_events (user_id, name, format, side, reason, debate_id)
    values (p_user_id, 'retest_completed', debate_format, debate_side, retest_reason, p_debate_id)
    on conflict do nothing;

    if p_retest_demonstrated is true then
      insert into product_events (user_id, name, format, side, reason, debate_id)
      values (p_user_id, 'retest_skill_demonstrated', debate_format, debate_side, retest_reason, p_debate_id)
      on conflict do nothing;
    end if;
  end if;

  return true;
end;
$$;
