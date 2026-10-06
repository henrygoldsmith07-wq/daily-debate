import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  status: "ok" as "ok" | "partial" | "unavailable",
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/requestAuth", () => ({
  getRequestAuthContext: vi.fn(async () => ({ user: { id: "admin" }, isAdmin: true })),
}));
vi.mock("@/lib/productFunnelServer", () => ({
  loadFunnelData: vi.fn(async () => ({
    status: h.status,
    errorCategory: h.status === "unavailable" ? "event-read-failed" : h.status === "partial" ? "turn-read-failed" : null,
    events: [],
    repairs: [],
    retests: [],
    debateWeaknesses: [],
    completeness: {
      events: { loaded: 0, limit: 20000, truncated: false },
      repairs: { loaded: 0, limit: 2000, truncated: false },
      retests: { loaded: 0, limit: 4000, truncated: false },
      debates: { loaded: 0, limit: 120, truncated: false },
      note: null,
    },
  })),
}));

import { GET } from "./route";

describe("GET /api/analytics/funnel", () => {
  beforeEach(() => {
    h.status = "ok";
  });

  it("returns 503 instead of a zero funnel when source data is unavailable", async () => {
    h.status = "unavailable";
    const response = await GET(new Request("https://daily-debate.test/api/analytics/funnel"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unavailable",
      errorCategory: "event-read-failed",
    });
  });

  it("marks partial source data in a successful report", async () => {
    h.status = "partial";
    const response = await GET(new Request("https://daily-debate.test/api/analytics/funnel"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "partial",
      errorCategory: "turn-read-failed",
    });
  });
});
