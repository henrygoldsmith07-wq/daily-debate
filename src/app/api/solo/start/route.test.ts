import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    user: { id: "user-1" } as { id: string } | null,
    ipLimited: null as Response | null,
    userLimit: { ok: true, retryAfterSeconds: 0 } as { ok: boolean; retryAfterSeconds: number },
    result: { ok: true, data: { debateId: "d1" } } as Record<string, unknown>,
    startCalls: [] as Array<Record<string, unknown>>,
    ipOpts: null as Record<string, unknown> | null,
    userOpts: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.state.user } }) } }),
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async (_r: Request, opts: Record<string, unknown>) => {
    h.state.ipOpts = opts;
    return h.state.ipLimited;
  },
  checkRateLimitKey: async (_k: string, opts: Record<string, unknown>) => {
    h.state.userOpts = opts;
    return h.state.userLimit;
  },
}));
vi.mock("@/lib/solo/startDebate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/solo/startDebate")>("@/lib/solo/startDebate");
  return {
    ...actual,
    startSoloDebate: async (args: Record<string, unknown>) => {
      h.state.startCalls.push(args);
      return h.state.result;
    },
  };
});

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://x/api/solo/start", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  h.state.user = { id: "user-1" };
  h.state.ipLimited = null;
  h.state.userLimit = { ok: true, retryAfterSeconds: 0 };
  h.state.result = { ok: true, data: { debateId: "d1" } };
  h.state.startCalls = [];
  h.state.ipOpts = null;
  h.state.userOpts = null;
});

describe("POST /api/solo/start", () => {
  it("returns the IP limiter response before auth or start", async () => {
    h.state.ipLimited = new Response("slow", { status: 429 });
    const res = await POST(req({ topicId: "t", side: "for" }));
    expect(res.status).toBe(429);
    expect(h.state.startCalls).toHaveLength(0);
  });

  it("fails closed on both paid-call limiters", async () => {
    await POST(req({ topicId: "t", side: "for" }));
    expect(h.state.ipOpts?.failClosed).toBe(true);
    expect(h.state.userOpts?.failClosed).toBe(true);
  });

  it("rejects signed-out callers", async () => {
    h.state.user = null;
    const res = await POST(req({ topicId: "t", side: "for" }));
    expect(res.status).toBe(401);
    expect(h.state.startCalls).toHaveLength(0);
  });

  it("returns 429 with Retry-After when the user bucket is full", async () => {
    h.state.userLimit = { ok: false, retryAfterSeconds: 17 };
    const res = await POST(req({ topicId: "t", side: "for" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(h.state.startCalls).toHaveLength(0);
  });

  it("requires a string topicId, including on malformed JSON", async () => {
    expect((await POST(req({ side: "for" }))).status).toBe(400);
    expect((await POST(req({ topicId: 5, side: "for" }))).status).toBe(400);
    expect((await POST(req("{not json"))).status).toBe(400);
    expect(h.state.startCalls).toHaveLength(0);
  });

  it("rejects an unknown side", async () => {
    const res = await POST(req({ topicId: "t", side: "both" }));
    expect(res.status).toBe(400);
    expect(h.state.startCalls).toHaveLength(0);
  });

  it.each(["for", "against", "challenge"])("accepts side %s and passes the user id", async (side) => {
    const res = await POST(req({ topicId: "t1", side }));
    expect(res.status).toBe(200);
    expect(h.state.startCalls[0]).toMatchObject({ userId: "user-1", topicId: "t1", sideChoice: side });
  });

  it("echoes resolved persona/difficulty and falls back for unknown values", async () => {
    const res = await POST(req({ topicId: "t", side: "for", persona: "nonsense", difficulty: "nonsense" }));
    const json = await res.json();
    expect(json.debateId).toBe("d1");
    expect(typeof json.persona).toBe("string");
    expect(typeof json.difficulty).toBe("string");
    expect(h.state.startCalls[0].persona).toBe(json.persona);
  });

  it("maps service failures to status, code and Retry-After", async () => {
    h.state.result = { ok: false, error: "busy", status: 429, code: "start_busy", retryAfterSeconds: 4 };
    const res = await POST(req({ topicId: "t", side: "for" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("4");
    expect(await res.json()).toEqual({ error: "busy", code: "start_busy", retryAfterSeconds: 4 });
  });

  it("omits code and retry fields when the service gives none", async () => {
    h.state.result = { ok: false, error: "nope", status: 404 };
    const res = await POST(req({ topicId: "t", side: "for" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(await res.json()).toEqual({ error: "nope" });
  });
});
