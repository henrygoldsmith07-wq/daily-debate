-- Explore: finished debates people chose to publish, and a crowd vote on who
-- argued better.
--
-- Taken from Geo Debates: a debate is worth more than its two participants'
-- scores. Once finished it can sit in a public feed, and viewers vote on which
-- side ARGUED BETTER — never on which side is right.
--
-- Publication is consent, so it is explicit and reversible:
--   * A solo debate (learner vs AI opponent) is public while its learner has
--     published it (solo_debates.published_at is set).
--   * A PvP match is public only while BOTH players have said yes
--     (pvp_matches.player_a_publish and player_b_publish both true). Either
--     player saying no, at any time, takes it down.
-- Nothing is published by default; every column below starts null.
--
-- One vote per viewer per debate, for a side. Participants cannot vote on
-- their own debate: enforced in cast_debate_vote, the only writer.
--
-- Additive only: new nullable columns, one new table, one new function.

alter table solo_debates add column if not exists published_at timestamptz;
alter table pvp_matches add column if not exists player_a_publish boolean;
alter table pvp_matches add column if not exists player_b_publish boolean;

create index if not exists solo_debates_published_idx
  on solo_debates(published_at desc) where published_at is not null;
create index if not exists pvp_matches_published_idx
  on pvp_matches(completed_at desc) where player_a_publish and player_b_publish;

create table if not exists debate_votes (
  id uuid primary key default gen_random_uuid(),
  voter_id uuid not null references profiles(id) on delete cascade,
  solo_debate_id uuid references solo_debates(id) on delete cascade,
  pvp_match_id uuid references pvp_matches(id) on delete cascade,
  choice text not null check (choice in ('for', 'against')),
  created_at timestamptz not null default now(),
  constraint debate_votes_one_target check ((solo_debate_id is null) <> (pvp_match_id is null))
);
create unique index if not exists debate_votes_solo_once
  on debate_votes(voter_id, solo_debate_id) where solo_debate_id is not null;
create unique index if not exists debate_votes_pvp_once
  on debate_votes(voter_id, pvp_match_id) where pvp_match_id is not null;
create index if not exists debate_votes_solo_idx on debate_votes(solo_debate_id) where solo_debate_id is not null;
create index if not exists debate_votes_pvp_idx on debate_votes(pvp_match_id) where pvp_match_id is not null;

-- The only way a vote is written. Returns 'recorded', 'already_voted',
-- 'not_public' (missing, unfinished or unpublished) or 'own_debate'.
create or replace function cast_debate_vote(
  p_voter uuid,
  p_kind text,
  p_debate uuid,
  p_choice text
)
returns text
language plpgsql
as $$
declare
  v_inserted integer;
begin
  if p_choice is null or p_choice not in ('for', 'against') then
    raise exception 'cast_debate_vote: choice must be for or against';
  end if;

  if p_kind = 'solo' then
    if not exists (
      select 1 from solo_debates d
      where d.id = p_debate and d.status = 'completed' and d.published_at is not null
    ) then
      return 'not_public';
    end if;
    if exists (select 1 from solo_debates d where d.id = p_debate and d.user_id = p_voter) then
      return 'own_debate';
    end if;
    insert into debate_votes (voter_id, solo_debate_id, choice)
    values (p_voter, p_debate, p_choice)
    on conflict do nothing;
  elsif p_kind = 'pvp' then
    if not exists (
      select 1 from pvp_matches m
      where m.id = p_debate and m.status = 'completed'
        and m.player_a_publish is true and m.player_b_publish is true
    ) then
      return 'not_public';
    end if;
    if exists (select 1 from pvp_matches m where m.id = p_debate and (m.player_a = p_voter or m.player_b = p_voter)) then
      return 'own_debate';
    end if;
    insert into debate_votes (voter_id, pvp_match_id, choice)
    values (p_voter, p_debate, p_choice)
    on conflict do nothing;
  else
    raise exception 'cast_debate_vote: kind must be solo or pvp';
  end if;

  get diagnostics v_inserted = row_count;
  return case when v_inserted = 1 then 'recorded' else 'already_voted' end;
end;
$$;
