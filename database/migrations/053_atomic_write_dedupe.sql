-- Close two check-then-insert races that duplicated durable rows under
-- concurrent requests (a double-click, a retried request, or two admins
-- importing in parallel). Both fixes are additive: old builds keep working,
-- but a concurrent duplicate now conflicts instead of silently writing twice.
--
-- repair_results: the route used to SELECT for an identical rewrite and then
-- INSERT. Two requests could both see "no duplicate" and both write, inflating
-- failed-attempt counts and the repair funnel. Index a bounded MD5 fingerprint
-- rather than the raw rewrite text: the route accepts up to 2,000 characters,
-- and a multi-byte rewrite can exceed Postgres' btree row-size limit.
alter table repair_results
  add column if not exists rewrite_fingerprint text
  generated always as (md5(rewrite_text)) stored;

create unique index if not exists repair_results_one_rewrite_per_attempt
  on repair_results (user_id, debate_id, target_kind, rewrite_fingerprint);

-- corpus_items: import read the existing source keys once, then inserted per
-- debate. Two concurrent imports inserted the same debate twice, giving raters
-- two "independent" copies of one ground-truth item.
create unique index if not exists corpus_items_one_per_source
  on corpus_items (source_type, source_id);
