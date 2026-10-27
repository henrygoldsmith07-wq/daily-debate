import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  s: {
    user: { id: "a" } as { id: string } | null,
    limited: null as Response | null,
    match: { data: null, error: null } as { data: unknown; error: unknown },
    update: { data: [{ id: "m1" }], error: null } as { data: unknown; error: unknown },
    patch: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => h.s.limited }));
vi.mock("@/lib/backend/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.s.user } }) } }),
  createServiceClient: () => ({
    from: () => {
      let updating = false;
      const q = {
        select: () => (updating ? Promise.resolve(h.s.update) : q),
        update: (p: Record<string, unknown>) => {
          updating = true;
          h.s.patch = p;
          return q;
        },
        eq: () => q,
        maybeSingle: async () => h.s.match,
        single: async () => h.s.match,
      };
      return q;
    },
  }),
}));

import { POST } from "./route";
import { TURN_ABANDON_MINUTES } from "@/lib/types";

const call = () =>
  POST(new Request("http://localhost/api/pvp/m1/forfeit", { method: "POST" }), {
    params: Promise.resolve({ matchId: "m1" }),
  });
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeEach(() => {
  h.s.user = { id: "a" };
  h.s.limited = null;
  h.s.patch = null;
  h.s.update = { data: [{ id: "m1" }], error: null };
  h.s.match = {
    data: {
      id: "m1",
      player_a: "a",
      player_b: "b",
      status: "active",
      current_turn_player: "b",
      turn_started_at: ago(TURN_ABANDON_MINUTES + 5),
    },
    error: null,
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/pvp/[matchId]/forfeit", () => {
  it("401s signed-out callers", async () => {
    h.s.user = null;
    expect((await call()).status).toBe(401);
  });
  it("404s a match the caller is not in, and a missing match", async () => {
    h.s.user = { id: "z" };
    expect((await call()).status).toBe(404);
    h.s.user = { id: "a" };
    h.s.match = { data: null, error: null };
    expect((await call()).status).toBe(404);
  });
  it("503s (not 404) when the match read fails", async () => {
    h.s.match = { data: null, error: { message: "db down" } };
    expect((await call()).status).toBe(503);
  });
  it("409s when it is the caller's own turn", async () => {
    h.s.user = { id: "b" };
    expect((await call()).status).toBe(409);
  });
  it("409s while the opponent is still inside the abandon window", async () => {
    (h.s.match.data as Record<string, unknown>).turn_started_at = ago(1);
    const res = await call();
    expect(res.status).toBe(409);
    expect(h.s.patch).toBeNull();
  });
  it("completes the match with an unscored forfeit verdict", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict.scoreStatus).toBe("insufficient_evidence");
    expect(body.verdict.winner).toBe("a");
    expect(h.s.patch).toMatchObject({ status: "completed", winner_id: "a" });
  });
  it("409s when another claim already completed the match", async () => {
    h.s.update = { data: [], error: null };
    expect((await call()).status).toBe(409);
  });
  it("503s (not 'already completed') when the write fails", async () => {
    h.s.update = { data: null, error: { message: "db down" } };
    expect((await call()).status).toBe(503);
  });
});
