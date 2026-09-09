-- Fix enqueue_pvp_if_unmatched to return a real boolean on every path.
--
-- The 003 version declared `returns boolean` but its INSERT ... SELECT ...
-- WHERE yields ZERO ROWS when the caller already has an active match, so the
-- scalar call returned NULL instead of false. Downstream code and tests that
-- read `queued` then operated on an unknown tri-state. This rewrite wraps the
-- insert in COALESCE so every path returns exactly one boolean row: true when
-- the user is queued afterwards, false otherwise. Semantics of the guard are
-- unchanged (statement stays atomic, conflict-refresh preserved).

create or replace function enqueue_pvp_if_unmatched(
  p_user uuid,
  p_topic_id uuid
)
returns boolean
language sql
as $$
  with ins as (
    insert into pvp_queue (user_id, topic_id)
    select p_user, p_topic_id
    where not exists (
      select 1
      from pvp_matches m
      where m.status = 'active'
        and (m.player_a = p_user or m.player_b = p_user)
    )
    on conflict (user_id) do update
      set topic_id = excluded.topic_id,
          joined_at = now()
    returning true
  )
  select exists (select 1 from ins);
$$;
