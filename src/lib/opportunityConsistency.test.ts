import { describe, expect, it } from "vitest";
import { assessArgumentGraph } from "./observableAssessment";
import { extractSkillPoint } from "./skillLedger";
import { measureDimension } from "./coachRewards";
import type { ArgGraph } from "./argGraph";
import { emptyGraph } from "./argGraph";

/**
 * CROSS-METRIC CONSISTENCY.
 *
 * Reward readings (coachRewards) and progress metrics (skillLedger) must
 * share opportunity definitions: the same graph, the same user behaviour,
 * must never produce contradictory conclusions about fallacies, evidence,
 * rebuttals, or dropped arguments.
 */

const AT = "2026-06-15T12:00:00Z";

function assess(graph: ArgGraph) {
  return assessArgumentGraph(graph, {
    sideA: "a",
    sideB: "ai",
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "AI opponent",
  });
}

function ledgerMetrics(graph: ArgGraph) {
  return extractSkillPoint("d1", AT, assess(graph), "a").metrics;
}

function base(): ArgGraph {
  return {
    ...emptyGraph(),
    nodes: [
      { id: "c1", kind: "claim", owner: "a", text: "User claim one.", round: 1 },
      { id: "e1", kind: "evidence", owner: "a", text: "NREL data one.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
      { id: "c2", kind: "claim", owner: "a", text: "User claim two.", round: 2 },
      { id: "e2", kind: "evidence", owner: "a", text: "Pew data two.", round: 2, evidenceStrength: "cited", citations: [{ sourceName: "Pew", homepage: "https://www.pewresearch.org" }] },
      { id: "o1", kind: "claim", owner: "ai", text: "Opponent claim one.", round: 1 },
      { id: "o2", kind: "claim", owner: "ai", text: "Opponent claim two.", round: 2 },
      { id: "r1", kind: "rebuttal", owner: "a", text: "User rebuttal one.", round: 2, targets: ["o1"] },
      { id: "r2", kind: "rebuttal", owner: "a", text: "User rebuttal two.", round: 3, targets: ["o2"] },
      { id: "i1", kind: "impact", owner: "a", text: "User impact.", round: 3 },
    ],
    edges: [
      { from: "e1", to: "c1", relation: "supports" },
      { from: "e2", to: "c2", relation: "supports" },
    ],
  };
}

describe("fallacy numerator and denominator agree across metrics", () => {
  const withFallacyOn = (nodeId: string, kind: "claim" | "counterclaim" | "rebuttal" | "impact" | "evidence"): ArgGraph => {
    const g = base();
    const id = `fx-${nodeId}`;
    if (kind === "evidence") {
      g.nodes.push({ id, kind: "evidence", owner: "a", text: "Everyone knows this source.", round: 2 });
    } else if (kind === "rebuttal") {
      g.nodes.push({ id, kind: "rebuttal", owner: "a", text: "Obviously wrong, everyone knows.", round: 2, targets: ["o1"] });
    } else if (kind === "impact") {
      g.nodes.push({ id, kind: "impact", owner: "a", text: "Obviously the biggest impact.", round: 3 });
    } else if (kind === "counterclaim") {
      g.nodes.push({ id, kind: "counterclaim", owner: "a", text: "Obviously the opposite.", round: 2 });
    } else {
      g.nodes.push({ id, kind: "claim", owner: "a", text: "Obviously true.", round: 2 });
    }
    g.fallacies.push({ nodeId: id, fallacy: "appeal_to_emotion", note: "x" });
    return g;
  };

  for (const kind of ["claim", "counterclaim", "rebuttal", "impact", "evidence"] as const) {
    it(`fallacy on a user ${kind} counts in both metrics with denominator present`, () => {
      const g = withFallacyOn(`fx-${kind}`, kind);
      const reward = measureDimension(g, "logic");
      const ledger = ledgerMetrics(g).fallacyRate;
      // Same scope both sides: numerator has its node in the denominator.
      expect(reward.opportunities).toBeGreaterThan(0);
      expect(reward.value).not.toBeNull();
      expect(ledger).not.toBeNull();
      // Identical rate: 1 fallacy over N own nodes in both systems.
      const ownCount = g.nodes.filter((n) => n.owner === "a").length;
      expect(reward.value).toBeCloseTo(1 - 1 / ownCount);
      expect(ledger).toBeCloseTo(1 / ownCount);
      expect(reward.value).toBeCloseTo(1 - (ledger as number));
    });
  }

  it("fallacy on an opponent node counts in neither metric", () => {
    const g = base();
    g.fallacies.push({ nodeId: "o1", fallacy: "strawman", note: "opponent" });
    expect(measureDimension(g, "logic").value).toBe(1);
    expect(ledgerMetrics(g).fallacyRate).toBe(0);
  });

  it("fallacy referencing an unknown node id counts nowhere", () => {
    const g = base();
    g.fallacies.push({ nodeId: "ghost-node", fallacy: "strawman", note: "dangling" });
    // Unknown ids belong to no side: numerator ignores them…
    expect(measureDimension(g, "logic").value).toBe(1);
    expect(ledgerMetrics(g).fallacyRate).toBe(0);
    // …and the denominator is unchanged (the ghost is not a move).
    expect(measureDimension(g, "logic").opportunities).toBe(
      g.nodes.filter((n) => n.owner === "a").length,
    );
  });

  it("empty user side is unmeasurable in both systems", () => {
    const g: ArgGraph = { ...emptyGraph(), nodes: [{ id: "o1", kind: "claim", owner: "ai", text: "Only opponent.", round: 1 }] };
    expect(measureDimension(g, "logic").value).toBeNull();
    expect(ledgerMetrics(g).fallacyRate).toBeNull();
  });
});

describe("evidence metrics agree across reward and progress", () => {
  it("reward evidence reading equals 1 minus the ledger unsupported rate", () => {
    const g = base();
    // Drop support for c2: now 1 of 2 own claims unsupported.
    g.edges = g.edges.filter((e) => !(e.from === "e2" && e.to === "c2"));
    g.evidenceStats.unsupportedClaimIds = ["c2"];
    expect(measureDimension(g, "evidence")).toEqual({ value: 0.5, opportunities: 2 });
    expect(ledgerMetrics(g).unsupportedClaimRate).toBe(0.5);
  });
});

describe("rebuttal opportunity handling is consistent", () => {
  it("final-round opponent moves are excluded from reward opportunity", () => {
    const g = base();
    // o3 arrives in the last round with no later user turn: not answerable.
    g.nodes.push({ id: "o3", kind: "claim", owner: "ai", text: "Late opponent claim.", round: 4 });
    const reading = measureDimension(g, "rebuttal");
    // Still 1.0: o1/o2 answered, o3 not an opportunity.
    expect(reading).toEqual({ value: 1, opportunities: 2 });
  });

  it("zero eligible moves is unmeasurable in the reward reading", () => {
    const g: ArgGraph = {
      ...emptyGraph(),
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
        { id: "o1", kind: "claim", owner: "ai", text: "Last-round opponent claim.", round: 2 },
      ],
    };
    expect(measureDimension(g, "rebuttal")).toEqual({ value: null, opportunities: 0 });
  });
});

describe("length invariance holds for progress metrics too", () => {
  it("same unsupported rate at different claim counts gives the same ledger rate", () => {
    const shortG = base();
    shortG.nodes = shortG.nodes.filter((n) => !["c2", "e2"].includes(n.id));
    shortG.edges = shortG.edges.filter((e) => e.from !== "e2");
    shortG.evidenceStats.unsupportedClaimIds = [];
    const longG = base();
    longG.evidenceStats.unsupportedClaimIds = [];
    expect(ledgerMetrics(shortG).unsupportedClaimRate).toBe(0);
    expect(ledgerMetrics(longG).unsupportedClaimRate).toBe(0);
  });
});
