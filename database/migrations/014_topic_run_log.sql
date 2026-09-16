-- 014: topic generation run telemetry.
-- The SLO needs to distinguish SCHEDULER DELAY (GitHub started late) from
-- GENERATOR FAILURE (our code failed) from AVAILABILITY FAILURE (no valid
-- topic by deadline). That requires persisting, per run, when it was
-- scheduled to start, when it actually did, and what it concluded -
-- workflow artifacts expire, so the production DB is the durable log.

create table if not exists topic_run_log (
  run_id bigint not null,
  run_attempt integer not null default 1,
  event text not null, -- schedule | workflow_dispatch | push
  scheduled_for timestamptz, -- null for non-cron events
  started_at timestamptz not null,
  completed_at timestamptz,
  delay_ms bigint, -- started_at - scheduled_for (schedule rows only)
  duration_ms bigint,
  target_date date,
  generator_outcome text, -- ai-generated | curated-fallback | provider-failure | db-failure | config-failure
  result text not null, -- pass | fail | error
  freshness_ok boolean,
  recorded_at timestamptz not null default now(),
  primary key (run_id, run_attempt)
);

create index if not exists topic_run_log_target_date_idx on topic_run_log (target_date desc);
