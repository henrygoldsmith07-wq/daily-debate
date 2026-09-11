-- Human-corpus presentation randomisation: record which side was presented
-- first to each rater so position bias in human ratings is measurable.
-- Historical rows predate randomisation; they were always shown Side A
-- first (see anonymiseTranscript), so 'a' is the truthful backfill.
alter table if exists corpus_ratings
  add column if not exists presented_first text not null default 'a'
  check (presented_first in ('a', 'b'));
