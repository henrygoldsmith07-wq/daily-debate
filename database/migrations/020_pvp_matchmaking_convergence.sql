-- PvP matchmaking convergence + true cross-role one-active-match invariant.
--
-- Two independent partial unique indexes on player_a and player_b do NOT stop
-- the same user appearing as player_b in one active match and player_a in
-- another. Also, the old claim-then-enqueue HTTP flow can strand two users:
-- simultaneous first joins can both observe an empty queue, then both enqueue,
-- with neither request attempting a match again.
--
-- This migration fixes both at the database boundary:
--   1. A trigger serializes by player IDs and rejects any active match sharing
--      either player in either role.
--   2. join_pvp_queue_and_match() serializes matchmaking per topic, enqueues
--      the caller and claims the oldest waiting opponent in one transaction.
--      Simultaneous first-time joiners therefore converge to one match.

-- Defensive cleanup for legacy cross-role duplicates. Keep the earliest active
-- match in each conflict relation; close later conflicting rows before the new
-- invariant starts enforcing writes.
update pvp_matches m
set status = 'completed',
    completed_at = coalesce(m.completed_at, now())
where m.status = 'active'
  and exists (
    select 1
    from pvp_matches older
    where older.status = 'active'
      and older.id <> m.id
      and (
        older.player_a in (m.player_a, m.player_b)
        or older.player_b in (m.player_a, m.player_b)
      )
      and (
        older.created_at < m.created_at
        or (older.created_at = m.created_at and older.id::text < m.id::text)
      )
  );

create or replace function enforce_one_active_pvp_match_per_player()
returns trigger
language plpgsql
as $$
declare
  first_player text;
  second_player text;
begin
  if new.status <> 'active' then
    return new;
  end if;

  if new.player_a = new.player_b then
    raise exception 'A PvP player cannot match themselves'
      using errcode = '23505';
  end if;

  -- Serialize every active-match write touching the same player pair. Text
  -- hashes are used only as lock keys; a collision merely adds contention.
  first_player := least(new.player_a::text, new.player_b::text);
  second_player := greatest(new.player_a::text, new.player_b::text);
  perform pg_advisory_xact_lock(hashtextextended(first_player, 727293));
  perform pg_advisory_xact_lock(hashtextextended(second_player, 727293));

  if exists (
    select 1
    from pvp_matches m
    where m.status = 'active'
      and m.id <> new.id
      and (
        m.player_a in (new.player_a, new.player_b)
        or m.player_b in (new.player_a, new.player_b)
      )
  ) then
    raise exception 'A PvP player already has an active match'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists pvp_one_active_match_per_player on pvp_matches;
create trigger pvp_one_active_match_per_player
before insert or update of status, player_a, player_b
on pvp_matches
for each row
execute function enforce_one_active_pvp_match_per_player();

create or replace function join_pvp_queue_and_match(
  p_joiner uuid,
  p_topic_id uuid,
  p_round_limit integer default 5
)
returns setof pvp_matches
language plpgsql
as $$
declare
  existing_match pvp_matches%rowtype;
  opponent uuid;
  v_side text;
  v_match_id uuid;
begin
  -- One matchmaker at a time per topic. This is deliberately coarse: PvP
  -- queue volume is small, and correctness is more important than allowing
  -- two queue pairings for the same topic to race.
  perform pg_advisory_xact_lock(
    hashtextextended('pvp-topic:' || p_topic_id::text, 727294)
  );

  select *
  into existing_match
  from pvp_matches m
  where m.status = 'active'
    and (m.player_a = p_joiner or m.player_b = p_joiner)
  order by m.created_at desc
  limit 1;

  if found then
    delete from pvp_queue where user_id = p_joiner;
    return next existing_match;
    return;
  end if;

  insert into pvp_queue (user_id, topic_id)
  values (p_joiner, p_topic_id)
  on conflict (user_id) do update
    set topic_id = excluded.topic_id,
        joined_at = now();

  select q.user_id
  into opponent
  from pvp_queue q
  where q.topic_id = p_topic_id
    and q.user_id <> p_joiner
    and not exists (
      select 1
      from pvp_matches m
      where m.status = 'active'
        and (m.player_a = q.user_id or m.player_b = q.user_id)
    )
  order by q.joined_at asc, q.user_id asc
  limit 1
  for update of q;

  if opponent is null then
    return;
  end if;

  v_side := case when random() < 0.5 then 'for' else 'against' end;

  begin
    insert into pvp_matches (
      topic_id,
      player_a,
      player_b,
      player_a_side,
      round_limit,
      current_turn_player,
      turn_started_at
    ) values (
      p_topic_id,
      opponent,
      p_joiner,
      v_side,
      p_round_limit,
      opponent,
      now()
    )
    returning id into v_match_id;
  exception
    when unique_violation then
      -- A different topic/challenge may have matched the joiner concurrently.
      select *
      into existing_match
      from pvp_matches m
      where m.status = 'active'
        and (m.player_a = p_joiner or m.player_b = p_joiner)
      order by m.created_at desc
      limit 1;

      if found then
        delete from pvp_queue where user_id = p_joiner;
        return next existing_match;
      end if;
      return;
  end;

  delete from pvp_queue where user_id in (opponent, p_joiner);
  return query select * from pvp_matches where id = v_match_id;
end;
$$;
