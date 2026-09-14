-- 013: item-side rating counter for atomic closure.
-- Snapshot counting of corpus_ratings inside the closure statement cannot
-- observe ratings committed by concurrent transactions after the statement's
-- snapshot began; a persisted counter incremented under the item's row lock
-- is exact at the increment moment regardless of snapshots.
-- Backfill: recompute from actual ratings (idempotent, never destructive).

alter table corpus_items
  add column if not exists rating_count integer not null default 0;

update corpus_items ci
set rating_count = (
  select count(*)::int from corpus_ratings cr where cr.corpus_id = ci.id
);
