import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    user: { id: "user-1" } as { id: string } | null,
    limit: { ok: true, retryAfterSeconds: 0 } as { ok: boolean; retryAfterSeconds: number },
    rows: [{ export: { account: { id: "user-1" } } }] as Array<{ export?: unknown }>,
    queryError: null as unknown,
    calls: [] as Array<{ sql: string; params: unknown[] }>,
    limitKeys: [] as string[],
  },
}));

vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.state.user } }) } }),
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimitKey: async (key: string) => {
    h.state.limitKeys.push(key);
    return h.state.limit;
  },
}));
vi.mock("@/lib/backend/sql", () => ({
  queryRows: async (sql: string, params: unknown[]) => {
    h.state.calls.push({ sql, params });
    if (h.state.queryError) throw h.state.queryError;
    return h.state.rows;
  },
}));

import { GET } from "./route";

beforeEach(() => {
  h.state.user = { id: "user-1" };
  h.state.limit = { ok: true, retryAfterSeconds: 0 };
  h.state.rows = [{ export: { account: { id: "user-1" } } }];
  h.state.queryError = null;
  h.state.calls = [];
  h.state.limitKeys = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/account/export", () => {
  it("rejects signed-out callers before touching the database", async () => {
    h.state.user = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(h.state.calls).toHaveLength(0);
    expect(h.state.limitKeys).toHaveLength(0);
  });

  it("returns 429 with Retry-After when rate limited, without querying", async () => {
    h.state.limit = { ok: false, retryAfterSeconds: 42 };
    const res = await GET();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(h.state.calls).toHaveLength(0);
  });

  it("exports only the signed-in user's snapshot as a no-store attachment", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account: { id: "user-1" } });
    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0].params).toEqual(["user-1"]);
    expect(h.state.limitKeys).toEqual(["user-1"]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="daily-debate-export-\d{4}-\d{2}-\d{2}\.json"$/);
  });

  it("never selects password hashes or session tokens", () => {
    return GET().then(() => {
      const sql = h.state.calls[0].sql;
      expect(sql).not.toMatch(/password/i);
      expect(sql).not.toMatch(/app_sessions|rate_limits/);
    });
  });

  it("returns 500 when the snapshot comes back empty", async () => {
    h.state.rows = [];
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("returns a retryable 500 without leaking the database error", async () => {
    h.state.queryError = new Error("connection string postgres://secret");
    const res = await GET();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
