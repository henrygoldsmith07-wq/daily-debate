import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
    ownedDebateIds: new Set<string>(),
  };
  const record = vi.fn(async () => undefined);

  function from(table: string) {
    const filters = new Map<string, unknown>();
    const builder = {
      select() { return builder; },
      eq(column: string, value: unknown) { filters.set(column, value); return builder; },
      async maybeSingle() {
        if (table !== "solo_debates") return { data: null, error: null };
        const debateId = String(filters.get("id") ?? "");
        const userId = filters.get("user_id");
        const owned = state.user && userId === state.user.id && state.ownedDebateIds.has(debateId);
        return { data: owned ? { id: debateId } : null, error: null };
      },
    };
    return builder;
  }

  return { state, record, from };
});

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
    from: h.from,
  }),
}));
vi.mock("@/lib/productEvents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/productEvents")>("@/lib/productEvents");
  return { ...actual, recordProductEventForUser: h.record };
});

import { POST } from "./route";

const OWNED = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";

function post(body: unknown) {
  return POST(
    new Request("https://daily-debate.test/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.state.user = { id: "11111111-1111-4111-8111-111111111111" };
  h.state.ownedDebateIds = new Set([OWNED]);
  h.record.mockClear();
});

describe("POST /api/events", () => {
  it("rejects server-owned product event names from the browser", async () => {
    const res = await post({ name: "challenge_link_accepted" });
    expect(res.status).toBe(400);
    expect(h.record).not.toHaveBeenCalled();
  });

  it("records an allowed event when the debate belongs to the signed-in user", async () => {
    const res = await post({ name: "full_analysis_opened", debateId: OWNED, format: "sprint" });
    expect(res.status).toBe(200);
    expect(h.record).toHaveBeenCalledWith(
      h.state.user!.id,
      "full_analysis_opened",
      { format: "sprint", debateId: OWNED },
    );
  });

  it("rejects a valid UUID that belongs to another user", async () => {
    const res = await post({ name: "repair_started", debateId: FOREIGN });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown debate." });
    expect(h.record).not.toHaveBeenCalled();
  });

  it("keeps guest tracking as a silent no-op", async () => {
    h.state.user = null;
    const res = await post({ name: "daily_viewed" });
    expect(res.status).toBe(200);
    expect(h.record).not.toHaveBeenCalled();
  });
});
