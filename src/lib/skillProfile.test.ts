import { describe, it, expect } from "vitest";
import { computeSkillProfile, MIN_PROFILE_DEBATES, PROFILE_DIMENSIONS } from "./skillProfile";
import type { SkillMetricPoint } from "./skillLedger";

function point(metrics: Partial<SkillMetricPoint["metrics"]>): SkillMetricPoint {
  return {
    debateId: "d",
    completedAt: "2026-01-01T00:00:00Z",
    metrics: {
      unsupportedClaimRate: null, rebuttalCoverage: null, evidenceGrounding: null,
      droppedArguments: null, contradictions: null, impactHandling: null,
      steelmanQuality: null, fallacyRate: null, causalOverclaims: null,
      fakePrecisionHits: null, uncitedEvidenceRate: null, clarity: null,
      ...metrics,
    },
  };
}

describe("computeSkillProfile", () => {
  it("returns all 7 dimensions", () => {
    const p = computeSkillProfile([]);
    expect(p.dimensions).toHaveLength(7);
    expect(p.dimensions.map((d) => d.key)).toEqual(PROFILE_DIMENSIONS.map((d) => d.key));
  });

  it("scores are null with no data", () => {
    const p = computeSkillProfile([]);
    expect(p.overallScore).toBeNull();
    expect(p.dimensions.every((d) => d.score === null && d.lowConfidence)).toBe(true);
  });

  it("flags low confidence below minimum debates", () => {
    // MIN_PROFILE_DEBATES = 3; provide only 2
    const pts = [
      point({ rebuttalCoverage: 0.8 }),
      point({ rebuttalCoverage: 0.9 }),
    ];
    const p = computeSkillProfile(pts);
    const rebuttal = p.dimensions.find((d) => d.key === "rebuttal");
    expect(rebuttal?.lowConfidence).toBe(true);
    expect(rebuttal?.score).not.toBeNull(); // score still computed
  });

  it("removes low-confidence flag at or above minimum debates", () => {
    const pts = Array.from({ length: MIN_PROFILE_DEBATES }, (_, i) =>
      point({ rebuttalCoverage: 0.8 })
    );
    const p = computeSkillProfile(pts);
    const rebuttal = p.dimensions.find((d) => d.key === "rebuttal");
    expect(rebuttal?.lowConfidence).toBe(false);
  });

  it("inverts lower-is-better metrics correctly", () => {
    // fallacyRate = 0.1 → goodness = 0.9 → score = 90
    const p = computeSkillProfile([point({ fallacyRate: 0.1 })]);
    const reasoning = p.dimensions.find((d) => d.key === "reasoning");
    expect(reasoning?.score).toBe(90);
  });

  it("averages multiple source metrics within a dimension", () => {
    // claim-clarity sources: clarity (higher-better) + unsupportedClaimRate (lower-better)
    // clarity = 0.8 → goodness 0.8; unsupportedRate = 0.2 → goodness 0.8; mean = 80
    const p = computeSkillProfile([point({ clarity: 0.8, unsupportedClaimRate: 0.2 })]);
    const cc = p.dimensions.find((d) => d.key === "claim-clarity");
    expect(cc?.score).toBe(80);
  });

  it("skips dimensions with no data points without crashing", () => {
    // Only supply rebuttal data — other dimensions have no values
    const p = computeSkillProfile([point({ rebuttalCoverage: 0.5 })]);
    const noData = p.dimensions.filter((d) => d.score === null);
    expect(noData.length).toBeGreaterThan(0); // most dims have no data
    expect(p.overallScore).not.toBeNull(); // but overall still computed from available
  });
});
