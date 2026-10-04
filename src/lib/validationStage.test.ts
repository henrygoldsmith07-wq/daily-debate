import { describe, expect, it } from "vitest";
import { buildValidationStages } from "./validationStage";

function counts(spec: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(spec));
}

describe("buildValidationStages", () => {
  it("reports zero progress with no rows", () => {
    const stages = buildValidationStages({ ratingCounts: new Map() });
    expect(stages).toHaveLength(3);
    for (const stage of stages) {
      expect(stage.debatesQualifying).toBe(0);
      expect(stage.achieved).toBe(false);
      expect(stage.missing).toMatch(/more debate/);
    }
  });

  it("counts only debates meeting the per-stage rating bar", () => {
    const stages = buildValidationStages({
      ratingCounts: counts({ a: 1, b: 2, c: 3, d: 3 }),
    });
    // Stage 1 (≥2 ratings): b, c, d
    expect(stages[0].debatesQualifying).toBe(3);
    // Stage 2/3 (≥3 ratings): c, d
    expect(stages[1].debatesQualifying).toBe(2);
    expect(stages[1].ratingsOnQualifying).toBe(6);
  });

  it("excludes synthetic items from the genuine-debate count", () => {
    const stages = buildValidationStages({
      ratingCounts: counts({ real1: 3, real2: 3, synth: 3 }),
      syntheticIds: new Set(["synth"]),
    });
    expect(stages[1].debatesQualifying).toBe(2);
  });

  it("claims nothing about strata balance when metadata is missing", () => {
    const stages = buildValidationStages({ ratingCounts: counts({ a: 3 }) });
    const stage3 = stages[2];
    expect(stage3.balancedStrata?.state).toBe("not-computable");
    expect(stage3.achieved).toBe(false);
    expect(stage3.missing).toMatch(/not be computed/);
  });

  it("marks stage 3 unachieved while strata cells are under the minimum", () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`item-${i}`, 3]));
    const stages = buildValidationStages({
      ratingCounts: counts(many),
      strata: { short: 10, long: 2 },
      strataMinimum: 5,
    });
    expect(stages[2].balancedStrata?.state).toBe("not-met");
    expect(stages[2].achieved).toBe(false);
  });

  it("never fabricates numbers: every count traces to input rows", () => {
    const input = counts({ a: 2, b: 2, c: 5 });
    const stages = buildValidationStages({ ratingCounts: input });
    const totalRatings = [...input.values()].reduce((s, v) => s + v, 0);
    expect(stages[0].ratingsOnQualifying).toBe(totalRatings);
  });
});
