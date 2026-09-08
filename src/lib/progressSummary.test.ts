import { describe, expect, it } from "vitest";
import { buildProgressSummary, trendFor } from "./progressSummary";
import type { SkillMetricPoint, MetricKey } from "./skillLedger";

function point(metrics: Partial<Record<MetricKey, number | null>>, i = 0): SkillMetricPoint {
  const full = {
    unsupportedClaimRate: null,
    rebuttalCoverage: null,
    evidenceGrounding: null,
    droppedArguments: null,
    contradictions: null,
    impactHandling: null,
    steelmanQuality: null,
    fallacyRate: null,
    causalOverclaims: null,
    fakePrecisionHits: null,
    uncitedEvidenceRate: null,
    clarity: null,
    ...metrics,
  } as Record<MetricKey, number | null>;
  return { debateId: `d${i}`, completedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), metrics: full };
}

describe("trendFor", () => {
  it("reports no-data without a slope", () => {
    expect(trendFor(null)).toEqual({ trend: "no-data", label: "not enough debates yet" });
  });

  it("classifies improving, slipping and steady slopes", () => {
    expect(trendFor(0.05).trend).toBe("up");
    expect(trendFor(-0.05).trend).toBe("down");
    expect(trendFor(0.001).trend).toBe("flat");
  });
});

describe("buildProgressSummary", () => {
  it("returns empty skills with no data", () => {
    const summary = buildProgressSummary([]);
    expect(summary.skills).toHaveLength(7);
    expect(summary.skills.every((s) => s.score === null)).toBe(true);
    expect(summary.skills.every((s) => s.trend === "no-data")).toBe(true);
    expect(summary.strongest).toBeNull();
    expect(summary.weakest).toBeNull();
  });

  it("identifies strongest and weakest skills", () => {
    const summary = buildProgressSummary([
      point({ clarity: 0.9, impactHandling: 0.3, evidenceGrounding: 0.6 }, 0),
      point({ clarity: 0.9, impactHandling: 0.35, evidenceGrounding: 0.6 }, 1),
      point({ clarity: 0.9, impactHandling: 0.4, evidenceGrounding: 0.6 }, 2),
    ]);
    expect(summary.strongest?.key).toBe("clarity");
    expect(summary.weakest?.key).toBe("impact");
    expect(summary.debatesAnalysed).toBe(3);
  });

  it("derives trend direction from the metric slope", () => {
    const summary = buildProgressSummary([
      point({ evidenceGrounding: 0.2, clarity: 0.9 }, 0),
      point({ evidenceGrounding: 0.5, clarity: 0.9 }, 1),
      point({ evidenceGrounding: 0.8, clarity: 0.9 }, 2),
      point({ evidenceGrounding: 0.85, clarity: 0.9 }, 3),
    ]);
    const evidence = summary.skills.find((s) => s.key === "evidence");
    expect(evidence?.trend).toBe("up");
    const clarity = summary.skills.find((s) => s.key === "clarity");
    expect(clarity?.trend).toBe("flat");
  });

  it("always exposes exactly the seven coached dimensions", () => {
    const summary = buildProgressSummary([point({ clarity: 0.7 })]);
    const keys = summary.skills.map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining(["evidence", "rebuttal", "logic", "clarity", "impact", "steelmanning", "structure"]),
    );
    expect(keys).toHaveLength(7);
  });
});
