import { describe, expect, it } from "vitest";
import type { ArgGraph } from "./argGraph";
import {
  assessArgumentGraph,
  enrichObservableGraph,
  swapGraphSides,
} from "./observableAssessment";

function groundedGraph(): ArgGraph {
  return {
    nodes: [
      { id: "a-claim", kind: "claim", owner: "a", text: "Renewables lower household electricity costs", round: 1 },
      { id: "a-evidence", kind: "evidence", owner: "a", text: "Lazard LCOE reports solar at $24/MWh, lower than new gas", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com", excerpt: "LCOE comparison for new solar and gas." }] },
      { id: "a-rebuttal", kind: "rebuttal", owner: "a", text: "Storage addresses the intermittency objection", round: 2, targets: ["b-claim"] },
      { id: "a-impact", kind: "impact", owner: "a", text: "Lower costs matter more for household budgets", round: 2 },
      { id: "b-claim", kind: "counterclaim", owner: "b", text: "Intermittency requires backup and raises grid costs", round: 1 },
      { id: "b-evidence", kind: "evidence", owner: "b", text: "My uncle saw a blackout", round: 1, evidenceStrength: "anecdotal" },
      { id: "b-impact", kind: "impact", owner: "b", text: "Reliability risk matters for the grid", round: 2 },
    ],
    edges: [
      { from: "a-evidence", to: "a-claim", relation: "supports" },
      { from: "a-rebuttal", to: "b-claim", relation: "rebuts" },
      { from: "a-claim", to: "a-impact", relation: "impacts" },
      { from: "b-claim", to: "b-impact", relation: "impacts" },
    ],
    dropped: [],
    contradictions: [],
    concessions: [],
    fallacies: [],
    evidenceStats: { total: 2, byOwner: { a: 1, b: 1, ai: 0 }, byStrength: { anecdotal: 1, general: 0, cited: 1, strong: 0 }, unsupportedClaimIds: [] },
    impactComparison: { a: 90, b: 10, rationale: "ignored model annotation" },
  };
}

function eloquentNonsenseGraph(): ArgGraph {
  const graph = groundedGraph();
  graph.nodes = graph.nodes.map((node) => node.owner === "a"
    ? { ...node, text: node.kind === "evidence" ? "" : "This exquisitely articulated paradigm, through a kaleidoscope of undeniable abstractions, proves prosperity without a measurable premise." }
    : node);
  graph.edges = graph.edges.filter((edge) => edge.from !== "a-evidence");
  graph.evidenceStats.unsupportedClaimIds = ["a-claim"];
  graph.nodes.push(
    { id: "b-cited", kind: "evidence", owner: "b", text: "NIST reliability review reports measured grid failure risk", round: 2, evidenceStrength: "cited", citations: [{ sourceName: "NIST", homepage: "https://www.nist.gov", excerpt: "Measured reliability and risk." }] },
    { id: "b-rebuttal", kind: "rebuttal", owner: "b", text: "The measurable risk is the answer to the abstract claim", round: 2, targets: ["a-claim"] },
  );
  graph.edges.push(
    { from: "b-cited", to: "b-claim", relation: "supports" },
    { from: "b-rebuttal", to: "a-claim", relation: "rebuts" },
  );
  return graph;
}

describe("observable assessment", () => {
  it("uses explicit graph-feature composition and attaches evidence to every component", () => {
    const assessment = assessArgumentGraph(groundedGraph(), { extractionSource: "human", extractionConfidence: 1 });
    expect(assessment.status).toBe("scored");
    expect(assessment.winner).toBe("a");
    expect(assessment.scores.a).toBeGreaterThan(assessment.scores.b ?? -1);
    expect(Object.values(assessment.scoreComposition.weights).reduce((sum, weight) => sum + weight, 0)).toBe(100);
    expect(assessment.sideScores.a.components.every((component) => component.evidence.length > 0)).toBe(true);
    expect(assessment.sideScores.b.components.every((component) => component.evidence.length > 0)).toBe(true);
    expect(assessment.sideScores.a.components.some((component) => component.id === "evidenceQuality" && component.evidence.some((ref) => ref.id === "a-evidence"))).toBe(true);
    expect(assessment.features.a.claimsMade.value).toBe(1);
    expect(assessment.features.a.claimsDirectlySupported.value).toBe(1);
    expect(assessment.features.a.evidenceActuallyCited.value).toBe(1);
    expect(assessment.features.a.directRebuttals.value).toBeGreaterThan(0);
    expect(assessment.features.b.unsupportedAssertions.value).toBe(1);
  });

  it("returns insufficient_evidence instead of inventing a score", () => {
    const assessment = assessArgumentGraph({
      nodes: [{ id: "c1", kind: "claim", owner: "a", text: "A bare assertion", round: 1 }],
      edges: [], dropped: [], contradictions: [], concessions: [], fallacies: [],
      evidenceStats: { total: 0, byOwner: { a: 0, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 }, unsupportedClaimIds: ["c1"] },
      impactComparison: null,
    });
    expect(assessment.status).toBe("insufficient_evidence");
    expect(assessment.winner).toBe("tie");
    expect(assessment.scores.a).toBeNull();
    expect(assessment.scores.b).toBeNull();
    expect(assessment.uncertainty.some((item) => /insufficient|fewer|no independently/i.test(item))).toBe(true);
  });

  it("is invariant to swapping side ownership while preserving arguments", () => {
    const original = assessArgumentGraph(groundedGraph(), { extractionSource: "human", extractionConfidence: 1 });
    const swapped = assessArgumentGraph(swapGraphSides(groundedGraph()), { extractionSource: "human", extractionConfidence: 1 });
    expect(swapped.winner).toBe("b");
    expect(swapped.scores.a).toBe(original.scores.b);
    expect(swapped.scores.b).toBe(original.scores.a);
    expect(swapped.features.a.claimsMade.value).toBe(original.features.b.claimsMade.value);
    expect(swapped.features.b.evidenceActuallyCited.value).toBe(original.features.a.evidenceActuallyCited.value);
  });

  it("does not reward eloquent unsupported nonsense over concise cited evidence", () => {
    const assessment = assessArgumentGraph(eloquentNonsenseGraph(), { extractionSource: "human", extractionConfidence: 1 });
    expect(assessment.status).toBe("scored");
    expect(assessment.winner).toBe("b");
    expect(assessment.features.a.unsupportedAssertions.value).toBeGreaterThan(0);
    expect(assessment.features.b.evidenceActuallyCited.value).toBe(1);
  });

  it("does not turn verbosity or repeated source names into extra quality", () => {
    const base = assessArgumentGraph(groundedGraph(), { extractionSource: "human", extractionConfidence: 1 });
    const verbose = groundedGraph();
    verbose.nodes = verbose.nodes.map((node) => ({ ...node, text: `${node.text} Indeed, this is unequivocally decisive and beyond reasonable dispute.` }));
    const wordy = assessArgumentGraph(verbose, { extractionSource: "human", extractionConfidence: 1 });
    expect(wordy.scores.a).toBe(base.scores.a);
    expect(wordy.scores.b).toBe(base.scores.b);

    const repeated = groundedGraph();
    const evidence = repeated.nodes.find((node) => node.id === "a-evidence")!;
    evidence.citations = [
      ...(evidence.citations ?? []),
      { sourceName: "Lazard", homepage: "https://www.lazard.com", excerpt: "The same source repeated." },
    ];
    const repeatedAssessment = assessArgumentGraph(repeated, { extractionSource: "human", extractionConfidence: 1 });
    expect(repeatedAssessment.scores.a).toBe(base.scores.a);

    const extraSource = groundedGraph();
    extraSource.nodes.push({
      id: "a-evidence-2",
      kind: "evidence",
      owner: "a",
      text: "Lazard LCOE reports solar at $24/MWh, lower than new gas",
      round: 1,
      evidenceStrength: "cited",
      citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com" }],
    });
    extraSource.edges.push({ from: "a-evidence-2", to: "a-claim", relation: "supports" });
    const extraSourceAssessment = assessArgumentGraph(extraSource, { extractionSource: "human", extractionConfidence: 1 });
    expect(extraSourceAssessment.scores.a).toBe(base.scores.a);
  });

  it("recomputes model-supplied counts and ignores arbitrary impact numbers", () => {
    const enriched = enrichObservableGraph(groundedGraph());
    expect(enriched.evidenceStats.total).toBe(2);
    expect(enriched.evidenceStats.byOwner.a).toBe(1);
    const assessment = assessArgumentGraph(groundedGraph(), { extractionSource: "llm" });
    expect(assessment.graph.impactComparison?.a).not.toBe(90);
    expect(assessment.extraction.uncertainty.some((item) => /LLM/i.test(item))).toBe(true);
  });
});

