-- M9 spaced re-check: link a repair's 7-day re-check to the debate assigned for it.
-- Additive and nullable; existing rows and code paths are unaffected.
alter table repair_results
  add column if not exists recheck_debate_id uuid references solo_debates(id) on delete set null;

create index if not exists repair_results_recheck_debate_idx
  on repair_results(recheck_debate_id) where recheck_debate_id is not null;
