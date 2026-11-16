import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSseParser, type SseEvent } from "@/lib/sse";

// Streaming variant of the solo turn route. The persistence contract under
// test is the same as route.test.ts: claim -> generate -> finalize, release on
// failure, and a retryable "response saved" answer whenever the reply could
// not be persisted. Streaming may only add what the learner sees.

const h = vi.hoisted(() => {
  const state = {
    streamMode: "ok" as "ok" | "mid-stream-fail" | "reset-then-ok",
    finalizeThrows: false,
    roundNumber: 1,
    persisted: [] as Record<string, unknown>[],
  };
  const staged = {
    userMessage: "My answer to the opening argument about this motion.",
    inputMode: "text",
    scores: {},
    turnScore: 5,
    assessment: null,
    trainingMeta: { modeId: "text", elapsedSeconds: 0, modeWarnings: [], speechTiming: null, speechAnalysis: null, speechQuality: null },
    modeId: "text",
    submittedAt: null,
  };
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "claim_solo_turn_submission") return { data: { claimed: true, staged }, error: null };
    if (name === "finalize_solo_turn_submission") {
      if (state.finalizeThrows) throw new Error("network down");
      state.persisted.push(args ?? {});
      return {
        data: {
          saved: true,
          completedTurn: { id: "t1", user_message: staged.userMessage },
          nextTurn: args?.p_next_ai_message ? { id: "t2", ai_message: args.p_next_ai_message } : null,
        },
        error: null,
      };
    }
    return { data: true, error: null };
  });
  function from(table: string) {
    const turns = [{ id: "t1", round_number: state.roundNumber, user_message: null, ai_message: "Opening", turn_score: null, assessment: null }];
    const b = {
      select() { return b; },
      eq() { return b; },
      order() { return Promise.resolve({ data: turns, error: null }); },
      async single() {
        if (table === "solo_debates") {
          return { data: { id: "d1", status: "active", format: "sprint", topic_id: "tp", side: "for", round_count: state.roundNumber, coaching: null }, error: null };
        }
        return { data: { id: "tp", title: "T", prompt: "P" }, error: null };
      },
    };
    return b;
  }
  const recordStreamLatency = vi.fn();
  return { state, rpc, from, recordStreamLatency };
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
vi.mock("@/lib/aiTelemetry", () => ({ recordStreamLatency: h.recordStreamLatency }));
vi.mock("@/lib/openrouter", () => ({
  debateTurn: vi.fn(async () => ({ feedback: "f", aiMessage: "plain reply" })),
  debateTurnStream: vi.fn(async (_p: unknown, hooks: { onDelta: (t: string) => void; onReset: () => void }) => {
    if (h.state.streamMode === "reset-then-ok") {
      hooks.onDelta("doomed ");
      hooks.onReset();
    }
    hooks.onDelta("Streamed ");
    hooks.onDelta("reply.");
    if (h.state.streamMode === "mid-stream-fail") throw new Error("All AI providers failed");
    return { result: { feedback: "f", aiMessage: "Streamed reply." }, servedBy: { provider: "groq", model: "g/1" } };
  }),
}));
vi.mock("@/lib/argumentRouting", () => ({
  classifyArgumentBatchDetailed: vi.fn(async () => { throw new Error("skip"); }),
  recordRoutingTelemetry: vi.fn(),
  routeClassifiedArguments: vi.fn(),
  routingSummary: vi.fn(),
}));

import { POST } from "./route";

async function submit(accept = "text/event-stream, application/json") {
  return POST(
    new Request("http://localhost/api/solo/d1/turn", {
      method: "POST",
      headers: { accept },
      body: JSON.stringify({ message: "My answer to the opening argument about this motion.", expectedTurnId: "t1" }),
    }),
    { params: Promise.resolve({ debateId: "d1" }) },
  );
}

async function events(res: Response): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  const parser = createSseParser((e) => out.push(e));
  parser.push(await res.text());
  parser.end();
  return out;
}

describe("POST /api/solo/[debateId]/turn (streaming)", () => {
  beforeEach(() => {
    h.rpc.mockClear();
    h.recordStreamLatency.mockClear();
    h.state.streamMode = "ok";
    h.state.finalizeThrows = false;
    h.state.roundNumber = 1;
    h.state.persisted = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("streams deltas, then persists and returns the same result the JSON route would", async () => {
    const res = await submit();
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const evs = await events(res);
    expect(evs.map((e) => e.event)).toEqual(["start", "delta", "delta", "result"]);
    expect(evs.filter((e) => e.event === "delta").map((e) => JSON.parse(e.data).text).join("")).toBe("Streamed reply.");
    const result = JSON.parse(evs[3].data);
    expect(result.status).toBe(200);
    expect(result.body.nextTurn.ai_message).toBe("Streamed reply.");
    // Persisted exactly the validated reply, through the same finalize RPC.
    expect(h.state.persisted).toHaveLength(1);
    expect(h.state.persisted[0].p_next_ai_message).toBe("Streamed reply.");
    expect(h.recordStreamLatency).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "ok", provider: "groq", model: "g/1", firstTokenMs: expect.any(Number) }),
    );
  });

  it("falls back to the saved-response 502 in the result event when the stream fails mid-way", async () => {
    h.state.streamMode = "mid-stream-fail";
    const evs = await events(await submit());
    const result = JSON.parse(evs[evs.length - 1].data);
    expect(evs[evs.length - 1].event).toBe("result");
    expect(result.status).toBe(502);
    expect(result.body.submissionSaved).toBe(true);
    expect(result.body.stagedMessage).toBe("My answer to the opening argument about this motion.");
    expect(h.state.persisted).toHaveLength(0);
    expect(h.rpc.mock.calls.map((c) => c[0])).toContain("release_solo_turn_submission");
    expect(h.recordStreamLatency).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error" }));
  });

  it("forwards a reset so the client discards text from a failed provider", async () => {
    h.state.streamMode = "reset-then-ok";
    const evs = await events(await submit());
    expect(evs.map((e) => e.event)).toEqual(["start", "delta", "reset", "delta", "delta", "result"]);
    expect(JSON.parse(evs[5].data).status).toBe(200);
  });

  it("reports a finalize failure as the retryable saved-response result", async () => {
    h.state.finalizeThrows = true;
    const evs = await events(await submit());
    const result = JSON.parse(evs[evs.length - 1].data);
    expect(result.status).toBe(500);
    expect(result.body.submissionSaved).toBe(true);
  });

  it("answers plain JSON when no generation is needed (final round)", async () => {
    h.state.roundNumber = 3; // sprint cap
    const res = await submit();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.status).toBe(200);
    expect((await res.json()).debateComplete).toBe(true);
  });

  it("answers plain JSON errors before anything is staged", async () => {
    const res = await POST(
      new Request("http://localhost/api/solo/d1/turn", {
        method: "POST",
        headers: { accept: "text/event-stream" },
        body: JSON.stringify({ message: "", expectedTurnId: "t1" }),
      }),
      { params: Promise.resolve({ debateId: "d1" }) },
    );
    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("keeps the non-streaming JSON path unchanged for clients that do not ask to stream", async () => {
    const res = await submit("application/json");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.nextTurn.ai_message).toBe("plain reply");
    expect(h.recordStreamLatency).not.toHaveBeenCalled();
  });
});
