import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  ipLimited: null as Response | null,
  userLimit: { ok: true, retryAfterSeconds: 0 } as { ok: boolean; retryAfterSeconds: number },
  rpcResult: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args });
      return h.rpcResult;
    },
  }),
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => h.ipLimited,
  checkRateLimitKey: async () => h.userLimit,
}));

import { POST } from "./route";
import { DEBATE_MODES } from "@/lib/debateModes";

const modeId = Object.keys(DEBATE_MODES as Record<string, unknown>)[0];

function call(body: unknown) {
  const request = new Request("http://test/api", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ debateId: "d1" }) });
}

describe("POST /api/solo/[debateId]/turn-window", () => {
  beforeEach(() => {
    h.user = { id: "user-1" };
    h.ipLimited = null;
    h.userLimit = { ok: true, retryAfterSeconds: 0 };
    h.rpcResult = { data: { modeId, remainingSeconds: 30, expired: false }, error: null };
    h.rpcCalls = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("rejects signed-out callers without touching the database", async () => {
    h.user = null;
    expect((await call({ turnId: "t", modeId })).status).toBe(401);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("returns the IP rate-limit response unchanged", async () => {
    h.ipLimited = new Response("slow", { status: 429 });
    expect((await call({ turnId: "t", modeId })).status).toBe(429);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("returns 429 with Retry-After when the user is limited", async () => {
    h.userLimit = { ok: false, retryAfterSeconds: 7 };
    const res = await call({ turnId: "t", modeId });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(h.rpcCalls).toHaveLength(0);
  });

  it.each([["not json"], [{ modeId }], [{ turnId: "t" }], [{ turnId: "t", modeId: "bogus" }], [{ turnId: 5, modeId }]])(
    "400s on invalid body %j",
    async (body) => {
      expect((await call(body)).status).toBe(400);
      expect(h.rpcCalls).toHaveLength(0);
    },
  );

  it("starts the window using the authenticated user, not a body-supplied one", async () => {
    const res = await call({ turnId: "t1", modeId, userId: "attacker" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ remainingSeconds: 30, expired: false });
    expect(h.rpcCalls[0].name).toBe("start_solo_turn_window");
    expect(h.rpcCalls[0].args).toMatchObject({ p_debate_id: "d1", p_user_id: "user-1", p_turn_id: "t1", p_mode: modeId });
  });

  it("500s when the rpc errors and 409s when the round is gone", async () => {
    h.rpcResult = { data: null, error: { message: "boom" } };
    expect((await call({ turnId: "t", modeId })).status).toBe(500);
    h.rpcResult = { data: null, error: null };
    expect((await call({ turnId: "t", modeId })).status).toBe(409);
  });
});
