-- Atomic PvP matchmaking + one-active-match invariant.
--
-- The matchmaker previously selected the oldest queued opponent and inserted
-- the match in two independent statements, explicitly accepting a rare race
-- that could double-match a player. These changes move the invariant into the
-- database so no code path can violate it:
--
--   1. Partial unique indexes: a user can appear in at most one ACTIVE match
--      (as player_a or player_b). Completed matches do not count.
--   2. claim_pvp_opponent_and_create_match(): a single statement that locks the
--      oldest queued, unmatched opponent (FOR UPDATE SKIP LOCKED), inserts the
--      match, and clears both queue rows. Concurrent claimants skip locked rows
--      instead of blocking, so exactly one of them claims a given opponent.
--   3. enqueue_pvp_if_unmatched(): enqueueing only succeeds for players without
--      an active match, so a matched player can never sit in the queue.

-- ── Invariant: at most one active match per user ────────────────────────────
create unique index if not exists pvp_matches_one_active_player_a
  on pvp_matches(player_a)
  where status = 'active';

create unique index if not exists pvp_matches_one_active_player_b
  on pvp_matches(player_b)
  where status = 'active';

-- Repair path for pre-existing data that violates the invariant: before the
-- indexes above can be created on a dirty database, close every active match
-- beyond the newest one per player (oldest wins, later duplicates forfeited
-- as completed with no winner). Runs only when duplicates actually exist.
do $$
begin
  if exists (
    select 1 from pvp_matches m
    where m.status = 'active'
      and (
        exists (select 1 from pvp_matches older where older.status = 'active' and older.player_a = m.player_a and older.created_at < m.created_at)
        or exists (select 1 from pvp_matches older where older.status = 'active' and older.player_b = m.player_b and older.created_at < m.created_at)
      )
  ) then
    update pvp_matches m
    set status = 'completed', completed_at = now()
    where m.status = 'active'
      and (
        exists (select 1 from pvp_matches older where older.status = 'active' and older.player_a = m.player_a and older.created_at < m.created_at)
        or exists (select 1 from pvp_matches older where older.status = 'active' and older.player_b = m.player_b and older.created_at < m.created_at)
      );
  end if;
end
$$;

-- ── Atomic claim-one-opponent-and-create-match ──────────────────────────────
-- Returns the created match row, or no rows when nobody was waiting.
create or replace function claim_pvp_opponent_and_create_match(
  p_joiner uuid,
  p_topic_id uuid,
  p_round_limit integer default 5
)
returns setof pvp_matches
language plpgsql
as $$
declare
  claimed uuid;
  v_side text;
  v_match_id uuid;
begin
  -- Claim the oldest waiting, currently-unmatched opponent for this topic.
  -- SKIP LOCKED means a concurrent claimant skips this row instead of
  -- blocking, so exactly one of them gets the opponent.
  select q.user_id into claimed
  from pvp_queue q
  where q.topic_id = p_topic_id
    and q.user_id <> p_joiner
    and not exists (
      select 1
      from pvp_matches m
      where m.status = 'active'
        and (m.player_a = q.user_id or m.player_b = q.user_id)
    )
  order by q.joined_at asc
  limit 1
  for update of q skip locked;

  if claimed is null then
    return;
  end if;

  v_side := case when random() < 0.5 then 'for' else 'against' end;

  begin
    insert into pvp_matches (
      topic_id, player_a, player_b, player_a_side, round_limit,
      current_turn_player, turn_started_at
    ) values (
      p_topic_id, claimed, p_joiner, v_side, p_round_limit,
      claimed, now()
    )
    returning id into v_match_id;
  exception
    when unique_violation then
      -- The joiner was matched concurrently; the partial unique indexes above
      -- guarantee at most one active match per player. Signal "no match" and
      -- let the caller re-check the joiner's state.
      return;
  end;

  -- Both players leave the queue; the joiner may not have a row (harmless).
  delete from pvp_queue where user_id in (claimed, p_joiner);

  return query select * from pvp_matches where id = v_match_id;
end;
$$;

-- ── Atomic enqueue guard ────────────────────────────────────────────────────
-- Inserts (or refreshes) the caller's queue row only when they have no active
-- match. Returns true when the user is queued afterwards.
create or replace function enqueue_pvp_if_unmatched(
  p_user uuid,
  p_topic_id uuid
)
returns boolean
language sql
as $$
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
  returning true;
$$;
