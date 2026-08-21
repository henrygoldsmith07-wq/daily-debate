import { describe, it, expect } from "vitest";
import { evaluateFallacyDetection, ALL_FALLACY_LABELS, FALLACY_BENCHMARK_CASES } from "./fallacyBenchmark";
import type { FallacyCase } from "./fallacyBenchmark";

// The labelled set lives in fallacyBenchmark.ts so the benchmark page and the
// CI suite score the exact same cases. Expected labels are derived from the
// classifier's own documented rules, so the numbers below are checkable, not
// asserted into existence. One case (clean-3) is an honest known false
// positive: a genuine "what about X?" request for evidence is not a dodge, but
// the rule flags it.
const CASES: FallacyCase[] = FALLACY_BENCHMARK_CASES;

describe("evaluateFallacyDetection over the labelled set", () => {
  it("scores 13/14 exact matches with the documented false positive", () => {
    const report = evaluateFallacyDetection(CASES);
    expect(report.cases).toBe(14);
    expect(report.accuracy).toBeCloseTo(13 / 14, 5);
    // Only the genuine "what about my evidence?" request is a false positive.
    expect(report.falsePositiveRate).toBeCloseTo(1 / 3, 5);
  });

  it("reports per-label precision/recall/F1", () => {
    const report = evaluateFallacyDetection(CASES);
    const byLabel = new Map(report.perLabel.map((m) => [m.label, m]));
    const whataboutism = byLabel.get("whataboutism")!;
    // Present in 2 labelled cases, predicted once on clean text.
    expect(whataboutism.tp).toBe(2);
    expect(whataboutism.fp).toBe(1);
    expect(whataboutism.fn).toBe(0);
    expect(whataboutism.precision).toBeCloseTo(2 / 3, 5);
    expect(whataboutism.recall).toBe(1);
    expect(whataboutism.f1).toBeCloseTo(0.8, 5);
    // Strawman is clean: perfect on both axes.
    const strawman = byLabel.get("strawman")!;
    expect(strawman.f1).toBe(1);
    // Labels absent from the set score zero but are still reported.
    expect(byLabel.size).toBe(ALL_FALLACY_LABELS.length);
  });

  it("macro-F1 reflects the weak spot", () => {
    const report = evaluateFallacyDetection(CASES);
    // All 10 labels appear in the set: 9 clean at F1 1.0 plus whataboutism
    // at 0.8 (the documented false positive on clean-3).
    expect(report.macroF1).toBeCloseTo(9.8 / 10, 5);
  });
});

describe("metric maths with custom predictors", () => {
  it("a perfect predictor scores 1.0 everywhere", () => {
    const perfect: (t: string) => string[] = (t) => CASES.find((c) => c.text === t)!.expected;
    const report = evaluateFallacyDetection(CASES, perfect);
    expect(report.accuracy).toBe(1);
    expect(report.macroF1).toBe(1);
    expect(report.falsePositiveRate).toBe(0);
    expect(report.perLabel.every((m) => m.fp === 0 && m.fn === 0)).toBe(true);
  });

  it("a silent predictor gets recall 0 and F1 0", () => {
    const report = evaluateFallacyDetection(CASES, () => []);
    expect(report.accuracy).toBeCloseTo(3 / 14, 5); // only clean cases match
    expect(report.macroF1).toBe(0);
    const strawman = report.perLabel.find((m) => m.label === "strawman")!;
    expect(strawman.fn).toBe(2);
    expect(strawman.precision).toBe(0);
  });

  it("an empty set is reported without division errors", () => {
    const report = evaluateFallacyDetection([], () => []);
    expect(report.cases).toBe(0);
    expect(report.macroF1).toBe(0);
    expect(report.accuracy).toBe(0);
  });
});
