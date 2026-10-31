-- Explore reports: any signed-in reader can report a published debate, and
-- three reports from distinct accounts take it off Explore for good.
--
-- Published debates are public (042), and the terms promise that reports
-- exist to remove harmful material. A report is one row per reporter per
-- debate, so one account cannot take a debate down on its own. At the
-- threshold the debate is unpublished (so the feed, the page and voting all
-- treat it as private, with no new code paths) and stamped
-- explore_blocked_at, which the publish path checks so the author cannot
-- simply put it back. An operator restores one by clearing the stamp.

alter table solo_debates add column if not exists explore_blocked_at timestamptz;
alter table pvp_matches add column if not exists explore_blocked_at timestamptz;

create table if not exists debate_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  solo_debate_id uuid references solo_debates(id) on delete cascade,
  pvp_match_id uuid references pvp_matches(id) on delete cascade,
  reason text not null check (reason in ('abuse', 'personal_info', 'spam', 'other')),
  created_at timestamptz not null default now(),
  constraint debate_reports_one_target check ((solo_debate_id is null) <> (pvp_match_id is null))
);
create unique index if not exists debate_reports_solo_once
  on debate_reports(reporter_id, solo_debate_id) where solo_debate_id is not null;
create unique index if not exists debate_reports_pvp_once
  on debate_reports(reporter_id, pvp_match_id) where pvp_match_id is not null;

-- The only way a report is written. Returns 'recorded', 'taken_down' (this
-- report reached the threshold), 'already_reported', 'not_public' (missing,
-- unfinished or unpublished) or 'own_debate'.
create or replace function report_debate(
  p_reporter uuid,
  p_kind text,
  p_debate uuid,
  p_reason text,
  p_threshold integer default 3
)
returns text
language plpgsql
as $$
declare
  v_inserted integer;
  v_reports integer;
begin
  if p_reason is null or p_reason not in ('abuse', 'personal_info', 'spam', 'other') then
    raise exception 'report_debate: unknown reason';
  end if;

  if p_kind = 'solo' then
    if not exists (
      select 1 from solo_debates d
      where d.id = p_debate and d.status = 'completed' and d.published_at is not null
    ) then
      return 'not_public';
    end if;
    if exists (select 1 from solo_debates d where d.id = p_debate and d.user_id = p_reporter) then
      return 'own_debate';
    end if;
    insert into debate_reports (reporter_id, solo_debate_id, reason)
    values (p_reporter, p_debate, p_reason)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      return 'already_reported';
    end if;
    select count(*) into v_reports from debate_reports where solo_debate_id = p_debate;
    if v_reports >= p_threshold then
      update solo_debates set published_at = null, explore_blocked_at = coalesce(explore_blocked_at, now())
      where id = p_debate;
      return 'taken_down';
    end if;
  elsif p_kind = 'pvp' then
    if not exists (
      select 1 from pvp_matches m
      where m.id = p_debate and m.status = 'completed'
        and m.player_a_publish is true and m.player_b_publish is true
    ) then
      return 'not_public';
    end if;
    if exists (select 1 from pvp_matches m where m.id = p_debate and (m.player_a = p_reporter or m.player_b = p_reporter)) then
      return 'own_debate';
    end if;
    insert into debate_reports (reporter_id, pvp_match_id, reason)
    values (p_reporter, p_debate, p_reason)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      return 'already_reported';
    end if;
    select count(*) into v_reports from debate_reports where pvp_match_id = p_debate;
    if v_reports >= p_threshold then
      update pvp_matches
      set player_a_publish = false, player_b_publish = false,
          explore_blocked_at = coalesce(explore_blocked_at, now())
      where id = p_debate;
      return 'taken_down';
    end if;
  else
    raise exception 'report_debate: kind must be solo or pvp';
  end if;

  return 'recorded';
end;
$$;
