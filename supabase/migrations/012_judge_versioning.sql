-- Judge versioning + health tracking: every verdict carries a fingerprint so
-- model drift is attributable, and benchmark history enables auto-retirement.

-- Full version fingerprint embedded on every PvP match verdict.
alter table public.pvp_matches
  add column if not exists judge_fingerprint jsonb;

create index if not exists pvp_matches_fingerprint_idx
  on public.pvp_matches using gin (judge_fingerprint);

-- Benchmark health log: one row per scheduled run per model.
create table if not exists public.judge_health_log (
  id uuid primary key default gen_random_uuid(),
  judge_id text not null,
  date date not null default current_date,
  position_mirror_stability numeric not null check (position_mirror_stability >= 0 and position_mirror_stability <= 1),
  verbosity_stability numeric not null check (verbosity_stability >= 0 and verbosity_stability <= 1),
  human_agreement numeric not null check (human_agreement >= 0 and human_agreement <= 1),
  ece numeric not null,
  false_citation_influence numeric not null check (false_citation_influence >= 0 and false_citation_influence <= 1),
  gates_passed boolean not null default false,
  retired boolean not null default false,
  retirement_reason text,
  created_at timestamptz not null default now(),
  unique (judge_id, date)
);

alter table public.judge_health_log enable row level security;

create policy "Health log readable by authenticated users"
  on public.judge_health_log for select using (auth.role() = 'authenticated');

-- Writes happen via service role during scheduled benchmarks.
