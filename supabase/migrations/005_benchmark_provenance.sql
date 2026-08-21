-- Do not infer human validity from rater-shaped JSON alone. Imported benchmark
-- rows must carry provenance before they can be reported as human-labelled.
alter table public.benchmark_corpus
  add column if not exists provenance text not null default 'unverified_repository_fixture'
    check (provenance in ('verified_human', 'unverified_repository_fixture', 'synthetic')),
  add column if not exists provenance_record jsonb;

