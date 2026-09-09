-- AI call log: durable observability for every model call (operation, model,
-- tokens, latency, outcome). Complements the in-process ring buffer in
-- aiTelemetry.ts so latency/error dashboards survive cold starts, without
-- recording any user content — only bounded operational fields.

create table if not exists ai_call_log (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  provider text not null check (provider in ('openrouter', 'anthropic')),
  model text not null,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  latency_ms integer not null check (latency_ms >= 0),
  outcome text not null check (outcome in ('ok', 'error')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists ai_call_log_operation_idx on ai_call_log(operation, created_at desc);
create index if not exists ai_call_log_created_idx on ai_call_log(created_at desc);
