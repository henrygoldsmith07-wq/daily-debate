-- 012: immutable human-rating corrections.
-- Normal corpus ratings are append-once ((corpus_id, rater_id) unique, first
-- submission accepted, any second submission rejected by the API). When a
-- verdict genuinely needs changing, admins use the correction path: the
-- original values are preserved in an append-only JSONB audit trail so the
-- corpus stays auditable end-to-end.

alter table corpus_ratings
  add column if not exists corrections jsonb not null default '[]'::jsonb;

create index if not exists corpus_ratings_corrections_idx
  on corpus_ratings (corpus_id) where corrections <> '[]'::jsonb;
