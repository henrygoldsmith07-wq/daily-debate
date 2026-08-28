import "server-only";

import { AuthApi, type CookieStore } from "./auth";
import { tableQuery, type TableName } from "./query";
import { queryRows } from "./sql";

type RpcArgs = Record<string, string | number>;

export class BackendClient {
  readonly auth: AuthApi;

  constructor(cookieStore: CookieStore | null = null) {
    this.auth = new AuthApi(cookieStore);
  }

  from<T extends TableName>(table: T) {
    return tableQuery(table);
  }

  async rpc(name: "increment_rate_limit" | "increment_total_points", args: RpcArgs) {
    try {
      if (name === "increment_rate_limit") {
        const data = await queryRows<{ new_count: number; new_reset_at: string }>(
          "SELECT * FROM increment_rate_limit($1, $2)",
          [args.p_key, args.p_window_ms],
        );
        return { data, error: null };
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
