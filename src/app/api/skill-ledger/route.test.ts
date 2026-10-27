import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    user: { id: "user-1" } as { id: string } | null,
    limited: null as Response | null,
    ledgerError: null as unknown,
    ledgerCalls: [] as string[],
    rateOpts: [] as unknown[],
  },
}));

vi.mock("@/lib/currentViewer", () => ({ getCurrentUser: async () => h.state.user }));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async (_req: Request, opts: unknown) => {
    h.state.rateOpts.push(opts);
    return h.state.limited;
  },
}));
vi.mock("@/lib/skillLedgerServer", () => ({
  buildLedgerForUser: async (id: string) => {
    h.state.ledgerCalls.push(id);
    if (h.state.ledgerError) throw h.state.ledgerError;
    return { owner: id, metrics: [] };
  },
}));

import { GET } from "./route";

const req = () => new Request("http://localhost/api/skill-ledger");

beforeEach(() => {
  h.state.user = { id: "user-1" };
  h.state.limited = null;
  h.state.ledgerError = null;
  h.state.ledgerCalls = [];
  h.state.rateOpts = [];
});

describe("GET /api/skill-ledger", () => {
  it("returns the rate limiter's response without building the ledger", async () => {
    h.state.limited = new Response("slow down", { status: 429 });
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(h.state.ledgerCalls).toHaveLength(0);
  });

  it("rejects signed-out callers without building the ledger", async () => {
    h.state.user = null;
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(h.state.ledgerCalls).toHaveLength(0);
  });

  it("builds only the signed-in user's ledger, uncached", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ owner: "user-1", metrics: [] });
    expect(h.state.ledgerCalls).toEqual(["user-1"]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(h.state.rateOpts[0]).toMatchObject({ name: "skill-ledger" });
  });

  it("returns a no-store 503 without leaking the error", async () => {
    h.state.ledgerError = new Error("postgres://secret");
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
