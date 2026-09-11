-- Topic generation provenance: record whether tomorrow's topic came from the
-- AI pipeline or the curated fallback list, so the ops-health report can
-- distinguish generated/fallback status instead of guessing from content.
alter table if exists daily_topics
  add column if not exists generation_source text not null default 'unknown'
  check (generation_source in ('ai', 'fallback', 'unknown'));
