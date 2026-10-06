-- Opponent adversary controls (persona + difficulty) and expanded solo
-- practice formats (flash, cross-examination, socratic).
--
-- Persona changes HOW the AI opponent attacks; difficulty changes HOW HARD.
-- Both default to the previous single-opponent behaviour ('balanced' +
-- 'challenging'), so existing rows keep their meaning and no backfill is
-- needed. The format check constraint is widened in place; product_events
-- gains the same new format values plus a solo_debate_started event so the
-- funnel can distinguish the new formats from full debates.

alter table solo_debates
  add column if not exists persona text not null default 'balanced'
    check (persona in ('balanced', 'skeptic', 'lawyer', 'philosopher', 'economist', 'devils-advocate', 'expert')),
  add column if not exists difficulty text not null default 'challenging'
    check (difficulty in ('easy', 'challenging', 'expert'));

-- Widen the solo_debates.format check (added unnamed in 004; PostgreSQL names
-- it <table>_<column>_check deterministically). Idempotent: the drop is a
-- no-op when the widened constraint is already in place.
alter table solo_debates drop constraint if exists solo_debates_format_check;
alter table solo_debates
  add constraint solo_debates_format_check
  check (format in ('sprint', 'full', 'flash', 'cross-examination', 'socratic'));

-- Widen the product event allowlist the same way: new formats are recorded
-- with their real format value, and the new start event keeps the funnel able
-- to tell the new formats apart from full debates.
alter table product_events drop constraint if exists product_events_name_check;
alter table product_events
  add constraint product_events_name_check
  check (name in (
    'daily_viewed', 'debate_started', 'sprint_started', 'full_debate_started',
    'solo_debate_started', 'round_completed', 'debate_completed',
    'repair_started', 'repair_completed', 'full_analysis_opened',
    'progress_viewed', 'pvp_started', 'challenge_me_selected',
    'challenge_link_created', 'challenge_link_accepted'
  ));

alter table product_events drop constraint if exists product_events_format_check;
alter table product_events
  add constraint product_events_format_check
  check (format in ('sprint', 'full', 'flash', 'cross-examination', 'socratic'));
