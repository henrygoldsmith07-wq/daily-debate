-- Session-level funnel measurement: attach a bounded flow identifier to the
-- events that form the debate/repair funnel so completion can be reported per
-- SESSION as well as per USER. A user who starts 10 sprints and completes 1
-- must read as 10% session completion, not 100% user conversion.
--
-- Privacy: debate_id is a random UUID referencing the user's own debate row —
-- it carries no free text and is meaningless outside the funnel query.

alter table product_events
  add column if not exists debate_id uuid;

-- Funnel queries always group by (name, debate_id) or (user_id); both indexes
-- stay small because product_events rows are bounded-context only.
create index if not exists product_events_debate_idx on product_events(debate_id, name);
