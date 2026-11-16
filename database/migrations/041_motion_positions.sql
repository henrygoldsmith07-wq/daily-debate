-- Positions on a motion, and matchmaking that only pairs people who disagree.
--
-- Until now a learner chose a side per debate, and PvP assigned sides with
-- random(): two people who agreed could be made to argue each other, and
-- nobody's actual view on the motion was ever recorded. Debates are better
-- when the two people genuinely disagree, so a learner now states where they
-- stand first, and the queue only ever pairs a For with an Against.
--
-- Additive only:
--   * motion_positions is new. One row per (learner, motion), changeable;
--     account erasure covers it through the profiles cascade.
--   * pvp_queue.side is a new nullable column. Rows queued by the previous
--     build carry no side and are never matched by the new function.
--   * join_pvp_queue_by_position is a NEW function. join_pvp_queue_and_match
--     (020) is left untouched, so a deploy that still runs the old route keeps
--     working; once no caller remains it can be retired in its own migration.

create table if not exists motion_positions (
  user_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid not null references daily_topics(id) on delete cascade,
  position text not null check (position in ('for', 'against')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);
create index if not exists motion_positions_topic_idx on motion_positions(topic_id, position);

alter table pvp_queue add column if not exists side text check (side in ('for', 'against'));

-- Same lifecycle as join_pvp_queue_and_match (020): one matchmaker per topic,
-- active-match recovery, enqueue, claim, create. Two differences: the joiner
-- brings a side, and the only claimable opponent holds the opposite one. The
-- waiting player becomes player_a and keeps the side they queued with.
create or replace function join_pvp_queue_by_position(
  p_joiner uuid,
  p_topic_id uuid,
  p_side text,
  p_round_limit integer default 5
)
returns setof pvp_matches
language plpgsql
as $$
declare
  existing_match pvp_matches%rowtype;
  opponent uuid;
  v_opposite text;
  v_match_id uuid;
begin
  if p_side is null or p_side not in ('for', 'against') then
    raise exception 'join_pvp_queue_by_position: side must be for or against';
  end if;
  v_opposite := case p_side when 'for' then 'against' else 'for' end;

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

  insert into pvp_queue (user_id, topic_id, side)
  values (p_joiner, p_topic_id, p_side)
  on conflict (user_id) do update
    set topic_id = excluded.topic_id,
        side = excluded.side,
        joined_at = now();

  select q.user_id
  into opponent
  from pvp_queue q
  where q.topic_id = p_topic_id
    and q.user_id <> p_joiner
    and q.side = v_opposite
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
      v_opposite,
      p_round_limit,
      opponent,
      now()
    )
    returning id into v_match_id;
  exception
    when unique_violation then
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
