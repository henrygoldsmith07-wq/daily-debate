import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    user: { id: "u1" } as { id: string } | null,
    limited: null as Response | null,
    ledger: { metrics: [] } as unknown,
    throwOnBuild: false,
    builtFor: [] as string[],
  },
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => h.state.limited }));
vi.mock("@/lib/currentViewer", () => ({ getCurrentUser: async () => h.state.user }));
vi.mock("@/lib/skillLedgerServer", () => ({
  buildLedgerForUser: async (id: string) => {
    h.state.builtFor.push(id);
    if (h.state.throwOnBuild) throw new Error("db down");
    return h.state.ledger;
  },
}));

import { GET } from "./route";

const req = () => new Request("http://x/api/skill-ledger");

beforeEach(() => {
  h.state.user = { id: "u1" };
  h.state.limited = null;
  h.state.ledger = { metrics: [] };
  h.state.throwOnBuild = false;
  h.state.builtFor = [];
});

describe("GET /api/skill-ledger", () => {
  it("returns the limiter response before touching auth or the ledger", async () => {
    h.state.limited = new Response("slow", { status: 429 });
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(h.state.builtFor).toEqual([]);
  });

  it("rejects signed-out callers without building a ledger", async () => {
    h.state.user = null;
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(h.state.builtFor).toEqual([]);
  });

  it("builds only the caller's own ledger, uncached", async () => {
    h.state.ledger = { metrics: [{ id: "m" }] };
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ metrics: [{ id: "m" }] });
    expect(h.state.builtFor).toEqual(["u1"]);
  });

  it("maps a build failure to an uncached 503 without leaking the error", async () => {
    h.state.throwOnBuild = true;
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(await res.json())).not.toContain("db down");
  });
});
