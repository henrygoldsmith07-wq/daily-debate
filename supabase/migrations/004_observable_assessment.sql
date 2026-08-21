-- Store the observable assessment separately from the legacy five-factor
-- display projection. The JSON contains feature values, uncertainty, score
-- composition, and evidence references for auditability.
alter table public.solo_debate_turns
  add column if not exists assessment jsonb;

