import "server-only";

import { AuthApi, type CookieStore, type ResetTokenSender } from "./auth";
import { tableQuery, type TableName } from "./query";
import { queryRows } from "./sql";

type RpcArgs = Record<string, string | number>;

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
      | "claim_pvp_match"
      | "enqueue_pvp_if_unmatched",
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
      if (name === "claim_pvp_match") {
        const rows = await queryRows<Record<string, unknown>>(
          "SELECT * FROM claim_pvp_opponent_and_create_match($1, $2, $3)",
          [args.p_joiner, args.p_topic_id, args.p_round_limit],
        );
        return { data: rows, error: null };
      }
      if (name === "enqueue_pvp_if_unmatched") {
        const rows = await queryRows<{ queued: boolean }>(
          "SELECT enqueue_pvp_if_unmatched($1, $2) AS queued",
          [args.p_user, args.p_topic_id],
        );
        return { data: rows.length > 0, error: null };
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
