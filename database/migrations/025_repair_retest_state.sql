-- Durable repair -> deliberate retest state.
--
-- A successful repair can be assigned to more than one later debate when an
-- assigned debate offers no observable opportunity. Completion is therefore a
-- property of an assignment row, not something inferred forever from a
-- bounded skill-ledger window.

create table if not exists repair_retests (
  id uuid primary key default gen_random_uuid(),
  repair_result_id uuid not null references repair_results(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  repair_debate_id uuid not null references solo_debates(id) on delete cascade,
  target_kind text not null check (target_kind in ('evidence', 'rebuttal', 'logic', 'impact', 'structure', 'clarity')),
  assigned_debate_id uuid not null references solo_debates(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  observable boolean,
  demonstrated boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repair_result_id, assigned_debate_id),
  check (observable is null or completed_at is not null),
  check (demonstrated is distinct from true or observable is true)
);

create index if not exists repair_retests_user_idx
  on repair_retests(user_id, assigned_at desc);

create index if not exists repair_retests_completion_idx
  on repair_retests(repair_result_id, observable, completed_at desc);

-- Backfill deliberate assignments already stored in solo_debates.coaching.
-- Prefer the explicit repairResultId written by current builds; for legacy
-- rows, fall back to the earliest successful repair for the same
-- (user, repaired debate, target kind), matching the application's canonical
-- repair-episode identity.
insert into repair_retests (
  repair_result_id,
  user_id,
  repair_debate_id,
  target_kind,
  assigned_debate_id,
  assigned_at,
  completed_at,
  observable,
  demonstrated
)
select
  matched.id,
  sd.user_id,
  matched.debate_id,
  matched.target_kind,
  sd.id,
  sd.created_at,
  case when sd.status = 'completed' then sd.completed_at else null end,
  case
    when sd.status <> 'completed' then null
    when exists (
      select 1 from product_events pe
      where pe.user_id = sd.user_id
        and pe.debate_id = sd.id
        and pe.name in ('retest_completed', 'retest_skill_demonstrated')
    ) then true
    else null
  end,
  case
    when exists (
      select 1 from product_events pe
      where pe.user_id = sd.user_id
        and pe.debate_id = sd.id
        and pe.name = 'retest_skill_demonstrated'
    ) then true
    when exists (
      select 1 from product_events pe
      where pe.user_id = sd.user_id
        and pe.debate_id = sd.id
        and pe.name = 'retest_completed'
    ) then false
    else null
  end
from solo_debates sd
join lateral (
  select rr.id, rr.debate_id, rr.target_kind
  from repair_results rr
  where rr.user_id = sd.user_id
    and rr.succeeded = true
    and rr.debate_id::text = sd.coaching->'repairRetest'->>'repairDebateId'
    and rr.target_kind = sd.coaching->'repairRetest'->>'targetKind'
  order by
    case
      when rr.id::text = coalesce(sd.coaching->'repairRetest'->>'repairResultId', '') then 0
      else 1
    end,
    rr.created_at asc,
    rr.id asc
  limit 1
) matched on true
where sd.coaching->'repairRetest' is not null
on conflict (repair_result_id, assigned_debate_id) do nothing;

-- Historical builds could theoretically have created more than one still-open
-- assignment for the same repair before durable state existed. Keep the newest
-- one open and preserve older assignment provenance as completed/unobservable.
with ranked_open as (
  select
    id,
    row_number() over (
      partition by repair_result_id
      order by assigned_at desc, id desc
    ) as rn
  from repair_retests
  where completed_at is null
)
update repair_retests rr
set
  completed_at = rr.assigned_at,
  observable = false,
  demonstrated = null,
  updated_at = now()
from ranked_open ranked
where rr.id = ranked.id
  and ranked.rn > 1;

-- One debate can only be the deliberate transfer test for one repair episode.
create unique index if not exists repair_retests_assigned_debate_unique
  on repair_retests(assigned_debate_id);

-- Do not let concurrent debate-start requests assign the same repair twice.
-- A completed but unobservable assignment frees the repair for another later
-- deliberate test because completed_at is no longer null.
create unique index if not exists repair_retests_one_open_per_repair
  on repair_retests(repair_result_id)
  where completed_at is null;
