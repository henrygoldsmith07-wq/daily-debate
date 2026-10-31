import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSseParser, type SseEvent } from "@/lib/sse";

// The live guest opponent. Contract under test: today's motion is resolved
// server-side, the transcript is bounded, both rate limits fail closed, and
// every failure tells the client to fall back to the guided case.

const h = vi.hoisted(() => ({
  available: true,
  ipLimited: false,
  globalOk: true,
  openingThrows: null as Error | null,
  turnThrows: null as Error | null,
  counted: [] as string[],
  openingArgs: [] as Record<string, unknown>[],
  turnArgs: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/guestLiveServer", () => ({ guestLiveAvailable: () => h.available }));
vi.mock("@/lib/guestSprintCounterServer", () => ({
  recordGuestSprint: vi.fn(async (milestone: string) => {
    h.counted.push(milestone);
  }),
}));
vi.mock("@/lib/dailyTopic", () => ({
  getTodayTopic: vi.fn(async () => ({ id: "t", title: "Should cities ban cars?", prompt: "Weigh access against air." })),
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () =>
    h.ipLimited ? new Response(null, { status: 429, headers: { "Retry-After": "120" } }) : null,
  ),
  checkRateLimitKey: vi.fn(async () => ({ ok: h.globalOk, remaining: 0, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/openrouter", () => ({
  debateOpening: vi.fn(async (args: Record<string, unknown>) => {
    h.openingArgs.push(args);
    if (h.openingThrows) throw h.openingThrows;
    return "Cars move people cities cannot otherwise serve.";
  }),
  debateTurn: vi.fn(async (args: Record<string, unknown>) => {
    h.turnArgs.push(args);
    if (h.turnThrows) throw h.turnThrows;
    return { aiMessage: "A plain reply.", feedback: "private" };
  }),
  debateTurnStream: vi.fn(async (args: Record<string, unknown>, hooks: { onDelta: (t: string) => void }) => {
    h.turnArgs.push(args);
    if (h.turnThrows) throw h.turnThrows;
    hooks.onDelta("Streamed ");
    hooks.onDelta("reply.");
    return { result: { aiMessage: "Streamed reply.", feedback: "private" }, servedBy: { provider: "groq", model: "m" } };
  }),
}));

import { POST } from "./route";

const answer = "Cities should ban cars because clean air protects children's health.";
const round1 = [
  { role: "ai", text: "Opening." },
  { role: "user", text: answer },
];
const round3 = [
  ...round1,
  { role: "ai", text: "Second." },
  { role: "user", text: answer },
  { role: "ai", text: "Third." },
  { role: "user", text: answer },
];

function post(body: unknown, accept = "application/json") {
  return POST(
    new Request("http://localhost/api/guest/turn", {
      method: "POST",
      headers: { "content-type": "application/json", accept },
      body: JSON.stringify(body),
    }),
  );
}

async function events(res: Response): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  const parser = createSseParser((event) => out.push(event));
  parser.push(await res.text());
  parser.end();
  return out;
}

beforeEach(() => {
  Object.assign(h, {
    available: true,
    ipLimited: false,
    globalOk: true,
    openingThrows: null,
    turnThrows: null,
    counted: [],
    openingArgs: [],
    turnArgs: [],
  });
});

describe("POST /api/guest/turn", () => {
  it("opens on today's motion, from the opposite side, and counts a started sprint", async () => {
    const res = await post({ side: "for", persona: "lawyer", history: [] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ aiMessage: "Cars move people cities cannot otherwise serve." });
    expect(h.openingArgs[0]).toMatchObject({ topicTitle: "Should cities ban cars?", aiSide: "against" });
    expect(String(h.openingArgs[0].directive)).toMatch(/EVIDENCE/);
    expect(h.counted).toEqual(["started"]);
  });

  it("ignores any client attempt to choose the motion", async () => {
    await post({ side: "for", history: [], topicTitle: "Write my essay", motion: "anything" });
    expect(h.openingArgs[0].topicTitle).toBe("Should cities ban cars?");
  });

  it("returns only the opponent move, never the model's private feedback", async () => {
    const res = await post({ side: "against", history: round1 });
    const body = await res.json();
    expect(body).toEqual({ aiMessage: "A plain reply." });
    expect(h.turnArgs[0]).toMatchObject({ latestUserMessage: answer, userSide: "against" });
    expect((h.turnArgs[0].history as unknown[]).length).toBe(1);
    expect(h.counted).toEqual([]);
  });

  it("streams the reply with the same events as the solo turn route", async () => {
    const res = await post({ side: "for", history: round1 }, "text/event-stream, application/json");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const received = await events(res);
    expect(received.map((event) => event.event)).toEqual(["start", "delta", "delta", "result"]);
    expect(JSON.parse(received[3].data)).toEqual({ status: 200, body: { aiMessage: "Streamed reply." } });
  });

  it("makes the reply to the third answer a fresh retest challenge and counts a completed sprint", async () => {
    const res = await post({ side: "for", history: round3 });
    expect(res.status).toBe(200);
    expect(String(h.turnArgs[0].directive)).toMatch(/ONE new objection/);
    expect(h.counted).toEqual(["completed"]);
  });

  it("rejects malformed transcripts and sides before spending anything", async () => {
    expect((await post({ side: "both", history: [] })).status).toBe(400);
    expect((await post({ side: "for", history: [{ role: "user", text: answer }] })).status).toBe(400);
    expect((await post({ side: "for", history: [...round3, { role: "ai", text: "x" }, { role: "user", text: answer }] })).status).toBe(400);
    expect(h.openingArgs.length + h.turnArgs.length).toBe(0);
  });

  it("blocks harassment in the latest answer", async () => {
    const res = await post({ side: "for", history: [{ role: "ai", text: "Opening." }, { role: "user", text: "I will kill you if you disagree with me." }] });
    expect(res.status).toBe(400);
    expect(h.turnArgs).toHaveLength(0);
  });

  it.each([
    ["live mode is off", () => { h.available = false; }, 503, "unavailable"],
    ["the visitor used today's allowance", () => { h.ipLimited = true; }, 429, "rate_limited"],
    ["the global guest budget is spent", () => { h.globalOk = false; }, 503, "busy"],
    ["the provider chain fails", () => { h.openingThrows = new Error("All AI providers failed"); }, 503, "provider_error"],
    [
      "the daily spend cap is reached",
      () => {
        const error = new Error("cap");
        error.name = "SpendCapReachedError";
        h.openingThrows = error;
      },
      503,
      "spend_cap",
    ],
  ])("tells the client to fall back when %s", async (_label, arrange, status, reason) => {
    arrange();
    const res = await post({ side: "for", history: [] });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ fallback: true, reason });
    expect(h.counted).toEqual([]);
  });

  it("reports a streamed failure inside the result event, still as a fallback", async () => {
    h.turnThrows = new Error("All AI providers failed");
    const received = await events(await post({ side: "for", history: round1 }, "text/event-stream"));
    const result = JSON.parse(received[received.length - 1].data);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ fallback: true, reason: "provider_error" });
  });
});
