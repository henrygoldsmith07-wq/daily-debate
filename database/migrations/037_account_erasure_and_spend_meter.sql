-- 037: durable AI spend metering + transactional account erasure (UK GDPR).
--
-- 1) ai_call_log.cost_usd: provider-reported cost (OpenRouter transports send
--    usage.cost; Anthropic does not report cost, so those rows stay NULL and
--    the spend guard charges a declared per-call assumption instead of
--    pretending the call was free). Additive column — the best-effort
--    telemetry mirror keeps working on older rows.
--
-- 2) delete_app_account(p_user_id): single-transaction account erasure.
--    Ordering matters: several tables reference profiles(id) WITHOUT
--    on delete cascade (pvp_matches, pvp_turns, corpus_items,
--    corpus_ratings, challenge_invites.opponent_id), so they are removed
--    explicitly BEFORE the app_users row — whose cascade then removes
--    profiles and everything referencing it (sessions, password resets,
--    solo debates + turns, product events, drills, repairs, queue, reports,
--    appeals, exposure, claims). Only the requesting user's rows are touched;
--    other players' rows survive except where they are half of a two-party
--    record (a shared match, an invite naming this user, ratings on this
--    user's contributed corpus items) — those cannot outlive the foreign key
--    without corrupting it. Operational tables with no user id (ai_call_log,
--    judge/route/telemetry logs) are intentionally untouched: they contain
--    no personal data.

alter table ai_call_log
  add column if not exists cost_usd double precision;

comment on column ai_call_log.cost_usd is
  'Provider-reported USD cost for this call (usage.cost). NULL when the provider does not report cost (e.g. Anthropic); spend dashboards charge a declared per-call assumption for NULL rows rather than treating them as free.';

create or replace function delete_app_account(p_user_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_user bigint := 0;
  v_matches bigint := 0;
  v_invites bigint := 0;
  v_ratings bigint := 0;
  v_items bigint := 0;
begin
  -- Invites first: challenge_invites.match_id references pvp_matches without
  -- cascade, so the invites that name this user's matches must go before the
  -- matches do. Invites created by the user cascade from profiles anyway;
  -- invites where the user is only the opponent belong to someone else and
  -- are removed because the FK cannot be nulled without lying about state.
  delete from challenge_invites
  where challenger_id = p_user_id
     or opponent_id = p_user_id
     or match_id in (select id from pvp_matches where player_a = p_user_id or player_b = p_user_id);
  get diagnostics v_invites = row_count;

  -- Shared two-party records: the match cannot survive one player's erasure.
  -- Cascades pvp_turns (all rounds of that match) and match_appeals;
  -- reports.match_id is on delete set null.
  delete from pvp_matches
  where player_a = p_user_id or player_b = p_user_id;
  get diagnostics v_matches = row_count;

  -- Research corpus: the user's own ratings and their contributed items.
  -- Deleting an item cascades any ratings ON that item (other raters lose
  -- those rows with the item) — unavoidable without an FK violation, and
  -- disclosed on the privacy page.
  delete from corpus_ratings where rater_id = p_user_id;
  get diagnostics v_ratings = row_count;

  delete from corpus_items where contributor_id = p_user_id;
  get diagnostics v_items = row_count;

  -- Rate-limit buckets are keyed by user id text; scrub any that mention it.
  delete from rate_limits where key like '%' || p_user_id::text || '%';

  -- Auth row: cascades app_sessions, password_reset_tokens, profiles, and
  -- every profile-referencing table not handled above.
  delete from app_users where id = p_user_id;
  get diagnostics v_user = row_count;

  return jsonb_build_object(
    'userDeleted', v_user > 0,
    'matchesDeleted', v_matches,
    'invitesDeleted', v_invites,
    'corpusRatingsDeleted', v_ratings,
    'corpusItemsDeleted', v_items
  );
end;
$$;
