-- 016: topic-run telemetry dimensions and timestamp fidelity.
--
-- The pipeline needs three INDEPENDENT verdicts per run, because a green run
-- on a curated fallback is an availability success and a provider failure:
--
--   availability    - did a usable topic land before the 03:00 UTC deadline
--                     (derived from freshness_ok + completed_at + target_date)
--   generator_result- ai | fallback-after-provider-failure | fallback-by-policy
--                     | failure
--   provider_health - success | invalid-response | timeout | rate-limit |
--                     authentication | quota | other
--
-- Timestamp fidelity is kept distinct rather than storing one instant under
-- several names: run_created_at is when the platform created the run, while
-- started_at is when the runner actually began. queue_delay_ms is the
-- platform's own queue time; delay_ms remains the scheduler delay measured
-- from the cron slot to the observed start.
--
-- All columns are nullable and added defensively: the telemetry writer
-- detects which columns exist and populates only those, so applying this
-- migration after a deploy cannot break recording.

alter table if exists topic_run_log
  add column if not exists run_created_at timestamptz,
  add column if not exists queue_delay_ms bigint,
  add column if not exists generator_result text,
  add column if not exists provider_health text;

alter table if exists topic_run_log
  drop constraint if exists topic_run_log_generator_result_check;

alter table if exists topic_run_log
  add constraint topic_run_log_generator_result_check
  check (generator_result is null or generator_result in (
    'ai', 'fallback-after-provider-failure', 'fallback-by-policy', 'failure'
  ));

alter table if exists topic_run_log
  drop constraint if exists topic_run_log_provider_health_check;

alter table if exists topic_run_log
  add constraint topic_run_log_provider_health_check
  check (provider_health is null or provider_health in (
    'success', 'invalid-response', 'timeout', 'rate-limit',
    'authentication', 'quota', 'other'
  ));

-- Ops health reads the retry ladder by slot and the availability verdict by
-- target date; both are served by this index.
create index if not exists topic_run_log_event_slot_idx
  on topic_run_log(event, scheduled_for desc);

create index if not exists topic_run_log_generator_result_idx
  on topic_run_log(generator_result, provider_health, target_date desc);
