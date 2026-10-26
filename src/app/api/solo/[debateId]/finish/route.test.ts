import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    void _args;
    if (name === "claim_solo_debate_finalization") return { data: true, error: null };
    return { data: true, error: null };
  });
  const turns = Array.from({ length: 12 }, (_, i) => ({
    round_number: i + 1,
    user_message: `u${i}`,
    ai_message: `a${i}`,
    turn_score: 5,
    assessment: null,
  }));
  function from(table: string) {
    const builder = {
      select() { return builder; },
      eq() { return builder; },
      order() { return Promise.resolve({ data: turns, error: null }); },
      async single() {
        if (table === "solo_debates") {
          return { data: { id: "d1", status: "active", format: "full", topic_id: "t1", coaching: null }, error: null };
        }
        return { data: null, error: null };
      },
    };
    return builder;
  }
  return { rpc, from };
});

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => null),
  checkRateLimitKey: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/backend/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: h.from,
    rpc: h.rpc,
  })),
}));
vi.mock("@/lib/solo/finalizationContext", () => ({
  loadSoloFinalizationContext: vi.fn(async () => {
    throw new Error("boom: context loader threw");
  }),
}));

import { POST } from "./route";

describe("POST /api/solo/[debateId]/finish", () => {
  beforeEach(() => {
    h.rpc.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("releases its finalization claim when something throws after claiming, and answers a retryable 500", async () => {
    const res = await POST(
      new Request("http://localhost/api/solo/d1/finish", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ debateId: "d1" }) },
    );
    expect(res.status).toBe(500);
    const names = h.rpc.mock.calls.map((c) => c[0]);
    expect(names).toContain("claim_solo_debate_finalization");
    expect(names).toContain("release_solo_debate_finalization");
    const release = h.rpc.mock.calls.find((c) => c[0] === "release_solo_debate_finalization")!;
    const claim = h.rpc.mock.calls.find((c) => c[0] === "claim_solo_debate_finalization")!;
    expect(release[1]?.p_token).toBe(claim[1]?.p_token);
  });
});
