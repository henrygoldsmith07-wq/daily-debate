import { describe, it, expect } from "vitest";
import {
  buildSkillLedger,
  extractSkillPoint,
  trajectoryFor,
  getBenchmarkBaseline,
  METRIC_KEYS,
} from "./skillLedger";
import { assessArgumentGraph } from "./observableAssessment";
import type { ArgGraph } from "./argGraph";
import { emptyGraph } from "./argGraph";

function graph(nodes: ArgGraph["nodes"], edges: ArgGraph["edges"] = []): ArgGraph {
  return {
    ...emptyGraph(),
    nodes,
    edges,
    dropped: [],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: {
      total: nodes.filter((n) => n.kind === "evidence").length,
      byOwner: { a: 0, b: 0, ai: 0 },
      byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 },
      unsupportedClaimIds: nodes.filter((n) => n.kind === "claim" && !edges.some((e) => e.to === n.id)).map((n) => n.id),
    },
    impactComparison: null,
  };
}

function assess(g: ArgGraph) {
  return assessArgumentGraph(g, { sideA: "a", sideB: "b", extractionSource: "deterministic", labelA: "You", labelB: "AI" });
}

function point(i: number, g: ArgGraph) {
  return extractSkillPoint(`d${i}`, `2026-01-0${i + 1}T00:00:00Z`, assess(g), "a", 6);
}

describe("skill ledger extraction", () => {
  it("derives per-debate metrics from the observable assessment", () => {
    const early = graph(
      [
        { id: "c1", kind: "claim", owner: "a", text: "Claim without support.", round: 1 },
        { id: "o1", kind: "counterclaim", owner: "b", text: "Opposing claim.", round: 1 },
        { id: "r1", kind: "rebuttal", owner: "a", text: "Weak untargeted rebuttal.", round: 2 },
        { id: "e1", kind: "evidence", owner: "a", text: "Some study result.", round: 2, evidenceStrength: "strong", citations: [{ sourceName: "MyBlog" }] },
      ],
      [],
    );
    const p = point(0, early);
    // Rebuttal exists but targets nothing -> zero coverage.
    expect(p.metrics.rebuttalCoverage).toBe(0);
    expect(p.metrics.unsupportedClaimRate).toBeGreaterThan(0);
    // A "strong" evidence node citing MyBlog is not real grounding.
    expect(p.metrics.evidenceGrounding).toBeLessThan(1);
  });

  it("tracks a fixed benchmark baseline deterministically", () => {
    const b1 = getBenchmarkBaseline();
    const b2 = getBenchmarkBaseline();
    expect(b1).toBe(b2);
    for (const k of METRIC_KEYS) expect(b1[k]).not.toBeUndefined();
  });
});

describe("trajectory + improvement detection", () => {
  it("flags improvement when rebuttal coverage climbs from weak to strong", () => {
    const points = [];
    // Early debates: one dangling rebuttal (coverage 0).
    const earlyG = graph([
      { id: "c1", kind: "claim", owner: "a", text: "Claim.", round: 1 },
      { id: "o1", kind: "counterclaim", owner: "b", text: "Counter.", round: 1 },
      { id: "r1", kind: "rebuttal", owner: "a", text: "Untargeted reply.", round: 2 },
    ]);
    for (let i = 0; i < 4; i++) points.push(point(i, earlyG));
    // Later debates: targeted, evidence-backed rebuttals (coverage 1).
    const lateG = graph(
      [
        { id: "c1", kind: "claim", owner: "a", text: "Claim.", round: 1 },
        { id: "o1", kind: "counterclaim", owner: "b", text: "Counter.", round: 1 },
        { id: "e1", kind: "evidence", owner: "a", text: "Lazard analysis.", round: 2 },
        { id: "r1", kind: "rebuttal", owner: "a", text: "According to NREL data the trend reverses by 2035, addressing this directly.", round: 2, targets: ["o1"], citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
      ],
      [{ from: "e1", to: "r1", relation: "supports" }],
    );
    for (let i = 4; i < 8; i++) points.push(point(i, lateG));

    const t = trajectoryFor(points, "rebuttalCoverage");
    expect(t.first).toBe(0);
    expect(t.last).toBe(1);
    expect(t.goodnessDelta).toBe(1);
    expect(t.improved).toBe(true);

    const ledger = buildSkillLedger(points);
    expect(ledger.improvements).toContain("rebuttalCoverage");
    expect(ledger.benchmarkBaseline).not.toBeNull();
    expect(ledger.versusBaseline.rebuttalCoverage).toBeDefined();
  });

  it("treats rising bad-metric counts as regression, not improvement", () => {
    const clean = graph([{ id: "c1", kind: "claim", owner: "a", text: "Clean claim.", round: 1 }]);
    const messy = graph(
      [
        { id: "c1", kind: "claim", owner: "a", text: "Claim A.", round: 1 },
        { id: "c2", kind: "claim", owner: "a", text: "Contradicting claim.", round: 2 },
      ],
      [],
    );
    messy.contradictions = [{ a: "c1", b: "c2", explanation: "opposites", owner: "a" }];
    const points = [...Array.from({ length: 3 }, (_, i) => point(i, clean)), ...Array.from({ length: 3 }, (_, i) => point(i + 3, messy))];
    const ledger = buildSkillLedger(points);
    expect(ledger.regressions).toContain("contradictions");
    expect(ledger.improvements).not.toContain("contradictions");
  });

  it("withholds improved flags below the noise floor and on tiny samples", () => {
    const g = graph([{ id: "c1", kind: "claim", owner: "a", text: "Same claim.", round: 1 }]);
    const single = [point(0, g)];
    const t = trajectoryFor(single, "rebuttalCoverage");
    expect(t.improved).toBeNull();
  });
});
