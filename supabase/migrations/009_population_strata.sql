-- Population-campaign stratification: the flagship corpus targets 1,000+
-- debates x 3 independent ratings, spread across debate difficulty, evidence
-- density, and writing style — all derived deterministically at import time
-- from the observable argument assessment (no model judgement involved).
-- Indexes support the admin console's per-stratum recruitment queries.

alter table public.corpus_items
  add column if not exists dynamics_tier text check (dynamics_tier in ('close', 'decisive', 'weak_vs_weak')),
  add column if not exists evidence_density text check (evidence_density in ('evidence_heavy', 'balanced', 'evidence_light')),
  add column if not exists style_bucket text check (style_bucket in ('formal', 'hedged', 'plain', 'intense'));

create index if not exists corpus_items_dynamics_idx on public.corpus_items (dynamics_tier);
create index if not exists corpus_items_evidence_idx on public.corpus_items (evidence_density);
create index if not exists corpus_items_style_idx on public.corpus_items (style_bucket);
