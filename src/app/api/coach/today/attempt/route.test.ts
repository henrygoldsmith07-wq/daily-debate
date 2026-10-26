import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    user: { id: "user-1" } as { id: string } | null,
    assignment: { id: "a1", user_id: "user-1", dimension: "evidence", status: "open" } as Record<string, unknown> | null,
    selectError: null as unknown,
    updateError: null as unknown,
    updated: null as Record<string, unknown> | null,
    updateFilters: new Map<string, unknown>(),
  };
  const service = {
    from() {
      let isUpdate = false;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (c: string, v: unknown) => {
          if (isUpdate) state.updateFilters.set(c, v);
          return builder;
        },
        update: (v: Record<string, unknown>) => {
          isUpdate = true;
          state.updated = v;
          return builder;
        },
        maybeSingle: async () => ({ data: state.assignment, error: state.selectError }),
        single: async () => ({ data: state.updateError ? null : { id: "a1" }, error: state.updateError }),
      };
      return builder;
    },
  };
  return { state, service };
});

vi.mock("@/lib/backend/server", () => ({ createServiceClient: () => h.service }));
vi.mock("@/lib/currentViewer", () => ({ getCurrentUser: async () => h.state.user }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => null }));

import { POST } from "./route";

const GOOD = "According to the OECD, the policy cut costs; however, weighing the trade-off, the benefit outweighs the harm.";
function req(body: unknown) {
  return new Request("http://x/api/coach/today/attempt", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  h.state.user = { id: "user-1" };
  h.state.assignment = { id: "a1", user_id: "user-1", dimension: "evidence", status: "open" };
  h.state.selectError = null;
  h.state.updateError = null;
  h.state.updated = null;
  h.state.updateFilters = new Map();
});

describe("POST /api/coach/today/attempt", () => {
  it("rejects anonymous callers", async () => {
    h.state.user = null;
    expect((await POST(req({ assignmentId: "a1", text: GOOD }))).status).toBe(401);
  });

  it("validates assignmentId and text length", async () => {
    expect((await POST(req({ text: GOOD }))).status).toBe(400);
    expect((await POST(req({ assignmentId: "a1", text: "   short  " }))).status).toBe(400);
    expect((await POST(req({ assignmentId: "a1", text: "x".repeat(6001) }))).status).toBe(400);
    expect(h.state.updated).toBeNull();
  });

  it("does not reveal or modify another learner's assignment", async () => {
    h.state.assignment = { id: "a1", user_id: "someone-else", dimension: "evidence", status: "open" };
    expect((await POST(req({ assignmentId: "a1", text: GOOD }))).status).toBe(404);
    expect(h.state.updated).toBeNull();
  });

  it("answers 503 (not 404) when the assignment lookup itself fails", async () => {
    h.state.assignment = null;
    h.state.selectError = { message: "db down" };
    expect((await POST(req({ assignmentId: "a1", text: GOOD }))).status).toBe(503);
  });

  it("refuses an unsupported dimension without writing", async () => {
    h.state.assignment = { id: "a1", user_id: "user-1", dimension: "charisma", status: "open" };
    expect((await POST(req({ assignmentId: "a1", text: GOOD }))).status).toBe(409);
    expect(h.state.updated).toBeNull();
  });

  it("stores the attempt scoped to the owner and returns signals but never the score", async () => {
    const res = await POST(req({ assignmentId: "a1", text: GOOD }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.signals)).toBe(true);
    expect(json).not.toHaveProperty("score");
    expect(h.state.updated).toMatchObject({ status: "attempted", attempt_text: GOOD });
    expect(typeof h.state.updated?.attempt_score).toBe("number");
    expect(h.state.updateFilters.get("user_id")).toBe("user-1");
  });

  it("reports a failed write as 500", async () => {
    h.state.updateError = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(req({ assignmentId: "a1", text: GOOD }))).status).toBe(500);
  });
});
