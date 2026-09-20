-- 018: canonical topic fingerprints + per-attempt provider telemetry.
--
-- A daily topic is immutable once valid: retries verify rather than replace.
-- True idempotence therefore needs content identity, not just "two runs
-- succeeded for the same date":
--
--   topic_fingerprint = SHA-256(schemaVersion + topicDate + title + prompt
--     + category), recorded on the topic row, stamped onto every evidence
--     card generated for that exact revision, and reported in run telemetry.
--
-- Evidence integrity follows from the same key: every evidence card must
-- carry the fingerprint of the topic revision it was generated for, so a
-- verifier can prove no stale card from replaced content survives.
-- provider_attempts persists the bounded per-model attempt ledger
-- (provider/model/outcome/latency/httpStatus/errorCategory) for
-- longitudinal aggregation; the full record (with raw error text) stays in
-- the workflow artifact, never in the database.

alter table if exists daily_topics
  add column if not exists topic_fingerprint text;

alter table if exists topic_evidence
  add column if not exists topic_fingerprint text;

alter table if exists topic_run_log
  add column if not exists topic_fingerprint text,
  add column if not exists provider_attempts jsonb;

create index if not exists topic_evidence_fingerprint_idx
  on topic_evidence (topic_id, topic_fingerprint);
