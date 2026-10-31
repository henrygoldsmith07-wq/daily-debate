-- Aggregate daily counts for live guest sprints (additive).
--
-- Signed-out learners can now debate today's motion against the real AI
-- opponent. product_events is per-user by design and guests have no user, so
-- guest sprints were invisible to the weekly scorecard. This table records
-- ONLY two counters per calendar day (UTC): sprints whose opening was served,
-- and sprints whose final round was answered. No identifier of any kind, no
-- text, no IP, no device id: it cannot be joined to a person, so it needs no
-- erasure path.

create table if not exists guest_sprint_daily (
  day date primary key,
  started integer not null default 0 check (started >= 0),
  completed integer not null default 0 check (completed >= 0),
  updated_at timestamptz not null default now()
);
