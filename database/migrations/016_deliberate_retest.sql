-- 016: deliberate retest tracking + personalised practice motions.
--
-- The learning loop is: debate -> one weakness -> repair -> deliberate
-- retest on a DIFFERENT topic -> longitudinal evidence. This migration adds
-- the persistence that loop was missing:
--
--   1. solo_debates.retest_for   — a debate that is a deliberate retest of a
--      specific repair, so the UI can say so before the debate begins and the
--      finish step can record a truthful outcome on the repair row.
--   2. repair_results.retest_*   — the queued/completed retest state and its
--      outcome ('skill-observed' | 'skill-not-observed' |
--      'no-valid-opportunity' | 'not-enough-evidence'). One retest per repair;
--      later eligible debates continue to feed the longitudinal measurement
--      in repairEffectiveness without touching these columns.
--   3. daily_topics: shared daily motions keep topic_date (UNIQUE — the
--      generation pipeline depends on that constraint and refuses to run
--      without it). Personalised practice motions are minted with a NULL
--      topic_date and is_personal = true: Postgres UNIQUE treats NULLs as
--      distinct, so many practice motions can coexist with the single shared
--      motion per date. topic_date becomes nullable for that purpose only.
--   4. profiles.guest_context  — a guest's completed practice loop (weakness,
--      repair, retest result) carried through signup so the first account
--      experience doesn't start from zero.

alter table daily_topics alter column topic_date drop not null;

alter table daily_topics
  add column if not exists is_personal boolean not null default false;

create index if not exists daily_topics_personal_idx
  on daily_topics(is_personal, created_at desc);

alter table solo_debates
  add column if not exists retest_for uuid references repair_results(id) on delete set null;

create index if not exists solo_debates_retest_idx on solo_debates(retest_for);

alter table repair_results
  add column if not exists retest_debate_id uuid references solo_debates(id) on delete set null,
  add column if not exists retest_outcome text
    check (retest_outcome in ('skill-observed', 'skill-not-observed', 'no-valid-opportunity', 'not-enough-evidence')),
  add column if not exists retest_completed_at timestamptz;

create index if not exists repair_results_retest_idx on repair_results(user_id, retest_debate_id);

alter table profiles
  add column if not exists guest_context jsonb;
