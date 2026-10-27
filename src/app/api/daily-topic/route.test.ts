import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  s: {
    user: { id: "u1" } as { id: string } | null,
    limited: null as Response | null,
    topic: { id: "t1", title: "Motion" } as unknown,
    fail: false,
    topicCalls: 0,
  },
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => h.s.limited }));
vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.s.user } }) } }),
}));
vi.mock("@/lib/dailyTopic", () => ({
  getTodayTopic: async () => {
    h.s.topicCalls++;
    if (h.s.fail) throw new Error("model down");
    return h.s.topic;
  },
}));

import { GET } from "./route";

const req = () => new Request("http://localhost/api/daily-topic");

beforeEach(() => {
  h.s.user = { id: "u1" };
  h.s.limited = null;
  h.s.topic = { id: "t1", title: "Motion" };
  h.s.fail = false;
  h.s.topicCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/daily-topic", () => {
  it("returns the topic for a signed-in user", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).topic.title).toBe("Motion");
  });

  it("rate limits before any paid topic generation", async () => {
    h.s.limited = new Response("slow", { status: 429 });
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(h.s.topicCalls).toBe(0);
  });

  it("rejects signed-out callers without generating a topic", async () => {
    h.s.user = null;
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(h.s.topicCalls).toBe(0);
  });

  it("returns a clean 500 when topic loading fails", async () => {
    h.s.fail = true;
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/today's topic/);
  });
});
