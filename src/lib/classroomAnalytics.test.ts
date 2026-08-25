import { describe, it, expect } from "vitest";
import { analyseClass, CLASS_DIMENSIONS } from "./classroomAnalytics";
import type { StudentDebateAssessment } from "./classroomAnalytics";

function assessment(studentId: string, debateId: string, opts?: {
  unsupportedClaims?: number;
  claims?: number;
  rebuttalsCovered?: boolean;
  fallacies?: number;
  impactComparison?: boolean;
  dropped?: number;
  contradictions?: number;
  steelmanScore?: number;
}): StudentDebateAssessment {
  const o = opts ?? {};
  const claimCount = o.claims ?? 3;
  const nodes: StudentDebateAssessment["assessment"]["graph"]["nodes"] = [];
  const edges: StudentDebateAssessment["assessment"]["graph"]["edges"] = [];

  for (let i = 0; i < claimCount; i++) {
    nodes.push({ id: `c${i}`, kind: "claim", owner: "a", text: `Claim ${i}.`, round: 1 });
  }
  // Unsupported claims get no evidence edge
  const unclaimed = o.unsupportedClaims ?? 0;
  for (let i = 0; i < claimCount - unclaimed; i++) {
    nodes.push({ id: `e${i}`, kind: "evidence", owner: "a", text: `Evidence ${i}.`, round: 1 });
    edges.push({ from: `e${i}`, to: `c${i}`, relation: "supports" });
  }
  // Opposing counterclaim
  nodes.push({ id: "o1", kind: "counterclaim", owner: "b", text: "Counter.", round: 2 });

  if (o.rebuttalsCovered) {
    nodes.push({ id: "r1", kind: "rebuttal", owner: "a", text: "Rebuttal.", round: 2, targets: ["o1"] });
    edges.push({ from: "r1", to: "o1", relation: "rebuts" });
  }

  const fallacies = Array.from({ length: o.fallacies ?? 0 }, (_, i) => ({
    nodeId: `c${i % claimCount}`, fallacy: "strawman", note: "",
  }));

  return {
    studentId,
    debateId,
    assessment: {
      graph: {
        nodes,
        edges,
        dropped: Array.from({ length: o.dropped ?? 0 }, () => ({ owner: "a" })),
        contradictions: Array.from({ length: o.contradictions ?? 0 }, () => ({ owner: "a" })),
        concessions: [],
        evidenceStats: {
          unsupportedClaimIds: Array.from({ length: unclaimed }, (_, i) => `c${claimCount - unclaimed + i}`),
          total: claimCount - unclaimed,
        },
        impactComparison: o.impactComparison ? { a: 60, b: 40, rationale: "" } : null,
      },
      engine: o.steelmanScore !== undefined
        ? { a: { steelmanQuality: { score: o.steelmanScore } } }
        : undefined,
    },
  };
}

describe("analyseClass", () => {
  it("computes class means across dimensions", () => {
    const result = analyseClass("Class 11B", [
      assessment("s1", "d1", { unsupportedClaims: 0, rebuttalsCovered: true, fallacies: 0, impactComparison: true }),
      assessment("s1", "d2", { unsupportedClaims: 1, rebuttalsCovered: true, fallacies: 1, impactComparison: true }),
      assessment("s2", "d3", { unsupportedClaims: 0, rebuttalsCovered: false, fallacies: 2, impactComparison: false }),
      assessment("s2", "d4", { unsupportedClaims: 2, rebuttalsCovered: false, fallacies: 1, impactComparison: false }),
    ]);
    expect(result.className).toBe("Class 11B");
    expect(result.studentsAnalysed).toBe(2);
    expect(result.debatesAnalysed).toBe(4);
    expect(result.dimensions).toHaveLength(CLASS_DIMENSIONS.length);
  });

  it("detects common problems when many students struggle on the same dimension", () => {
    // Both students weak on structure (high dropped + contradictions)
    const result = analyseClass("Class 11B", [
      assessment("s1", "d1", { dropped: 3, contradictions: 2 }),
      assessment("s2", "d2", { dropped: 2, contradictions: 3 }),
      assessment("s3", "d3", { dropped: 0, contradictions: 0 }), // strong on structure
    ], { minAffectedForProblem: 2 });
    expect(result.commonProblems.length).toBeGreaterThan(0);
    const structProblem = result.commonProblems.find((p) => p.dimension === "structure");
    expect(structProblem).toBeDefined();
    expect(structProblem!.affectedCount).toBe(2);
  });

  it("does not flag common problems when students are performing well", () => {
    const result = analyseClass("Class 11B", [
      assessment("s1", "d1", { unsupportedClaims: 0, dropped: 0, contradictions: 0, fallacies: 0, rebuttalsCovered: true, impactComparison: true }),
      assessment("s2", "d2", { unsupportedClaims: 0, dropped: 0, contradictions: 0, fallacies: 0, rebuttalsCovered: true, impactComparison: true }),
    ], { minAffectedForProblem: 2 });
    expect(result.commonProblems).toHaveLength(0);
  });

  it("returns empty profile with no assessments", () => {
    const r = analyseClass("Empty", []);
    expect(r.studentsAnalysed).toBe(0);
    expect(r.debatesAnalysed).toBe(0);
    expect(r.commonProblems).toHaveLength(0);
    expect(r.dimensions.every((d) => d.mean === 0)).toBe(true);
  });

  it("produces per-student breakdown keyed by student ID", () => {
    const result = analyseClass("Test", [
      assessment("alice", "d1"),
      assessment("bob", "d2"),
    ]);
    expect(Object.keys(result.perStudent)).toContain("alice");
    expect(Object.keys(result.perStudent)).toContain("bob");
  });
});
