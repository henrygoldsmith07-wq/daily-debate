import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    user: { id: "user-1" } as { id: string } | null,
    rows: [] as Array<Record<string, unknown>>,
    rowsError: null as unknown,
    ledger: { points: [] as unknown[] } as { points: unknown[] } | null,
    wrote: 0,
  };
  const service = {
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: state.rows, error: state.rowsError }),
        update: () => {
          state.wrote += 1;
          return builder;
        },
        insert: () => {
          state.wrote += 1;
          return builder;
        },
      };
      return builder;
    },
  };
  return { state, service };
});

vi.mock("@/lib/backend/server", () => ({ createServiceClient: () => h.service }));
vi.mock("@/lib/currentViewer", () => ({ getCurrentUser: async () => h.state.user }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => null }));
vi.mock("@/lib/coachingContextServer", () => ({
  loadCoachingContext: async () => ({ ledger: h.state.ledger, status: "ok", degradationReasons: [] }),
}));

import { GET } from "./route";

const row = (over: Record<string, unknown>) => ({
  id: "r1",
  dimension: "evidence",
  title: "Drill",
  assigned_date: "2026-10-01",
  created_at: "2026-10-01T10:00:00Z",
  before_score: 40,
  attempt_score: 70,
  ...over,
});

beforeEach(() => {
  h.state.user = { id: "user-1" };
  h.state.rows = [];
  h.state.rowsError = null;
  h.state.ledger = { points: [] };
  h.state.wrote = 0;
});

describe("GET /api/coach/outcomes", () => {
  it("rejects anonymous callers", async () => {
    h.state.user = null;
    expect((await GET(new Request("http://x"))).status).toBe(401);
  });

  it("answers 503 when drills cannot be read, rather than an empty report", async () => {
    h.state.rowsError = { message: "down" };
    expect((await GET(new Request("http://x"))).status).toBe(503);
  });

  it("answers 503 when coaching context has no ledger", async () => {
    h.state.ledger = null;
    expect((await GET(new Request("http://x"))).status).toBe(503);
  });

  it("lists attempted drills as unmeasured until later debates exist, and never writes", async () => {
    h.state.rows = [row({}), row({ id: "r2", dimension: "not-a-dimension" })];
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.outcomes).toHaveLength(1);
    expect(json.outcomes[0]).toMatchObject({ id: "r1", measured: false, movement: null });
    expect(json.summary.measured).toBe(0);
    expect(json.summary.improved).toBe(0);
    expect(json.summary.note).toMatch(/complete a few/i);
    expect(h.state.wrote).toBe(0);
  });
});
