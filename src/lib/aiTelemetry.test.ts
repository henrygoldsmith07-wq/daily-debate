import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  recordAiCall,
  recentAiCalls,
  aiCallStats,
  resetAiTelemetry,
  classifyAiError,
  sanitizeDiagnostic,
  type AiCallTelemetry,
} from "./aiTelemetry";

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

describe("telemetry privacy: classifyAiError", () => {
  it("classifies rate limits as retryable", () => {
    const c = classifyAiError("HTTP 429: too many requests", 429);
    expect(c.category).toBe("rate_limit");
    expect(c.retryable).toBe(true);
    expect(c.httpStatus).toBe(429);
    expect(c.code).toBe("429");
  });

  it("classifies auth failures as non-retryable", () => {
    const c = classifyAiError("401 Unauthorized: invalid api key", 401);
    expect(c.category).toBe("auth");
    expect(c.retryable).toBe(false);
  });

  it("classifies timeouts and network failures as retryable", () => {
    expect(classifyAiError("The operation was aborted due to timeout").category).toBe("timeout");
    expect(classifyAiError("fetch failed: ECONNREFUSED").category).toBe("network");
  });

  it("classifies server errors as retryable and client errors as not", () => {
    expect(classifyAiError("HTTP 502", 502).category).toBe("server");
    expect(classifyAiError("HTTP 502", 502).retryable).toBe(true);
    expect(classifyAiError("HTTP 422", 422).category).toBe("invalid_request");
    expect(classifyAiError("HTTP 422", 422).retryable).toBe(false);
  });

  it("classifies empty/truncated responses", () => {
    const c = classifyAiError("returned no content (finish_reason: length)");
    expect(c.category).toBe("invalid_response");
    expect(c.code).toBe("length");
  });

  it("sanitises credentials out of diagnostics", () => {
    const c = classifyAiError("request failed with Authorization: Bearer sk-secret123456789 and api_key=abc123def456");
    expect(c.sanitized).not.toMatch(/sk-secret/);
    expect(c.sanitized).not.toMatch(/abc123def456/);
    expect(c.sanitized).toMatch(/\[redacted\]/);
  });

  it("bounds the diagnostic length", () => {
    const c = classifyAiError("x".repeat(500));
    expect((c.sanitized ?? "").length).toBeLessThanOrEqual(160);
  });
});

describe("telemetry privacy: storage boundary", () => {
  beforeEach(() => resetAiTelemetry());
  afterEach(() => vi.restoreAllMocks());

  it("never stores raw provider error text even from a misbehaving caller", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    recordAiCall(
      entry({
        outcome: "error",
        error: "HTTP 500 upstream said: Authorization: Bearer sk-live-abcdefghij {\"huge\":\"response body\"}".padEnd(400, "x"),
      }),
    );
    const stored = recentAiCalls(1)[0];
    expect(stored.error).not.toMatch(/sk-live/);
    expect(stored.error!.length).toBeLessThanOrEqual(160);
    // The structured log mirrors exactly what is stored — no raw leak.
    const logged = JSON.parse((spy.mock.calls[0] as unknown as [string, string])[1]);
    expect(logged.error).toBe(stored.error);
  });

  it("preserves structured classification fields on stored entries", () => {
    resetAiTelemetry();
    vi.spyOn(console, "info").mockImplementation(() => {});
    recordAiCall(entry({ outcome: "error", errorCategory: "rate_limit", errorCode: "429", httpStatus: 429, retryable: true, error: "HTTP 429" }));
    const stored = recentAiCalls(1)[0];
    expect(stored.errorCategory).toBe("rate_limit");
    expect(stored.errorCode).toBe("429");
    expect(stored.retryable).toBe(true);
  });
});

describe("sanitizeDiagnostic", () => {
  it("redacts multiple secret shapes and collapses whitespace", () => {
    const out = sanitizeDiagnostic("line1\napi_key = supersecretvalue\nBearer tok1234567890  end");
    expect(out).not.toMatch(/supersecretvalue/);
    expect(out).not.toMatch(/tok1234567890/);
    expect(out).not.toMatch(/\n/);
  });
});
