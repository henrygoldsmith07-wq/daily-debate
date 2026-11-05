-- Streak freeze (copied from Duolingo). One missed day no longer ends a
-- streak, at most once every seven days.
--
-- Rule: when a learner practises on day D, last practised on D-2 (exactly one
-- missed day, D-1), had a streak, and has not used a freeze for any day in
-- the seven days before D-1, the streak carries on: it grows by one for D
-- (the missed day is not counted) and D-1 is recorded as frozen. Two missed
-- days still end the streak. The freeze is automatic; there is nothing to
-- buy, equip or spend, so it adds no surface.
--
-- Applied in ONE place, a BEFORE UPDATE trigger on profiles, because the
-- streak has several writers (finalize_solo_debate in SQL, the PvP turn
-- route in TypeScript) and each computes "a gap means 1". The trigger only
-- acts on exactly that outcome (current_streak set to 1 across a one-day
-- gap), so every writer honours the freeze without being rewritten, and a
-- writer that already kept the streak is left alone.
--
--   profiles.streak_freeze_used_on  the most recent frozen day (the cooldown
--                                   and the week row read it)
--   streak_freeze_uses              one row per freeze used, for /analytics;
--                                   no text, cascades with account erasure.
--
-- src/lib/streakFreeze.ts mirrors the rule for display and push; keep
-- STREAK_FREEZE_COOLDOWN_DAYS there equal to the 7 below.
--
-- Additive only: one nullable column, one table, one function, one trigger.

alter table profiles add column if not exists streak_freeze_used_on date;

create table if not exists streak_freeze_uses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  frozen_day date not null,
  streak_kept integer not null check (streak_kept > 0),
  created_at timestamptz not null default now(),
  unique (user_id, frozen_day)
);
create index if not exists streak_freeze_uses_day_idx on streak_freeze_uses(frozen_day);

create or replace function apply_streak_freeze()
returns trigger
language plpgsql
as $$
declare
  v_missed date;
begin
  if old.last_activity_date is null or new.last_activity_date is null then
    return new;
  end if;
  if new.last_activity_date <> old.last_activity_date + 2 then
    return new;
  end if;
  if coalesce(old.current_streak, 0) <= 0 or new.current_streak <> 1 then
    return new;
  end if;

  v_missed := new.last_activity_date - 1;
  if old.streak_freeze_used_on is not null and old.streak_freeze_used_on > v_missed - 7 then
    return new;
  end if;

  new.current_streak := old.current_streak + 1;
  new.longest_streak := greatest(coalesce(new.longest_streak, 0), new.current_streak);
  new.streak_freeze_used_on := v_missed;

  insert into streak_freeze_uses (user_id, frozen_day, streak_kept)
  values (new.id, v_missed, old.current_streak)
  on conflict (user_id, frozen_day) do nothing;

  return new;
end;
$$;

-- Replay-safe: create the trigger only when it is missing (no drop needed).
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'profiles_streak_freeze' and tgrelid = 'profiles'::regclass
  ) then
    create trigger profiles_streak_freeze
      before update of last_activity_date on profiles
      for each row execute function apply_streak_freeze();
  end if;
end;
$$;
