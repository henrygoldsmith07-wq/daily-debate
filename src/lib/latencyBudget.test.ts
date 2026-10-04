import { describe, it, expect } from "vitest";
import { assessLatencyBudgets, LATENCY_BUDGETS, MIN_BUDGET_SAMPLE, type LatencyBudget } from "./latencyBudget";
import type { AiOpsStats } from "./aiOps";

const NOW = "2026-10-04T12:00:00Z";

const stat = (operation: string, over: Partial<AiOpsStats> = {}): AiOpsStats => ({
  operation,
  calls: 40,
  errors: 1,
  errorRate: 0.025,
  avgLatencyMs: 1_200,
  p95LatencyMs: 2_000,
  byCategory: {},
  note: null,
  ...over,
});

const ONE: LatencyBudget[] = [
  {
    operation: "debate_turn",
    label: "Opponent turn",
    budgetMs: 6_000,
    rationale: "test",
    degradedBehaviour: "Keeps the learner's text and lets them resubmit.",
  },
];

describe("assessLatencyBudgets", () => {
  it("reports ok inside budget", () => {
    const r = assessLatencyBudgets({ stats: [stat("debate_turn", { p95LatencyMs: 5_000 })], generatedAt: NOW, budgets: ONE });
    expect(r.assessments[0].state).toBe("ok");
    expect(r.assessments[0].measuredP95Ms).toBe(5_000);
    expect(r.overBudget).toBe(0);
  });

  it("reports over-budget and counts it", () => {
    const r = assessLatencyBudgets({ stats: [stat("debate_turn", { p95LatencyMs: 15_600 })], generatedAt: NOW, budgets: ONE });
    expect(r.assessments[0].state).toBe("over-budget");
    expect(r.overBudget).toBe(1);
    expect(r.note).toContain("provider-latency regressions");
  });

  it("treats the budget as inclusive: exactly at budget is not a breach", () => {
    const r = assessLatencyBudgets({ stats: [stat("debate_turn", { p95LatencyMs: 6_000 })], generatedAt: NOW, budgets: ONE });
    expect(r.assessments[0].state).toBe("ok");
  });

  it("never judges a sample too small to judge", () => {
    const r = assessLatencyBudgets({
      stats: [stat("debate_turn", { calls: MIN_BUDGET_SAMPLE - 1, p95LatencyMs: 99_000 })],
      generatedAt: NOW,
      budgets: ONE,
    });
    expect(r.assessments[0].state).toBe("insufficient-data");
    // The measured value is withheld rather than shown as a pass or a fail.
    expect(r.assessments[0].measuredP95Ms).toBeNull();
    expect(r.overBudget).toBe(0);
    expect(r.assessments[0].note).toContain("Not judged either way");
    expect(r.note).toContain("Absence of calls is not evidence of speed");
  });

  it("treats a null p95 as insufficient even with many calls", () => {
    const r = assessLatencyBudgets({ stats: [stat("debate_turn", { p95LatencyMs: null })], generatedAt: NOW, budgets: ONE });
    expect(r.assessments[0].state).toBe("insufficient-data");
  });

  it("reports an operation with no rows as unmeasured, not healthy", () => {
    const r = assessLatencyBudgets({ stats: [], generatedAt: NOW, budgets: ONE });
    expect(r.assessments[0].state).toBe("unmeasured");
    expect(r.assessments[0].note).toContain("Absence of calls is not evidence of speed");
  });

  it("carries the degraded behaviour onto every assessment", () => {
    const r = assessLatencyBudgets({ stats: [stat("debate_turn", { p95LatencyMs: 40_000 })], generatedAt: NOW, budgets: ONE });
    // What the user experiences when the budget is missed is the decision that
    // matters, so it travels with the measurement rather than living in docs.
    expect(r.assessments[0].degradedBehaviour).toContain("resubmit");
  });

  it("carries the documented turn budget rather than a looser invented one", () => {
    // docs/operations.md states p95 <= 6s for a debate turn. The target is the
    // product's, not this module's; a free-tier provider being unable to meet
    // it is reported as a breach, never answered by raising the bar.
    const turn = LATENCY_BUDGETS.find((b) => b.operation === "debate_turn");
    expect(turn?.budgetMs).toBe(6_000);
    const finish = LATENCY_BUDGETS.find((b) => b.operation === "summarize_solo");
    expect(finish?.budgetMs).toBe(8_000);
  });

  it("says so when nothing is breached but data is thin", () => {
    const r = assessLatencyBudgets({
      stats: [stat("debate_turn", { p95LatencyMs: 5_000 }), stat("judge_pvp", { calls: 1, p95LatencyMs: null })],
      generatedAt: NOW,
      budgets: [ONE[0], { ...ONE[0], operation: "judge_pvp", budgetMs: 30_000 }],
    });
    expect(r.overBudget).toBe(0);
    expect(r.insufficientData).toBe(1);
    expect(r.note).toContain("Absence of calls is not evidence of speed");
  });

  it("every declared budget carries a rationale and a degraded behaviour", () => {
    for (const b of LATENCY_BUDGETS) {
      expect(b.rationale.length).toBeGreaterThan(20);
      expect(b.degradedBehaviour.length).toBeGreaterThan(20);
      expect(b.budgetMs).toBeGreaterThan(0);
    }
  });

  it("assesses every declared budget against the default set", () => {
    const r = assessLatencyBudgets({ stats: [], generatedAt: NOW });
    expect(r.assessments).toHaveLength(LATENCY_BUDGETS.length);
    expect(r.unmeasured).toBe(LATENCY_BUDGETS.length);
    expect(r.note).toContain("No budget is currently breached");
  });

  it("judges each operation independently", () => {
    const budgets: LatencyBudget[] = [
      ONE[0],
      { operation: "judge_pvp", label: "PvP verdict", budgetMs: 30_000, rationale: "test", degradedBehaviour: "insufficient_evidence" },
    ];
    const r = assessLatencyBudgets({
      stats: [stat("debate_turn", { p95LatencyMs: 40_000 }), stat("judge_pvp", { p95LatencyMs: 10_000 })],
      generatedAt: NOW,
      budgets,
    });
    expect(r.assessments[0].state).toBe("over-budget");
    expect(r.assessments[1].state).toBe("ok");
  });
});