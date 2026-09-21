-- 019: generation_reason — how the immutable topic was ORIGINALLY created.
--
-- generation_source answers "what kind of content is this" (ai | fallback).
-- generation_reason answers "how did it come to exist", separately:
--
--   ai                         produced by the AI candidate chain
--   fallback-provider-failure  curated fallback after real provider failure
--   fallback-policy            curated fallback with no provider attempted
--   request-time-fallback      curated fallback persisted by the app at
--                              request time when nothing was stored
--
-- The distinction is auditable provenance, not cosmetics: an
-- `already-present` retry must READ this value and report it unchanged —
-- it never reconstructs or mutates it. Unknown/pre-019 rows stay NULL
-- rather than being guessed.

alter table if exists daily_topics
  add column if not exists generation_reason text;

alter table if exists daily_topics
  drop constraint if exists daily_topics_generation_reason_check;

alter table if exists daily_topics
  add constraint daily_topics_generation_reason_check
  check (generation_reason is null or generation_reason in (
    'ai', 'fallback-provider-failure', 'fallback-policy', 'request-time-fallback'
  ));

-- Backfill legacy rows conservatively: source 'ai' is unambiguous; source
-- 'fallback' predates reason tracking, so it takes the least-claiming
-- policy value. Rows stay NULL only when source itself was never recorded.
update daily_topics
   set generation_reason = case generation_source
     when 'ai' then 'ai'
     when 'fallback' then 'fallback-policy'
     else null
   end
 where generation_reason is null;
