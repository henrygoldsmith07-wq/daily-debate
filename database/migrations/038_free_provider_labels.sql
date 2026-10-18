-- 038: free-tier providers Groq, Cerebras and Gemini join the AI provider
-- chain; ai_call_log must accept their labels. Expand-only: every historical
-- label stays allowed ('anthropic', 'kiraai', 'bai' rows predate their removal).
--
-- destructive-ok: drop-and-re-add of the same check constraint with a strict
-- superset of allowed values (the pattern used by 011 and 015); no row that
-- satisfied the old constraint can fail the new one.

alter table if exists ai_call_log
  drop constraint if exists ai_call_log_provider_check;

alter table if exists ai_call_log
  add constraint ai_call_log_provider_check
  check (provider in ('openrouter', 'nvidia', 'unorouter', 'kiraai', 'bai', 'anthropic', 'classifier', 'groq', 'cerebras', 'gemini'));
