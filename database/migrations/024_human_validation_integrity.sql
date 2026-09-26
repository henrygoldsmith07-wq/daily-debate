-- Human-validation coherence + idempotent challenge retries.

-- Calibration/mature validation requires three independent ratings. Normalize
-- the persisted counter against the real rating rows, close legacy open items
-- that already have three, and reopen historical rated/adjudicated rows below
-- three so the normal UI can finish collection. A reopened adjudication is
-- retained only as stale provenance and cannot count as ground truth.
with actual_counts as (
  select ci.id, count(cr.id)::int as actual
  from corpus_items ci
  left join corpus_ratings cr on cr.corpus_id = ci.id
  group by ci.id
)
update corpus_items ci
set rating_count = c.actual,
    status = case
      when ci.status = 'open' and c.actual >= 3 then 'rated'
      when ci.status in ('rated', 'adjudicated') and c.actual < 3 then 'open'
      else ci.status
    end,
    side_mapping = case
      when ci.status = 'adjudicated' and c.actual < 3 then
        coalesce(ci.side_mapping, '{}'::jsonb) || jsonb_build_object(
          'adjudication_stale', true,
          'adjudication_stale_at', now()::text,
          'adjudication_stale_actor', 'migration-024'
        )
      else ci.side_mapping
    end
from actual_counts c
where ci.id = c.id
  and (
    ci.rating_count <> c.actual
    or (ci.status = 'open' and c.actual >= 3)
    or (ci.status in ('rated', 'adjudicated') and c.actual < 3)
  );

create table if not exists corpus_system_judge_claims (
  corpus_id uuid primary key references corpus_items(id) on delete cascade,
  claim_token uuid not null,
  claimed_at timestamptz not null default now()
);

-- Keep migration 023's create_friend_challenge return contract stable so
-- migration replay remains valid. Version the richer retry-aware result shape
-- instead of changing an existing PostgreSQL function's return type.
create or replace function create_friend_challenge_v2(
  p_challenger uuid,
  p_topic_id uuid,
  p_challenger_side text,
  p_expiry_days integer default 7
)
returns table (
  result text,
  id uuid,
  code text,
  expires_at timestamptz
)
language plpgsql
as $$
declare
  existing_invite challenge_invites%rowtype;
  created_invite challenge_invites%rowtype;
  attempt integer;
begin
  if p_challenger_side not in ('for', 'against') then
    raise exception 'invalid challenge side' using errcode = '22023';
  end if;
  if p_expiry_days < 1 or p_expiry_days > 30 then
    raise exception 'invalid challenge expiry' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('friend-challenge-create:' || p_challenger::text, 727295)
  );

  update challenge_invites
  set status = 'expired'
  where challenger_id = p_challenger
    and status = 'open'
    and expires_at <= now();

  select ci.* into existing_invite
  from challenge_invites ci
  where ci.challenger_id = p_challenger and ci.status = 'open'
  order by ci.created_at desc, ci.id desc
  limit 1
  for update;

  if found
     and existing_invite.topic_id = p_topic_id
     and existing_invite.challenger_side = p_challenger_side
     and existing_invite.expires_at > now() then
    return query select 'reused'::text, existing_invite.id, existing_invite.code, existing_invite.expires_at;
    return;
  end if;

  if found then
    update challenge_invites set status = 'cancelled' where challenge_invites.id = existing_invite.id;
  end if;

  for attempt in 1..5 loop
    begin
      insert into challenge_invites (code, challenger_id, topic_id, challenger_side, expires_at)
      values (
        generate_secure_challenge_code(12), p_challenger, p_topic_id,
        p_challenger_side, now() + make_interval(days => p_expiry_days)
      )
      returning * into created_invite;
      return query select 'created'::text, created_invite.id, created_invite.code, created_invite.expires_at;
      return;
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- A lost HTTP response followed by the same recipient retry returns the
-- already-created match instead of a misleading "closed" conflict.
create or replace function accept_friend_challenge(
  p_code text,
  p_opponent uuid,
  p_round_limit integer default 5
)
returns table (
  result text,
  created_match_id uuid,
  challenger_side text
)
language plpgsql
as $$
declare
  invite challenge_invites%rowtype;
  new_match_id uuid;
begin
  select ci.* into invite
  from challenge_invites ci
  where ci.code = p_code
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::text;
    return;
  end if;
  if invite.challenger_id = p_opponent then
    return query select 'self'::text, null::uuid, invite.challenger_side;
    return;
  end if;
  if invite.status = 'accepted' and invite.opponent_id = p_opponent and invite.match_id is not null then
    return query select 'accepted_existing'::text, invite.match_id, invite.challenger_side;
    return;
  end if;
  if invite.status <> 'open' then
    return query select 'closed'::text, invite.match_id, invite.challenger_side;
    return;
  end if;
  if invite.expires_at <= now() then
    update challenge_invites set status = 'expired' where challenge_invites.id = invite.id;
    return query select 'closed'::text, null::uuid, invite.challenger_side;
    return;
  end if;

  if exists (
    select 1 from pvp_matches m
    where m.status = 'active'
      and (m.player_a in (invite.challenger_id, p_opponent) or m.player_b in (invite.challenger_id, p_opponent))
  ) then
    return query select 'active_match'::text, null::uuid, invite.challenger_side;
    return;
  end if;

  begin
    insert into pvp_matches (
      topic_id, player_a, player_b, player_a_side, round_limit, current_turn_player, turn_started_at
    ) values (
      invite.topic_id, invite.challenger_id, p_opponent, invite.challenger_side,
      p_round_limit, invite.challenger_id, now()
    ) returning pvp_matches.id into new_match_id;
  exception when unique_violation then
    return query select 'active_match'::text, null::uuid, invite.challenger_side;
    return;
  end;

  delete from pvp_queue where user_id in (invite.challenger_id, p_opponent);
  update challenge_invites
  set status = 'accepted', opponent_id = p_opponent, match_id = new_match_id
  where challenge_invites.id = invite.id;

  return query select 'accepted'::text, new_match_id, invite.challenger_side;
end;
$$;

create or replace function cleanup_expired_backend_state()
returns void
language plpgsql
as $$
begin
  delete from app_sessions where expires_at <= now();
  delete from rate_limits where reset_at <= now();
  delete from password_reset_tokens where expires_at <= now() or used_at is not null;
  update challenge_invites set status = 'expired'
  where status = 'open' and expires_at <= now();
  delete from corpus_system_judge_claims where claimed_at < now() - interval '1 hour';
end;
$$;
