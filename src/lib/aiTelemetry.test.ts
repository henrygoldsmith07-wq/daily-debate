import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recordAiCall, recentAiCalls, aiCallStats, resetAiTelemetry, type AiCallTelemetry } from "./aiTelemetry";

function entry(overrides: Partial<AiCallTelemetry> = {}): AiCallTelemetry {
  return {
    at: "2026-09-05T12:00:00Z",
    operation: "judge_pvp",
    provider: "openrouter",
    model: "test/model",
    latencyMs: 100,
    outcome: "ok",
    ...overrides,
  };
}

describe("aiTelemetry ledger", () => {
  beforeEach(() => resetAiTelemetry());
  afterEach(() => vi.restoreAllMocks());

  it("records entries and returns most recent first", () => {
    recordAiCall(entry({ operation: "a" }));
    recordAiCall(entry({ operation: "b" }));
    const recent = recentAiCalls();
    expect(recent).toHaveLength(2);
    expect(recent[0].operation).toBe("b");
    expect(recent[1].operation).toBe("a");
  });

  it("mirrors every entry to the structured log", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    recordAiCall(entry());
    expect(spy).toHaveBeenCalledTimes(1);
    const [prefix, json] = spy.mock.calls[0] as unknown as [string, string];
    expect(prefix).toBe("[ai-telemetry]");
    expect(JSON.parse(json)).toMatchObject({ operation: "judge_pvp", outcome: "ok" });
  });

  it("aggregates tokens, cost, latency and errors", () => {
    recordAiCall(entry({ promptTokens: 10, completionTokens: 20, costUsd: 0.01, latencyMs: 200 }));
    recordAiCall(entry({ promptTokens: 5, completionTokens: 5, costUsd: 0.005, latencyMs: 100 }));
    recordAiCall(entry({ outcome: "error", error: "HTTP 500", latencyMs: 50 }));
    const stats = aiCallStats();
    expect(stats.calls).toBe(3);
    expect(stats.errors).toBe(1);
    expect(stats.totalPromptTokens).toBe(15);
    expect(stats.totalCompletionTokens).toBe(25);
    expect(stats.totalCostUsd).toBeCloseTo(0.015, 6);
    // The failed call reported no cost, so the aggregate cost is not complete.
    expect(stats.costKnown).toBe(false);
    expect(stats.avgLatencyMs).toBeGreaterThan(0);
  });

  it("reports costKnown=true when every call carries provider-reported cost", () => {
    recordAiCall(entry({ promptTokens: 10, completionTokens: 20, costUsd: 0.01, latencyMs: 200 }));
    recordAiCall(entry({ promptTokens: 5, completionTokens: 5, costUsd: 0.005, latencyMs: 100 }));
    expect(aiCallStats().costKnown).toBe(true);
  });

  it("flags costKnown=false when any call lacks provider-reported cost (anthropic)", () => {
    recordAiCall(entry({ costUsd: 0.01 }));
    recordAiCall(entry({ provider: "anthropic" }));
    expect(aiCallStats().costKnown).toBe(false);
  });

  it("scopes stats by operation", () => {
    recordAiCall(entry({ operation: "judge_pvp" }));
    recordAiCall(entry({ operation: "debate_turn" }));
    expect(aiCallStats("judge_pvp").calls).toBe(1);
    expect(aiCallStats("debate_turn").calls).toBe(1);
    expect(aiCallStats("nothing").calls).toBe(0);
    expect(aiCallStats("nothing").avgLatencyMs).toBe(0);
  });

  it("caps the ring buffer at 500 entries", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    for (let i = 0; i < 520; i++) recordAiCall(entry());
    expect(recentAiCalls(1000)).toHaveLength(500);
    expect(spy).toHaveBeenCalledTimes(520);
  });
});
