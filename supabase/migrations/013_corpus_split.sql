-- Locked test set: prevent tuning against evaluation data.
-- Split: 'development' (safe to iterate against), 'validation' (periodic checks),
-- 'locked' (run once at final validation; must not inform development).

alter table public.corpus_items
  add column if not exists split text not null default 'development'
    check (split in ('development', 'validation', 'locked'));

create index if not exists corpus_items_split_idx on public.corpus_items (split);

-- Corpus ratings inherit split context from their parent item.
-- No changes needed on corpus_ratings; join through corpus_id when filtering.

-- Existing items are retroactively assigned: first 60% development,
-- next 20% validation, last 20% locked (deterministic by created_at order).
with ranked as (
  select id, row_number() over (order by created_at asc) as rn,
         count(*) over () as total
  from public.corpus_items where split = 'development'
)
update public.corpus_items c set split =
  case
    when r.rn <= r.total * 0.6 then 'development'
    when r.rn <= r.total * 0.8 then 'validation'
    else 'locked'
  end
from ranked r where c.id = r.id;
