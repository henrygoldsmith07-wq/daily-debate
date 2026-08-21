-- Benchmark corpus for judge verification: stores labelled debates with
-- per-rater verdicts so the pipeline scales to thousands. Mirrors
-- src/lib/humanCorpus.ts's LabeledDebate shape.

create table if not exists public.benchmark_corpus (
  id text primary key,
  transcript text not null,
  human_winner text not null check (human_winner in ('a','b','tie')),
  rater_verdicts jsonb not null default '[]'::jsonb,
  -- [{ raterId, winner, confidence?, rationale? }]
  rater_ids text[] not null default '{}',
  human_rationale text not null default '',
  topic text,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.benchmark_corpus enable row level security;

-- Readable by any authenticated user (benchmark is public); writes via service role.
create policy "Benchmark corpus readable by authenticated users"
  on public.benchmark_corpus for select using (auth.role() = 'authenticated');

-- Appeals / reports for judged matches
create table if not exists public.match_appeals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.pvp_matches(id) on delete cascade,
  filed_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('scoring_error','missed_evidence','bias','abuse','other')),
  note text not null check (char_length(note) between 20 and 600),
  status text not null default 'open' check (status in ('open','under_review','upheld','denied','withdrawn')),
  corrected_winner text check (corrected_winner in ('a','b','tie')),
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.match_appeals enable row level security;
create policy "Users can file and read own appeals" on public.match_appeals
  for select using (auth.uid() = filed_by);
create policy "Users can insert own appeals" on public.match_appeals
  for insert with check (auth.uid() = filed_by);
create policy "Users can update own appeals (withdraw)" on public.match_appeals
  for update using (auth.uid() = filed_by);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid references public.pvp_matches(id) on delete set null,
  filed_by uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('harassment','spam','cheating','impersonation','other')),
  note text not null check (char_length(note) between 1 and 600),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;
create policy "Users can file reports" on public.reports
  for insert with check (auth.uid() = filed_by);
create policy "Users can read own reports" on public.reports
  for select using (auth.uid() = filed_by);

