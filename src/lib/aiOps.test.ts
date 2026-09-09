import { describe, expect, it } from "vitest";
import { summariseAiOps, type AiOpsRow } from "./aiOps";

const NOW = "2026-06-15T12:00:00Z";

function row(operation: string, at: string, opts: { ok?: boolean; latency?: number; provider?: string; errorCategory?: string | null } = {}): AiOpsRow {
  return {
    operation,
    provider: opts.provider ?? "openrouter",
    model: "test/model",
    latencyMs: opts.latency ?? 500,
    ok: opts.ok ?? true,
    totalTokens: 100,
    errorCategory: opts.errorCategory ?? null,
    createdAt: at,
  };
}

describe("summariseAiOps", () => {
  it("declines rates below the minimum sample", () => {
    const report = summariseAiOps([row("judge_pvp", "2026-06-14T09:00:00Z")], { now: NOW });
    expect(report.overall.errorRate).toBeNull();
    expect(report.overall.note).toMatch(/not yet measurable/);
    expect(report.overall.calls).toBe(1);
  });

  it("computes error rate, mean and p95 latency at measurable samples", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => row("judge_pvp", `2026-06-1${(i % 5) + 1}T09:00:00Z`, { latency: 100 + i * 100, ok: i !== 0 })),
      row("judge_pvp", "2026-06-14T09:00:00Z", { ok: false, latency: 3000 }),
    ];
    const report = summariseAiOps(rows, { now: NOW });
    expect(report.overall.calls).toBe(10);
    expect(report.overall.errors).toBe(2);
    expect(report.overall.errorRate).toBeCloseTo(0.2);
    // p95 nearest-rank on sorted latencies; 3000 is the max.
    expect(report.overall.p95LatencyMs).toBe(3000);
  });

  it("splits stats per operation", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => row("debate_turn", `2026-06-1${i + 1}T09:00:00Z`, { latency: 200 })),
      ...Array.from({ length: 5 }, (_, i) => row("judge_pvp", `2026-06-1${i + 1}T09:00:00Z`, { latency: 900, ok: i < 4 })),
    ];
    const report = summariseAiOps(rows, { now: NOW });
    const turn = report.byOperation.find((o) => o.operation === "debate_turn");
    const judge = report.byOperation.find((o) => o.operation === "judge_pvp");
    expect(turn?.avgLatencyMs).toBe(200);
    expect(judge?.errorRate).toBeCloseTo(0.2);
    expect(report.byOperation[0].calls).toBeGreaterThanOrEqual(report.byOperation[1].calls);
  });

  it("excludes calls outside the window", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => row("judge_pvp", "2026-06-14T09:00:00Z")),
      row("judge_pvp", "2020-01-01T09:00:00Z", { ok: false }),
    ];
    const report = summariseAiOps(rows, { now: NOW, windowDays: 7 });
    expect(report.overall.calls).toBe(6);
    expect(report.overall.errors).toBe(0);
  });
});
