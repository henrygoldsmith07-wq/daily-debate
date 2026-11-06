-- Account erasure keeps the corpus counters honest.
--
-- delete_app_account (037) deletes the erased learner's ratings on OTHER
-- people's corpus items, but never touched those items' rating_count or
-- status. Every erasure of a rater therefore left rating-count-drift, and an
-- item closed at the collection target ('rated' / 'adjudicated') stayed
-- closed with fewer independent ratings than the target - the two corpus
-- invariants check-corpus-invariants.mjs exists to catch.
--
-- delete_app_account_v2(p_user_id, p_min_raters) does what 037 does, then,
-- for each item that lost a rating (the erased learner's own contributed
-- items are deleted outright), under the item row lock:
--   * rating_count := the real number of rating rows;
--   * 'rated' below p_min_raters -> 'open', so collection can finish;
--   * 'adjudicated' below p_min_raters -> 'open', with the adjudication kept
--     only as stale provenance (the same marking migration 024 used).
-- No rating row is edited or created: corpus ratings stay append-once. The
-- result reports how many items were recounted and reopened.
--
-- The threshold is a parameter (the app passes RATING_COLLECTION_TARGET from
-- src/lib/corpus.ts) so it never drifts from the rating route's.
--
-- Additive only: a NEW function. delete_app_account (037) is left as it is,
-- so a deploy still running the old route keeps working; once no caller
-- remains it can be retired in its own migration.

create or replace function delete_app_account_v2(p_user_id uuid, p_min_raters integer)
returns jsonb
language plpgsql
as $$
declare
  v_user bigint := 0;
  v_matches bigint := 0;
  v_invites bigint := 0;
  v_ratings bigint := 0;
  v_items bigint := 0;
  v_recounted bigint := 0;
  v_reopened bigint := 0;
  v_affected uuid[];
begin
  if p_min_raters is null or p_min_raters < 1 then
    raise exception 'delete_app_account_v2: p_min_raters must be at least 1';
  end if;

  delete from challenge_invites
  where challenger_id = p_user_id
     or opponent_id = p_user_id
     or match_id in (select id from pvp_matches where player_a = p_user_id or player_b = p_user_id);
  get diagnostics v_invites = row_count;

  delete from pvp_matches
  where player_a = p_user_id or player_b = p_user_id;
  get diagnostics v_matches = row_count;

  -- Items that will lose one of this learner's ratings and survive the
  -- erasure (their own contributed items are deleted below). Locked in id
  -- order before the ratings go, so a concurrent rating insert on the same
  -- item (which takes the same row lock) cannot interleave with the recount.
  select coalesce(array_agg(id order by id), '{}')
  into v_affected
  from (
    select ci.id
    from corpus_items ci
    where ci.contributor_id <> p_user_id
      and exists (select 1 from corpus_ratings cr where cr.corpus_id = ci.id and cr.rater_id = p_user_id)
    order by ci.id
    for update of ci
  ) locked;

  delete from corpus_ratings where rater_id = p_user_id;
  get diagnostics v_ratings = row_count;

  delete from corpus_items where contributor_id = p_user_id;
  get diagnostics v_items = row_count;

  with actual as (
    select ci.id, ci.status, count(cr.id)::int as n
    from corpus_items ci
    left join corpus_ratings cr on cr.corpus_id = ci.id
    where ci.id = any(v_affected)
    group by ci.id, ci.status
  ), updated as (
    update corpus_items ci
    set rating_count = a.n,
        status = case when a.status in ('rated', 'adjudicated') and a.n < p_min_raters then 'open' else ci.status end,
        side_mapping = case
          when a.status = 'adjudicated' and a.n < p_min_raters then
            coalesce(ci.side_mapping, '{}'::jsonb) || jsonb_build_object(
              'adjudication_stale', true,
              'adjudication_stale_at', now()::text,
              'adjudication_stale_actor', 'account-erasure'
            )
          else ci.side_mapping
        end
    from actual a
    where ci.id = a.id
    returning a.status as status_before, ci.status as status_after
  )
  select count(*), count(*) filter (where status_before <> status_after)
  into v_recounted, v_reopened
  from updated;

  delete from rate_limits where key like '%' || p_user_id::text || '%';

  delete from app_users where id = p_user_id;
  get diagnostics v_user = row_count;

  return jsonb_build_object(
    'userDeleted', v_user > 0,
    'matchesDeleted', v_matches,
    'invitesDeleted', v_invites,
    'corpusRatingsDeleted', v_ratings,
    'corpusItemsDeleted', v_items,
    'corpusItemsRecounted', v_recounted,
    'corpusItemsReopened', v_reopened
  );
end;
$$;
