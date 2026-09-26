import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mode: "ok" as "ok" | "throw" | "event-error" | "repair-error" | "invalid-repair-kind",
}));

vi.mock("@/lib/backend/server", () => ({
  createServiceClient: () => {
    if (h.mode === "throw") throw new Error("backend unavailable");
    return {
      from(table: string) {
        const builder = {
          select() { return builder; },
          order() { return builder; },
          limit() {
            if (table === "product_events" && h.mode === "event-error") {
              return Promise.resolve({ data: null, error: { message: "event read failed" } });
            }
            if (table === "repair_results" && h.mode === "repair-error") {
              return Promise.resolve({ data: null, error: { message: "repair read failed" } });
            }
            if (table === "repair_results" && h.mode === "invalid-repair-kind") {
              return Promise.resolve({
                data: [{
                  user_id: "u1",
                  debate_id: "d1",
                  target_kind: "not-a-repair-kind",
                  score: 80,
                  succeeded: true,
                  created_at: "2026-09-26T18:00:00Z",
                }],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
        };
        return builder;
      },
    };
  },
}));

import { loadFunnelData } from "./productFunnelServer";

describe("loadFunnelData availability semantics", () => {
  beforeEach(() => {
    h.mode = "ok";
  });

  it("reports backend initialization failure as unavailable, not zero activity", async () => {
    h.mode = "throw";
    const result = await loadFunnelData();
    expect(result.status).toBe("unavailable");
    expect(result.errorCategory).toBe("backend-unavailable");
    expect(result.completeness.note).toMatch(/unavailable/i);
  });

  it("reports event-read failure explicitly", async () => {
    h.mode = "event-error";
    const result = await loadFunnelData();
    expect(result.status).toBe("unavailable");
    expect(result.errorCategory).toBe("event-read-failed");
  });

  it("reports repair-read failure explicitly", async () => {
    h.mode = "repair-error";
    const result = await loadFunnelData();
    expect(result.status).toBe("unavailable");
    expect(result.errorCategory).toBe("repair-read-failed");
  });

  it("keeps a genuine empty dataset distinct from backend failure", async () => {
    const result = await loadFunnelData();
    expect(result.status).toBe("ok");
    expect(result.errorCategory).toBeNull();
    expect(result.events).toEqual([]);
    expect(result.repairs).toEqual([]);
  });

  it("quarantines invalid persisted repair kinds instead of casting them into analytics", async () => {
    h.mode = "invalid-repair-kind";
    const result = await loadFunnelData();
    expect(result.status).toBe("partial");
    expect(result.errorCategory).toBe("invalid-repair-kind");
    expect(result.repairs).toEqual([]);
  });
});
