-- 019: generation_reason — the best SUPPORTED explanation of how the
-- immutable topic row was ORIGINALLY created.
--
-- generation_source answers "what kind of content is this" (ai | fallback).
-- generation_reason answers "how did it come to exist", separately:
--
--   ai                         produced by the AI candidate chain
--   fallback-provider-failure  curated fallback after real provider failure
--   fallback-policy            curated fallback with no provider attempted
--   request-time-fallback      curated fallback persisted by the app at
--                              request time when nothing was stored
--   legacy-unknown             historical row (pre-reason tracking) whose
--                              exact creation reason is NOT recoverable
--
-- PROVENANCE HONESTY: legacy-unknown exists so this backfill does not invent
-- history. A pre-019 `generation_source = 'fallback'` row may have been a
-- policy fallback OR a provider-failure fallback — recording the confident
-- 'fallback-policy' would launder a guess into audit-grade fact. Unknown beats
-- a confident-but-invented category.
--
-- The distinction is auditable provenance, not cosmetics: an
-- `already-present` retry must READ this value and report it unchanged —
-- it never reconstructs or mutates it.
--
-- SCOPE OF legacy-unknown: ONLY this backfill may write it. New canonical
-- writers carry a closed type union that excludes it, and the freshness
-- verifier rejects legacy-unknown on any row created after this migration
-- applied (app_migrations.applied_at dates the boundary).

alter table if exists daily_topics
  add column if not exists generation_reason text;

alter table if exists daily_topics
  drop constraint if exists daily_topics_generation_reason_check;

alter table if exists daily_topics
  add constraint daily_topics_generation_reason_check
  check (generation_reason is null or generation_reason in (
    'ai', 'fallback-provider-failure', 'fallback-policy',
    'request-time-fallback', 'legacy-unknown'
  ));

-- Backfill conservatively: source 'ai' is unambiguous; source 'fallback'
-- predates reason tracking and its true reason is unrecoverable, so it takes
-- the least-claiming value. Rows stay NULL only when source itself was never
-- recorded (then no claim is made at all).
update daily_topics
   set generation_reason = case generation_source
     when 'ai' then 'ai'
     when 'fallback' then 'legacy-unknown'
     else null
   end
 where generation_reason is null;
