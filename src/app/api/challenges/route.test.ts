import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  s: {
    user: { id: "u1" } as { id: string } | null,
    limited: null as Response | null,
    topicError: null as unknown,
    rpc: { data: [{ result: "created", id: "i1", code: "ABC", expires_at: "2026-11-01" }], error: null } as {
      data: unknown;
      error: unknown;
    },
    rpcCalls: [] as unknown[],
    events: [] as unknown[],
  },
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => h.s.limited }));
vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.s.user } }) } }),
  createServiceClient: () => ({
    rpc: async (_n: string, args: unknown) => {
      h.s.rpcCalls.push(args);
      return h.s.rpc;
    },
  }),
}));
vi.mock("@/lib/dailyTopic", () => ({
  getOrCreateTodayTopic: async () => {
    if (h.s.topicError) throw h.s.topicError;
    return { id: "t1", title: "Motion" };
  },
}));
vi.mock("@/lib/productEvents", () => ({
  recordProductEventForUser: async (...a: unknown[]) => void h.s.events.push(a),
}));

import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://localhost/api/challenges", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  h.s.user = { id: "u1" };
  h.s.limited = null;
  h.s.topicError = null;
  h.s.rpc = { data: [{ result: "created", id: "i1", code: "ABC", expires_at: "2026-11-01" }], error: null };
  h.s.rpcCalls = [];
  h.s.events = [];
});

describe("POST /api/challenges", () => {
  it("rejects signed-out callers before touching the database", async () => {
    h.s.user = null;
    expect((await POST(req({ side: "for" }))).status).toBe(401);
    expect(h.s.rpcCalls).toHaveLength(0);
  });

  it("rejects an invalid side", async () => {
    expect((await POST(req({ side: "maybe" }))).status).toBe(400);
    expect(h.s.rpcCalls).toHaveLength(0);
  });

  it("creates an invite with the opposite side for the friend and records the event once", async () => {
    const res = await POST(req({ side: "for" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ challengerSide: "for", opponentSide: "against", url: "/challenge/ABC", reused: false });
    expect(h.s.events).toHaveLength(1);
  });

  it("reuses an existing invite without double-counting the event", async () => {
    h.s.rpc = { data: [{ result: "reused", id: "i1", code: "ABC", expires_at: "x" }], error: null };
    const body = await (await POST(req({ side: "against" }))).json();
    expect(body.reused).toBe(true);
    expect(h.s.events).toHaveLength(0);
  });

  it("returns a clean 500 when the rpc fails", async () => {
    h.s.rpc = { data: null, error: new Error("pg") };
    expect((await POST(req({ side: "for" }))).status).toBe(500);
  });

  it("returns a clean 503 (not an unhandled throw) when today's motion cannot load", async () => {
    h.s.topicError = new Error("postgres://secret");
    const res = await POST(req({ side: "for" }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(h.s.rpcCalls).toHaveLength(0);
  });
});
