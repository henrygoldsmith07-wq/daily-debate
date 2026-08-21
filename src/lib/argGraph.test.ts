import { describe, it, expect } from "vitest";
import { emptyGraph, validateGraph, claimSupportMap, groundedEvidenceRatio, claimCoverageWithGroundedEvidence } from "./argGraph";
import type { ArgGraph } from "./argGraph";

function sample(): ArgGraph {
  return {
    nodes: [
      { id: "c1", kind: "claim", owner: "a", text: "Renewables are cheaper than fossil fuels.", round: 1 },
      { id: "e1", kind: "evidence", owner: "a", text: "Lazard LCOE 2024: solar $24/MWh.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com", excerpt: "2024 LCOE finds utility-scale solar cheapest new build." }] },
      { id: "k1", kind: "counterclaim", owner: "b", text: "Grid needs baseload, renewables intermittent.", round: 2 },
      { id: "r1", kind: "rebuttal", owner: "a", text: "Storage + demand response covers intermittency.", round: 3, targets: ["k1"] },
      { id: "i1", kind: "impact", owner: "a", text: "Cheaper energy wins on household bills.", round: 3 },
      { id: "c2", kind: "claim", owner: "b", text: "Nuclear is the only reliable zero-carbon baseload.", round: 2 },
    ],
    edges: [
      { from: "e1", to: "c1", relation: "supports" },
      { from: "k1", to: "c1", relation: "counters" },
      { from: "r1", to: "k1", relation: "rebuts" },
      { from: "c1", to: "i1", relation: "impacts" },
    ],
    dropped: [{ nodeId: "c2", text: "Nuclear baseload claim", owner: "b", round: 2 }],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: {
      total: 1,
      byOwner: { a: 1, b: 0, ai: 0 },
      byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 },
      unsupportedClaimIds: ["c2"],
    },
    impactComparison: { a: 62, b: 38, rationale: "Cost-of-living impact was evidenced; reliability impact was asserted but not weighed." },
  };
}

describe("argGraph", () => {
  it("emptyGraph has empty collections", () => {
    const g = emptyGraph();
    expect(g.nodes).toHaveLength(0);
    expect(validateGraph(g)).toEqual([]);
  });

  it("validateGraph catches bad ids", () => {
    const g = sample();
    g.edges.push({ from: "nope", to: "c1", relation: "supports" });
    const errors = validateGraph(g);
    expect(errors.some((e) => e.includes("nope"))).toBe(true);
  });

  it("claimSupportMap uses unsupportedClaimIds as ground truth", () => {
    const g = sample();
    const m = claimSupportMap(g);
    expect(m.get("c1")).toBe(true);
    expect(m.get("c2")).toBe(false);
  });

  it("tracking: dropped, unsupported, fallacies shape", () => {
    const g = sample();
    expect(g.dropped).toHaveLength(1);
    expect(g.evidenceStats.unsupportedClaimIds).toContain("c2");
    expect(g.fallacies).toHaveLength(0);
  });

  it("validateGraph requires citations for cited/strong evidence", () => {
    const g = sample();
    g.nodes.push({ id: "e2", kind: "evidence", owner: "b", text: "Study shows baseload matters.", round: 2, evidenceStrength: "cited" });
    const errors = validateGraph(g);
    expect(errors.some((e) => e.includes("e2"))).toBe(true);
    // anecdotal without citations is fine
    const h = sample();
    h.nodes.push({ id: "e3", kind: "evidence", owner: "b", text: "My uncle saw blackouts.", round: 2, evidenceStrength: "anecdotal" });
    expect(validateGraph(h).some((e) => e.includes("e3"))).toBe(false);
  });

  it("grounded metrics: evidence ratio and grounded claim coverage", () => {
    const g = sample();
    expect(groundedEvidenceRatio(g)).toBe(1);
    expect(claimCoverageWithGroundedEvidence(g)).toBe(0.5); // c1 grounded, c2 unsupported
    const empty = emptyGraph();
    expect(groundedEvidenceRatio(empty)).toBe(1);
    expect(claimCoverageWithGroundedEvidence(empty)).toBe(1);
  });
});
