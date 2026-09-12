-- Free judge providers beyond OpenRouter/NVIDIA (unorouter, kiraai, bai) may
-- now serve calls; the ai_call_log provider check must accept them.
-- Historical rows keep their original labels; 'anthropic' stays allowed for
-- rows written while that transport was configured.
alter table if exists ai_call_log
  drop constraint if exists ai_call_log_provider_check;
alter table if exists ai_call_log
  add constraint ai_call_log_provider_check
  check (provider in ('openrouter', 'nvidia', 'unorouter', 'kiraai', 'bai', 'anthropic'));
