-- Friend-challenge integrity.
--
-- The HTTP flow previously created/replaced invites and accepted invites in
-- multiple statements. A crash or concurrent request could therefore leave
-- two open invites for one challenger or an accepted invite without a match.
-- These functions make both lifecycles transactional and reuse the active-PvP
-- invariant enforced by migration 020.

-- Normalise legacy rows before enforcing the one-open-invite invariant.
update challenge_invites
set status = 'expired'
where status = 'open' and expires_at <= now();

with ranked as (
  select id,
         row_number() over (
           partition by challenger_id
           order by created_at desc, id desc
         ) as rn
  from challenge_invites
  where status = 'open'
)
update challenge_invites ci
set status = 'cancelled'
from ranked r
where ci.id = r.id and r.rn > 1;

create unique index if not exists challenge_invites_one_open_per_challenger
  on challenge_invites(challenger_id)
  where status = 'open';

create or replace function generate_secure_challenge_code(p_length integer default 12)
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  bytes bytea;
  out_code text := '';
  i integer;
begin
  if p_length < 8 or p_length > 32 then
    raise exception 'challenge code length must be between 8 and 32'
      using errcode = '22023';
  end if;

  bytes := gen_random_bytes(p_length);
  for i in 0..p_length - 1 loop
    out_code := out_code || substr(
      alphabet,
      (get_byte(bytes, i) % length(alphabet)) + 1,
      1
    );
  end loop;
  return out_code;
end;
$$;

create or replace function create_friend_challenge(
  p_challenger uuid,
  p_topic_id uuid,
  p_challenger_side text,
  p_expiry_days integer default 7
)
returns setof challenge_invites
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

  -- All create/replace calls for one challenger serialize here. Identical
  -- double-clicks converge on the same invite instead of returning a stale link.
  perform pg_advisory_xact_lock(
    hashtextextended('friend-challenge-create:' || p_challenger::text, 727295)
  );

  update challenge_invites
  set status = 'expired'
  where challenger_id = p_challenger
    and status = 'open'
    and expires_at <= now();

  select ci.*
  into existing_invite
  from challenge_invites ci
  where ci.challenger_id = p_challenger
    and ci.status = 'open'
  order by ci.created_at desc, ci.id desc
  limit 1
  for update;

  if found
     and existing_invite.topic_id = p_topic_id
     and existing_invite.challenger_side = p_challenger_side
     and existing_invite.expires_at > now() then
    return next existing_invite;
    return;
  end if;

  if found then
    update challenge_invites
    set status = 'cancelled'
    where id = existing_invite.id;
  end if;

  for attempt in 1..5 loop
    begin
      insert into challenge_invites (
        code,
        challenger_id,
        topic_id,
        challenger_side,
        expires_at
      ) values (
        generate_secure_challenge_code(12),
        p_challenger,
        p_topic_id,
        p_challenger_side,
        now() + make_interval(days => p_expiry_days)
      )
      returning * into created_invite;

      return next created_invite;
      return;
    exception
      when unique_violation then
        -- A secure-code collision is extraordinarily unlikely. Retry rather
        -- than surfacing a 500; the challenger advisory lock prevents the
        -- one-open-invite index from racing normal application callers.
        if attempt = 5 then
          raise;
        end if;
    end;
  end loop;
end;
$$;

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
  -- Row lock makes exactly one concurrent accept the winner.
  select ci.*
  into invite
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

  if invite.status <> 'open' then
    return query select 'closed'::text, invite.match_id, invite.challenger_side;
    return;
  end if;

  if invite.expires_at <= now() then
    update challenge_invites set status = 'expired' where id = invite.id;
    return query select 'closed'::text, null::uuid, invite.challenger_side;
    return;
  end if;

  if exists (
    select 1
    from pvp_matches m
    where m.status = 'active'
      and (
        m.player_a in (invite.challenger_id, p_opponent)
        or m.player_b in (invite.challenger_id, p_opponent)
      )
  ) then
    return query select 'active_match'::text, null::uuid, invite.challenger_side;
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
      invite.topic_id,
      invite.challenger_id,
      p_opponent,
      invite.challenger_side,
      p_round_limit,
      invite.challenger_id,
      now()
    )
    returning id into new_match_id;
  exception
    when unique_violation then
      -- Migration 020's cross-role trigger is the final concurrency backstop.
      return query select 'active_match'::text, null::uuid, invite.challenger_side;
      return;
  end;

  delete from pvp_queue
  where user_id in (invite.challenger_id, p_opponent);

  update challenge_invites
  set status = 'accepted',
      opponent_id = p_opponent,
      match_id = new_match_id
  where id = invite.id;

  return query select 'accepted'::text, new_match_id, invite.challenger_side;
end;
$$;

-- Scheduled backend housekeeping now also materialises challenge expiry so the
-- partial unique index reflects real lifecycle state even when nobody opens an
-- old link.
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
end;
$$;
