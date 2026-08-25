-- Real evidence attached to daily topics: retrieved documents reduced to
-- verifiable evidence cards (claim / source / passage / date / type) with
-- per-card verification results computed at retrieval time.

create table if not exists public.topic_evidence (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.daily_topics (id) on delete cascade,
  claim text not null,
  source_name text not null,
  source_type text not null check (source_type in ('primary', 'news', 'secondary', 'tertiary')),
  url text not null,
  title text,
  passage text not null,
  published_date date,
  checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (topic_id, url)
);

alter table public.topic_evidence enable row level security;

create policy "Topic evidence readable by authenticated users"
  on public.topic_evidence for select using (auth.role() = 'authenticated');

-- Writes happen through the service role during topic generation.
