-- Explore reports: serialise reports on the same debate.
--
-- 046's report_debate inserted a report, then counted. Under READ COMMITTED
-- two reports in flight at once each see the committed reports plus only
-- their own, so when the second and third arrive together both count two and
-- the debate stays up with three reports until a fourth comes in.
--
-- Fix: lock the debate row (FOR NO KEY UPDATE, so FK inserts that reference
-- it, such as votes, are not blocked) before checking and counting. A
-- concurrent report on the same debate waits, then counts with a fresh
-- snapshot that includes the first. Same signature and outcomes as 046.
--
-- Additive only: replaces one function in place.

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
    perform 1 from solo_debates d where d.id = p_debate for no key update;
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
    perform 1 from pvp_matches m where m.id = p_debate for no key update;
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
