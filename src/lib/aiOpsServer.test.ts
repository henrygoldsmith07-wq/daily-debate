import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mode: "ok" as "ok" | "throw" | "read-error" | "truncated",
}));

function row(i: number) {
  return {
    operation: "judge",
    provider: "test",
    model: "model",
    latency_ms: 100 + i,
    outcome: "ok",
    total_tokens: 10,
    error_category: null,
    event_type: "model_call",
    input_count: null,
    batch_count: null,
    routing_decision: null,
    expensive_judge_calls_avoided: null,
    classification_fallbacks: null,
    classification_ambiguous: null,
    created_at: new Date().toISOString(),
  };
}

vi.mock("./backend/server", () => ({
  createServiceClient: () => {
    if (h.mode === "throw") throw new Error("backend unavailable");
    const builder = {
      select() { return builder; },
      gte() { return builder; },
      order() { return builder; },
      limit() {
        if (h.mode === "read-error") {
          return Promise.resolve({ data: null, error: { message: "read failed" } });
        }
        if (h.mode === "truncated") {
          return Promise.resolve({
            data: Array.from({ length: 5001 }, (_, i) => row(i)),
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      },
    };
    return { from: () => builder };
  },
}));

import { loadAiOpsData } from "./aiOpsServer";

describe("loadAiOpsData", () => {
  beforeEach(() => {
    h.mode = "ok";
  });

  it("distinguishes backend failure from zero model calls", async () => {
    h.mode = "throw";
    const result = await loadAiOpsData();
    expect(result).toEqual({
      status: "unavailable",
      errorCategory: "backend-unavailable",
      report: null,
    });
  });

  it("reports a query failure explicitly", async () => {
    h.mode = "read-error";
    const result = await loadAiOpsData();
    expect(result.status).toBe("unavailable");
    expect(result.errorCategory).toBe("ai-log-read-failed");
  });

  it("keeps a genuine empty window as valid data", async () => {
    const result = await loadAiOpsData();
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.report.totalCalls).toBe(0);
  });

  it("marks a capped query as partial rather than pretending it is complete", async () => {
    h.mode = "truncated";
    const result = await loadAiOpsData();
    expect(result.status).toBe("partial");
    if (result.status === "partial") expect(result.report.totalCalls).toBe(5000);
  });
});
