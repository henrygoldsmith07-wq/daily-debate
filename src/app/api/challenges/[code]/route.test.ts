import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  s: {
    user: { id: "u1" } as { id: string } | null,
    limited: null as Response | null,
    invite: { data: null, error: null } as { data: unknown; error: unknown },
    rpc: { data: null, error: null } as { data: unknown; error: unknown },
    rpcCalls: 0,
    events: [] as unknown[],
  },
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => h.s.limited }));
vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.s.user } }) } }),
  createServiceClient: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () =>
          table === "challenge_invites"
            ? h.s.invite
            : table === "daily_topics"
              ? { data: { title: "Motion" }, error: null }
              : { data: { username: "ann" }, error: null },
      };
      return q;
    },
    rpc: async () => {
      h.s.rpcCalls++;
      return h.s.rpc;
    },
  }),
}));
vi.mock("@/lib/productEvents", () => ({
  recordProductEventForUser: async (...a: unknown[]) => void h.s.events.push(a),
}));

import { GET, POST } from "./route";

const CODE = "abcdefgh";
const params = (code = CODE) => ({ params: Promise.resolve({ code }) });
const req = (m = "GET") => new Request("http://localhost/api/challenges/x", { method: m });

beforeEach(() => {
  h.s.user = { id: "u1" };
  h.s.limited = null;
  h.s.invite = { data: null, error: null };
  h.s.rpc = { data: null, error: null };
  h.s.rpcCalls = 0;
  h.s.events = [];
});

describe("GET /api/challenges/[code]", () => {
  it("rejects a malformed code with 400", async () => {
    expect((await GET(req(), params("!"))).status).toBe(400);
  });

  it("returns 404 only when the invite truly does not exist", async () => {
    expect((await GET(req(), params())).status).toBe(404);
  });

  it("returns 503, not a misleading 404, when the invite lookup fails", async () => {
    h.s.invite = { data: null, error: new Error("pg down") };
    expect((await GET(req(), params())).status).toBe(503);
  });

  it("previews the invite with the friend's opposite side", async () => {
    h.s.invite = {
      data: {
        id: "i", code: CODE, status: "open", challenger_id: "c", challenger_side: "for",
        expires_at: "2999-01-01T00:00:00Z", topic_id: "t",
      },
      error: null,
    };
    const body = await (await GET(req(), params())).json();
    expect(body.invite).toMatchObject({ challengerSide: "for", opponentSide: "against", motion: "Motion", challengerName: "ann" });
  });
});

describe("POST /api/challenges/[code]", () => {
  it("requires sign-in before touching the database", async () => {
    h.s.user = null;
    expect((await POST(req("POST"), params())).status).toBe(401);
    expect(h.s.rpcCalls).toBe(0);
  });

  it.each([
    ["not_found", 404],
    ["self", 409],
    ["active_match", 409],
    ["closed", 409],
  ])("maps %s to %i", async (result, status) => {
    h.s.rpc = { data: [{ result, created_match_id: null, challenger_side: null }], error: null };
    expect((await POST(req("POST"), params())).status).toBe(status);
  });

  it("returns 500 when the rpc errors", async () => {
    h.s.rpc = { data: null, error: new Error("pg") };
    expect((await POST(req("POST"), params())).status).toBe(500);
  });

  it("accepts, gives the opposite side, and records the event once; reuse records none", async () => {
    h.s.rpc = { data: [{ result: "accepted", created_match_id: "m1", challenger_side: "for" }], error: null };
    const body = await (await POST(req("POST"), params())).json();
    expect(body).toEqual({ matchId: "m1", opponentSide: "against", reused: false });
    expect(h.s.events).toHaveLength(1);
    h.s.rpc = { data: [{ result: "accepted_existing", created_match_id: "m1", challenger_side: "for" }], error: null };
    expect((await (await POST(req("POST"), params())).json()).reused).toBe(true);
    expect(h.s.events).toHaveLength(1);
  });
});
