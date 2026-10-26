import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { finalizeThrows: false, releaseThrows: false, debateTurnThrows: false };
  const staged = {
    userMessage: "My answer",
    inputMode: "text",
    scores: {},
    turnScore: 5,
    assessment: null,
    trainingMeta: { modeId: "text", elapsedSeconds: 0, modeWarnings: [], speechTiming: null, speechAnalysis: null, speechQuality: null },
    modeId: "text",
    submittedAt: null,
  };
  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    void _args;
    if (name === "claim_solo_turn_submission") return { data: { claimed: true, staged }, error: null };
    if (name === "finalize_solo_turn_submission") {
      if (state.finalizeThrows) throw new Error("network down");
      return { data: { saved: true, completedTurn: { id: "t1" } }, error: null };
    }
    if (name === "release_solo_turn_submission") {
      if (state.releaseThrows) throw new Error("release network down");
      return { data: true, error: null };
    }
    return { data: null, error: null };
  });
  const turns = [{ id: "t1", round_number: 1, user_message: null, ai_message: "Opening", turn_score: null, assessment: null }];
  function from(table: string) {
    const b = {
      select() { return b; },
      eq() { return b; },
      order() { return Promise.resolve({ data: turns, error: null }); },
      async single() {
        if (table === "solo_debates") {
          return { data: { id: "d1", status: "active", format: "full", topic_id: "tp", side: "for", round_count: 1, coaching: null }, error: null };
        }
        return { data: { id: "tp", title: "T", prompt: "P" }, error: null };
      },
    };
    return b;
  }
  return { state, rpc, from };
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
vi.mock("@/lib/openrouter", () => ({
  debateTurn: vi.fn(async () => {
    if (h.state.debateTurnThrows) throw new Error("provider down");
    return { feedback: "f", aiMessage: "next" };
  }),
}));
vi.mock("@/lib/argumentRouting", () => ({
  classifyArgumentBatchDetailed: vi.fn(async () => { throw new Error("skip"); }),
  recordRoutingTelemetry: vi.fn(),
  routeClassifiedArguments: vi.fn(),
  routingSummary: vi.fn(),
}));

import { POST } from "./route";

async function submit() {
  return POST(
    new Request("http://localhost/api/solo/d1/turn", {
      method: "POST",
      body: JSON.stringify({ message: "My answer to the opening argument about this motion.", expectedTurnId: "t1" }),
    }),
    { params: Promise.resolve({ debateId: "d1" }) },
  );
}

describe("POST /api/solo/[debateId]/turn claim handling", () => {
  beforeEach(() => {
    h.rpc.mockClear();
    h.state.finalizeThrows = false;
    h.state.releaseThrows = false;
    h.state.debateTurnThrows = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("releases the claim and answers a retryable error when finalize throws", async () => {
    h.state.finalizeThrows = true;
    const res = await submit();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Retry/);
    expect(h.rpc.mock.calls.map((c) => c[0])).toContain("release_solo_turn_submission");
  });

  it("still answers the saved-response 502 when the opponent fails and the release itself throws", async () => {
    h.state.debateTurnThrows = true;
    h.state.releaseThrows = true;
    const res = await submit();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/saved/);
  });
});
