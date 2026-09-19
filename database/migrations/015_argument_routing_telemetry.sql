-- 015: classifier.dev structural-routing telemetry.
--
-- The classifier receives argument text, but the durable telemetry below does
-- not. It stores only bounded operational fields: taxonomy version, batch
-- size, route, fallback/ambiguity counts, and expensive judge legs avoided.

alter table if exists ai_call_log
  drop constraint if exists ai_call_log_provider_check;

alter table if exists ai_call_log
  add constraint ai_call_log_provider_check
  check (provider in ('openrouter', 'nvidia', 'unorouter', 'kiraai', 'bai', 'anthropic', 'classifier'));

alter table if exists ai_call_log
  add column if not exists event_type text not null default 'model_call',
  add column if not exists input_count integer,
  add column if not exists batch_count integer,
  add column if not exists taxonomy_version text,
  add column if not exists routing_decision text,
  add column if not exists expensive_judge_calls_avoided integer,
  add column if not exists classification_fallbacks integer,
  add column if not exists classification_ambiguous integer;

alter table if exists ai_call_log
  drop constraint if exists ai_call_log_event_type_check;

alter table if exists ai_call_log
  add constraint ai_call_log_event_type_check
  check (event_type in ('model_call', 'routing'));

create index if not exists ai_call_log_routing_idx
  on ai_call_log(event_type, routing_decision, created_at desc);
