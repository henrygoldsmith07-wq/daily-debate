import { describe, expect, it } from "vitest";
import { buildResultSnapshot } from "./resultSnapshot";
import { assessArgumentGraph, mergeAssessmentGraphs, graphFromTurn } from "./observableAssessment";
import type { ArgGraph } from "./argGraph";

function assess(graph: ArgGraph) {
  return assessArgumentGraph(graph, {
    sideA: "a",
    sideB: "ai",
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "AI opponent",
  });
}

const SUPPORTED_GRAPH: ArgGraph = {
  nodes: [
    { id: "c1", kind: "claim", owner: "a", text: "Transit investment reduces congestion costs.", round: 1 },
    { id: "e1", kind: "evidence", owner: "a", text: "NREL data shows cost reductions.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
    { id: "o1", kind: "counterclaim", owner: "ai", text: "Remote work already reduces congestion.", round: 1 },
    { id: "r1", kind: "rebuttal", owner: "a", text: "Even if remote work helps, peak capacity still requires transit.", round: 2, targets: ["o1"] },
    { id: "o2", kind: "counterclaim", owner: "ai", text: "Autonomous vehicles may solve capacity.", round: 2 },
    { id: "r2", kind: "rebuttal", owner: "a", text: "However, AV capacity depends on road space cities cannot add.", round: 3, targets: ["o2"] },
  ],
  edges: [{ from: "e1", to: "c1", relation: "supports" }],
  dropped: [],
  contradictions: [],
  concessions: [],
  fallacies: [],
  evidenceStats: { total: 1, byOwner: { a: 1, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 1, strong: 0 }, unsupportedClaimIds: [] },
  impactComparison: null,
};

const UNSUPPORTED_GRAPH: ArgGraph = {
  nodes: [
    { id: "c1", kind: "claim", owner: "a", text: "Tuition caps always lower inequality.", round: 1 },
    { id: "c2", kind: "claim", owner: "a", text: "Enrolment rises because of the caps.", round: 2 },
    { id: "o1", kind: "counterclaim", owner: "ai", text: "Subsidies mostly benefit wealthier households.", round: 1 },
  ],
  edges: [],
  dropped: [],
  contradictions: [],
  concessions: [],
  fallacies: [],
  evidenceStats: { total: 0, byOwner: { a: 0, b: 0, ai: 0 }, byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 }, unsupportedClaimIds: ["c1", "c2"] },
  impactComparison: null,
};

describe("buildResultSnapshot", () => {
  it("leads with an evidence-grounded highlight and no fake weakness", () => {
    const snapshot = buildResultSnapshot(assess(SUPPORTED_GRAPH), { format: "full" });
    expect(snapshot.honesty.format).toBe("full");
    expect(snapshot.honesty.confidence).toBe("standard");
    expect(snapshot.highlight).not.toBeNull();
    expect(snapshot.highlight!.evidence).toMatch(/\d of \d/);
    expect(snapshot.weakness?.repair).not.toBeNull();
  });

  it("surfaces one main weakness when claims lack support", () => {
    const snapshot = buildResultSnapshot(assess(UNSUPPORTED_GRAPH), { format: "full" });
    expect(snapshot.weakness).not.toBeNull();
    expect(snapshot.weakness!.headline).toMatch(/^2 important claims had no supporting evidence$/);
    expect(snapshot.weakness!.whyItMatters).toMatch(/dismiss/i);
    expect(snapshot.weakness!.repair?.kind).toBe("evidence");
    expect(snapshot.weakness!.repair?.sourceText).toMatch(/Tuition caps/);
  });

  it("marks sprint sessions with reduced confidence", () => {
    const snapshot = buildResultSnapshot(assess(SUPPORTED_GRAPH), { format: "sprint" });
    expect(snapshot.honesty.confidence).toBe("reduced");
    expect(snapshot.honesty.note).toMatch(/Sprint read/i);
  });

  it("assesses the rebuttal goal outcome when the goal was rebuttal", () => {
    const snapshot = buildResultSnapshot(assess(SUPPORTED_GRAPH), { format: "full", goalDimension: "rebuttal" });
    expect(snapshot.goalOutcome.detail).toMatch(/directly answered \d of \d/);
  });

  it("returns an empty story rather than throwing without an assessment", () => {
    const snapshot = buildResultSnapshot(null, { format: "sprint" });
    expect(snapshot.highlight).toBeNull();
    expect(snapshot.weakness).toBeNull();
    expect(snapshot.honesty.confidence).toBe("reduced");
  });

  it("keeps secondary model feedback out of the main story", () => {
    const snapshot = buildResultSnapshot(assess(SUPPORTED_GRAPH), {
      format: "full",
      summary: { overallFeedback: "Solid", strengths: ["structure"], improvements: ["impact"] },
    });
    expect(snapshot.secondary.overallFeedback).toBe("Solid");
    expect(snapshot.secondary.strengths).toEqual(["structure"]);
  });
});

describe("graph turn helpers used by the snapshot", () => {
  it("detects unanswered opposing moves from real turn graphs", () => {
    const graphs = [
      graphFromTurn({
        userMessage: "School uniforms reduce bullying pressure, according to Pew studies.",
        opponentMessage: "However, uniform studies often confound school culture with the uniform policy itself.",
        round: 1,
      }),
      graphFromTurn({
        userMessage: "Even if confounds exist, the direction of the effect is consistent across districts.",
        opponentMessage: "But consistency without mechanism explains little about causation.",
        round: 2,
      }),
    ];
    const snapshot = buildResultSnapshot(assess(mergeAssessmentGraphs(graphs)), { format: "full" });
    expect(snapshot).not.toBeNull();
    expect(snapshot.honesty.format).toBe("full");
  });
});
