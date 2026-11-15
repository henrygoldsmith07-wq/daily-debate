-- Record a repair attempt once, even when the same rewrite arrives twice at
-- the same moment.
--
-- POST /api/solo/[id]/repair checked for an identical stored rewrite, then
-- inserted, in separate statements. Two submissions in flight together (a
-- double click before the button disables, a retried request, two tabs) both
-- saw no duplicate and both inserted, so repair_attempted, repair_demonstrated
-- and repair_episode_closed - the last meant to fire exactly once per episode
-- - were emitted twice, inflating "repairs demonstrated" on the scorecard.
-- The same check-then-act gap let two different successful rewrites both
-- read "no prior success" and both close the episode.
--
-- record_repair_attempt() takes a transaction-scoped advisory lock on
-- (user, debate, target kind) first, so concurrent attempts on the same
-- repair run one after the other. Each statement after the lock reads a
-- fresh snapshot, so the second attempt sees the first one's row:
--   * same rewrite already stored  -> 'duplicate' with the stored verdict,
--                                     nothing written;
--   * otherwise                    -> 'recorded', with priorSuccess telling
--                                     the route whether an earlier attempt
--                                     had already closed the episode.
--
-- Additive only: one new function. The table and its rows are unchanged.

create or replace function record_repair_attempt(
  p_user uuid,
  p_debate uuid,
  p_kind text,
  p_source_node_id text,
  p_source_text text,
  p_rewrite text,
  p_score integer,
  p_succeeded boolean,
  p_signals jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_dup record;
  v_prior_success boolean;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('repair:' || p_user::text || ':' || p_debate::text || ':' || p_kind, 0));

  select id, score, succeeded, signals into v_dup
  from repair_results
  where user_id = p_user and debate_id = p_debate and target_kind = p_kind and rewrite_text = p_rewrite
  order by created_at asc
  limit 1;
  if found then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'id', v_dup.id,
      'score', v_dup.score,
      'succeeded', v_dup.succeeded,
      'signals', v_dup.signals
    );
  end if;

  select exists (
    select 1 from repair_results
    where user_id = p_user and debate_id = p_debate and target_kind = p_kind and succeeded
  ) into v_prior_success;

  insert into repair_results (user_id, debate_id, target_kind, source_node_id, source_text, rewrite_text, score, succeeded, signals)
  values (p_user, p_debate, p_kind, p_source_node_id, p_source_text, p_rewrite, p_score, p_succeeded, coalesce(p_signals, '[]'::jsonb))
  returning id into v_id;

  return jsonb_build_object('outcome', 'recorded', 'id', v_id, 'priorSuccess', v_prior_success);
end;
$$;
