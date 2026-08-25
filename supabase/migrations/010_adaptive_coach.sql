-- Adaptive coach: measurable drill assignments. Each row records the skill
-- dimension trained, the user's score BEFORE the drill, their scored attempt,
-- and (filled in later by the ledger) the skill movement observed in
-- subsequent debates — so drills that do not produce improvement stop being
-- recommended.

create table if not exists public.drill_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  dimension text not null check (dimension in ('evidence','rebuttal','logic','clarity','impact','steelmanning','structure')),
  minutes integer not null default 3 check (minutes between 2 and 5),
  title text not null,
  prompt text not null,
  assigned_date date not null default current_date,
  before_score numeric check (before_score >= 0 and before_score <= 100),
  attempt_text text,
  attempt_score numeric check (attempt_score >= 0 and attempt_score <= 100),
  movement numeric,
  status text not null default 'open' check (status in ('open', 'attempted')),
  created_at timestamptz not null default now(),
  -- One focused drill per day per user keeps practice deliberate, not spammy.
  unique (user_id, assigned_date)
);

alter table public.drill_assignments enable row level security;
create policy "Users read own drills" on public.drill_assignments
  for select using (auth.uid() = user_id);
create policy "Users create own drills" on public.drill_assignments
  for insert with check (auth.uid() = user_id);
create policy "Users update own drills" on public.drill_assignments
  for update using (auth.uid() = user_id);
