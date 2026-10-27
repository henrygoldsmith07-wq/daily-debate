import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  s: {
    user: { id: "a" } as { id: string } | null,
    limited: null as Response | null,
    match: { data: null, error: null } as { data: unknown; error: unknown },
    turns: { data: [], error: null } as { data: unknown; error: unknown },
  },
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => h.s.limited }));
vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.s.user } }) },
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        maybeSingle: async () => h.s.match,
        single: async () => h.s.match,
        then: (res: (v: unknown) => unknown) => Promise.resolve(table === "pvp_turns" ? h.s.turns : h.s.match).then(res),
      };
      return q;
    },
  }),
}));

import { GET } from "./route";

const call = () =>
  GET(new Request("http://localhost/api/pvp/m1"), { params: Promise.resolve({ matchId: "m1" }) });

beforeEach(() => {
  h.s.user = { id: "a" };
  h.s.limited = null;
  h.s.match = { data: { id: "m1", player_a: "a", player_b: "b" }, error: null };
  h.s.turns = { data: [{ id: "t1" }], error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/pvp/[matchId]", () => {
  it("401s signed-out callers", async () => {
    h.s.user = null;
    expect((await call()).status).toBe(401);
  });
  it("404s a match the caller is not in", async () => {
    h.s.user = { id: "z" };
    expect((await call()).status).toBe(404);
  });
  it("404s a genuinely missing match", async () => {
    h.s.match = { data: null, error: null };
    expect((await call()).status).toBe(404);
  });
  it("503s (not 404) when the match read fails", async () => {
    h.s.match = { data: null, error: { message: "db down" } };
    expect((await call()).status).toBe(503);
  });
  it("503s (not an empty transcript) when the turns read fails", async () => {
    h.s.turns = { data: null, error: { message: "db down" } };
    expect((await call()).status).toBe(503);
  });
  it("returns match and turns, uncached, to a participant", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).turns).toHaveLength(1);
  });
});
