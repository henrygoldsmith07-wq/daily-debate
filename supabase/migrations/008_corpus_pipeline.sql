-- Population pipeline for the human-evaluation corpus + PvP reliability.

-- ---------------------------------------------------------------------------
-- 1. PvP turn integrity: enforce one turn per (match, round, player) at the
-- DB level. The API's optimistic-concurrency guard assumed this existed.
-- ---------------------------------------------------------------------------
create unique index if not exists pvp_turns_match_player_round_uniq
  on public.pvp_turns (match_id, player_id, round_number);

-- When the current turn began — powers abandoned-match forfeiture and
-- late-submission rejection.
alter table public.pvp_matches add column if not exists turn_started_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Blind human-rating pipeline.
-- corpus_items holds candidate debate responses imported from finished
-- debates. Identifying columns (contributor_id, side_mapping, ability_band)
-- are NEVER exposed through the rater-facing API — the rater sees only an
-- anonymised transcript with sides labelled "A"/"B".
-- ---------------------------------------------------------------------------
create table if not exists public.corpus_items (
  id uuid primary key default gen_random_uuid(),
  transcript text not null,
  topic text,
  source_type text not null check (source_type in ('solo', 'pvp')),
  source_id uuid,
  contributor_id uuid not null references public.profiles (id),
  side_mapping jsonb not null default '{}'::jsonb,
  length_bucket text not null check (length_bucket in ('short', 'medium', 'long')),
  subject_category text,
  ability_band text not null check (ability_band in ('novice', 'intermediate', 'advanced')),
  -- Needed later for system-vs-human comparison: the judge is prompted with
  -- the real motion and each anonymised side's stance (for/against).
  topic_id uuid,
  topic_title text not null default '',
  topic_prompt text not null default '',
  status text not null default 'open' check (status in ('open', 'rated', 'adjudicated', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.corpus_items enable row level security;
-- Deliberately NO select policy for authenticated users: anonymity of the
-- blind protocol depends on raters reaching items only through the service
-- role (API routes), which strips identifying metadata.

create table if not exists public.corpus_ratings (
  id uuid primary key default gen_random_uuid(),
  corpus_id uuid not null references public.corpus_items (id) on delete cascade,
  rater_id uuid not null references public.profiles (id),
  -- Six-dimension rubric, 1..5 per dimension, keyed by dimension name:
  -- evidenceQuality, reasoning, relevance, rebuttalQuality, logicalValidity,
  -- sourceQuality.
  scores_a jsonb not null,
  scores_b jsonb not null,
  winner text not null check (winner in ('a', 'b', 'tie')),
  confidence numeric check (confidence >= 0 and confidence <= 1),
  rationale text not null default '',
  created_at timestamptz not null default now(),
  unique (corpus_id, rater_id)
);

alter table public.corpus_ratings enable row level security;
create policy "Raters read own ratings" on public.corpus_ratings
  for select using (auth.uid() = rater_id);
create policy "Raters insert own ratings" on public.corpus_ratings
  for insert with check (auth.uid() = rater_id);
