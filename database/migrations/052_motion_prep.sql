-- Prep cards for a motion (copied from DebateOwl's prep: the strongest point
-- on each side and an "If they say..." reply). Un-parks "research/prep mode"
-- by the owner's choice (Nov 2026).
--
-- One row per motion, shared by every learner: prep is about the motion, not
-- about anyone's debating, so it is generated once and reused (one AI call per
-- motion, not per learner). It never names a skill and is identical for
-- everyone, so it cannot cue a pending deliberate retest (retestDisclosure).
-- Write-once: the first stored prep for a motion is the one everyone sees.
--
-- Additive only: one new table.

create table if not exists motion_prep (
  topic_id uuid primary key references daily_topics(id) on delete cascade,
  content jsonb not null,
  created_at timestamptz not null default now()
);
