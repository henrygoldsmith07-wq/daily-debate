import { describe, expect, it } from "vitest";
import type { ArgGraph } from "./argGraph";
import { buildArgumentDna, EMPTY_DNA_METRICS, graphStatsFor, type DnaDebateSnapshot } from "./argumentDna";
import { METRIC_KEYS } from "./skillLedger";

function graph(): ArgGraph {
  return {
    nodes: [
      { id: "c1", kind: "claim", owner: "a", text: "Claim", round: 1 },
      { id: "e1", kind: "evidence", owner: "a", text: "Evidence", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Pew Research Center" }] },
      { id: "r1", kind: "rebuttal", owner: "a", text: "Rebuttal", round: 2, targets: ["c2"] },
      { id: "c2", kind: "claim", owner: "b", text: "Counter", round: 2 },
    ],
    edges: [{ from: "e1", to: "c1", relation: "supports" }],
    dropped: [{ nodeId: "c2", text: "Counter", owner: "b", round: 2 }],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: {
      total: 1,
      byOwner: { a: 1, b: 0, ai: 0 },
      byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 },
      unsupportedClaimIds: [],
    },
    impactComparison: null,
  };
}

function metrics(overrides: Partial<typeof EMPTY_DNA_METRICS>): typeof EMPTY_DNA_METRICS {
  return { ...EMPTY_DNA_METRICS, ...overrides };
}

function snapshot(id: string, completedAt: string, extra: Partial<DnaDebateSnapshot> = {}): DnaDebateSnapshot {
  return {
    id,
    completedAt,
    topicTitle: "Test motion",
    format: "solo",
    score: 70,
    owner: "a",
    rounds: 2,
    graph: graph(),
    metrics: metrics({
      unsupportedClaimRate: 0.4,
      rebuttalCoverage: 0.65,
      evidenceGrounding: 0.7,
      impactHandling: 0.2,
      droppedArguments: 1,
      clarity: 0.7,
    }),
    analysed: true,
    graphStats: graphStatsFor(graph(), "a"),
    ...extra,
  };
}

describe("argument DNA", () => {
  it("counts only the user's nodes in a graph snapshot", () => {
    expect(graphStatsFor(graph(), "a")).toMatchObject({
      claims: 1,
      evidence: 1,
      rebuttals: 1,
      counterclaims: 0,
      citedEvidence: 1,
    });
  });

  it("sorts snapshots, groups months, and emits cautious pattern copy", () => {
    const model = buildArgumentDna([
      snapshot("d3", "2026-03-10T10:00:00Z"),
      snapshot("d1", "2026-01-10T10:00:00Z"),
      snapshot("d2", "2026-02-10T10:00:00Z"),
    ]);

    expect(model.snapshots.map((item) => item.id)).toEqual(["d1", "d2", "d3"]);
    expect(model.periods.map((period) => period.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(model.analysedDebates).toBe(3);
    expect(model.insights.some((item) => item.id === "causal-bridge")).toBe(true);
    expect(model.comparison.first?.id).toBe("d1");
    expect(model.comparison.latest?.id).toBe("d3");
  });

  it("keeps unanalysed history visible without adding null points to the profile", () => {
    const unanalysed = snapshot("legacy", "2025-12-10T10:00:00Z", { analysed: false, graph: null, metrics: EMPTY_DNA_METRICS, graphStats: graphStatsFor(null) });
    const model = buildArgumentDna([unanalysed]);
    expect(model.totalDebates).toBe(1);
    expect(model.analysedDebates).toBe(0);
    expect(model.points).toHaveLength(0);
    expect(METRIC_KEYS.every((key) => model.points[0]?.metrics[key] === null || model.points.length === 0)).toBe(true);
  });
});

