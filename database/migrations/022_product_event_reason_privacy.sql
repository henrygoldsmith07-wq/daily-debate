-- Product-event context is categorical only. Earlier code occasionally stored
-- a human-readable side-assignment explanation in `reason`; remove those
-- legacy free-text values before enforcing the privacy contract in the schema.

update product_events
set reason = null
where reason is not null
  and reason not in (
    'random-cold-start', 'side-balance', 'performance-gap', 'alternation-fallback',
    'needs_another_pass', 'partially_repaired', 'repair_demonstrated',
    'evidence', 'rebuttal', 'logic', 'impact', 'structure', 'clarity'
  );

alter table product_events
  drop constraint if exists product_events_reason_check;

alter table product_events
  add constraint product_events_reason_check check (
    reason is null or reason in (
      'random-cold-start', 'side-balance', 'performance-gap', 'alternation-fallback',
      'needs_another_pass', 'partially_repaired', 'repair_demonstrated',
      'evidence', 'rebuttal', 'logic', 'impact', 'structure', 'clarity'
    )
  );
