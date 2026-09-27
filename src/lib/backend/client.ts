import "server-only";

import { AuthApi, type CookieStore, type ResetTokenSender } from "./auth";
import { tableQuery, type TableName } from "./query";
import { queryRows } from "./sql";

type RpcArgs = Record<string, string | number | boolean | null>;

export class BackendClient {
  readonly auth: AuthApi;

  constructor(cookieStore: CookieStore | null = null, resetTokenSender?: ResetTokenSender) {
    this.auth = new AuthApi(cookieStore, resetTokenSender);
  }

  from<T extends TableName>(table: T) {
    return tableQuery(table);
  }

  async rpc(
    name:
      | "increment_rate_limit"
      | "increment_total_points"
      | "claim_solo_debate_finalization"
      | "release_solo_debate_finalization"
      | "finalize_solo_debate"
      | "claim_pvp_opponent_and_create_match"
      | "enqueue_pvp_if_unmatched"
      | "join_pvp_queue_and_match"
      | "create_friend_challenge"
      | "create_friend_challenge_v2"
      | "accept_friend_challenge",
    args: RpcArgs,
  ) {
    try {
      if (name === "increment_rate_limit") {
        const data = await queryRows<{ new_count: number; new_reset_at: string }>(
          "SELECT * FROM increment_rate_limit($1, $2)",
          [args.p_key, args.p_window_ms],
        );
        return { data, error: null };
      }
      if (name === "claim_solo_debate_finalization") {
        const rows = await queryRows<{ claimed: boolean }>(
          "SELECT claim_solo_debate_finalization($1, $2, $3, $4) AS claimed",
          [args.p_debate_id, args.p_user_id, args.p_token, args.p_stale_after_seconds],
        );
        return { data: rows[0]?.claimed === true, error: null };
      }
      if (name === "release_solo_debate_finalization") {
        const rows = await queryRows<{ released: boolean }>(
          "SELECT release_solo_debate_finalization($1, $2, $3) AS released",
          [args.p_debate_id, args.p_user_id, args.p_token],
        );
        return { data: rows[0]?.released === true, error: null };
      }
      if (name === "finalize_solo_debate") {
        const rows = await queryRows<{ finalized: boolean }>(
          `SELECT finalize_solo_debate(
            $1, $2, $3, $4, $5, $6, $7::date, $8::timestamptz, $9::jsonb, $10::jsonb,
            $11::boolean, $12::uuid, $13::boolean, $14::boolean
          ) AS finalized`,
          [
            args.p_debate_id,
            args.p_user_id,
            args.p_token,
            args.p_total_score,
            args.p_bonus_xp,
            args.p_points_per_level,
            args.p_activity_date,
            args.p_completed_at,
            args.p_coaching,
            args.p_result_payload,
            args.p_has_retest,
            args.p_repair_result_id,
            args.p_retest_observable,
            args.p_retest_demonstrated,
          ],
        );
        return { data: rows[0]?.finalized === true, error: null };
      }
      if (name === "claim_pvp_opponent_and_create_match") {
        const rows = await queryRows<Record<string, unknown>>(
          "SELECT * FROM claim_pvp_opponent_and_create_match($1, $2, $3)",
          [args.p_joiner, args.p_topic_id, args.p_round_limit],
        );
        return { data: rows, error: null };
      }
      if (name === "join_pvp_queue_and_match") {
        const rows = await queryRows<Record<string, unknown>>(
          "SELECT * FROM join_pvp_queue_and_match($1, $2, $3)",
          [args.p_joiner, args.p_topic_id, args.p_round_limit],
        );
        return { data: rows, error: null };
      }
      if (name === "enqueue_pvp_if_unmatched") {
        // The function always returns exactly one boolean row (migration 008):
        // true when the caller is queued afterwards, false otherwise.
        const rows = await queryRows<{ queued: boolean }>(
          "SELECT enqueue_pvp_if_unmatched($1, $2) AS queued",
          [args.p_user, args.p_topic_id],
        );
        return { data: rows[0]?.queued === true, error: null };
      }
      if (name === "create_friend_challenge") {
        const rows = await queryRows<Record<string, unknown>>(
          "SELECT * FROM create_friend_challenge($1, $2, $3, $4)",
          [args.p_challenger, args.p_topic_id, args.p_challenger_side, args.p_expiry_days],
        );
        return { data: rows, error: null };
      }
      if (name === "create_friend_challenge_v2") {
        const rows = await queryRows<Record<string, unknown>>(
          "SELECT * FROM create_friend_challenge_v2($1, $2, $3, $4)",
          [args.p_challenger, args.p_topic_id, args.p_challenger_side, args.p_expiry_days],
        );
        return { data: rows, error: null };
      }
      if (name === "accept_friend_challenge") {
        const rows = await queryRows<Record<string, unknown>>(
          "SELECT * FROM accept_friend_challenge($1, $2, $3)",
          [args.p_code, args.p_opponent, args.p_round_limit],
        );
        return { data: rows, error: null };
      }
      const rows = await queryRows<{ value: number }>(
        "SELECT increment_total_points($1, $2, $3) AS value",
        [args.p_user_id, args.p_points, args.p_points_per_level],
      );
      return { data: rows[0]?.value ?? null, error: null };
    } catch (error) {
      const candidate = error as { message?: string; code?: string };
      return {
        data: null,
        error: { message: candidate?.message ?? String(error), code: candidate?.code },
      };
    }
  }
}
