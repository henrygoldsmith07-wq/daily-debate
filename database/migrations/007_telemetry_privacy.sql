-- AI telemetry privacy hardening: provider errors are no longer stored
-- verbatim. Failures are reduced to bounded structured fields by
-- aiTelemetry.classifyAiError; the `error` column now holds only a
-- sanitised, truncated diagnostic (credentials/response bodies stripped).
--
-- Privacy posture: database persistence is BEST-EFFORT (fire-and-forget
-- mirror), not guaranteed delivery — the structured log drain is the
-- guaranteed record.

alter table ai_call_log
  add column if not exists error_category text,
  add column if not exists error_code text,
  add column if not exists http_status integer,
  add column if not exists retryable boolean;

-- Old rows may contain raw provider text from before the hardening.
update ai_call_log set error = null where error is not null;

create index if not exists ai_call_log_category_idx on ai_call_log(error_category, created_at desc);
