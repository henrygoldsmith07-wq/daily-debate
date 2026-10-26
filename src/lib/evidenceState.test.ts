import { describe, expect, it } from "vitest";
import { gateBinomial, wilsonInterval, SAMPLE_GATES } from "./evidenceState";

describe("evidenceState corrupt counts", () => {
  it("clamps successes above total instead of returning NaN bounds", () => {
    const [lo, hi] = wilsonInterval(80, 50);
    expect(Number.isNaN(lo)).toBe(false);
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeGreaterThan(0.9);
  });
  it("never reports an estimate above 100% or below 0%", () => {
    const over = gateBinomial(120, 60, SAMPLE_GATES.judgeVsConsensus);
    expect(over.estimate).toBe(100);
    const neg = gateBinomial(-5, 60, SAMPLE_GATES.judgeVsConsensus);
    expect(neg.estimate).toBe(0);
    expect(neg.ciLower).toBe(0);
  });
  it("treats NaN counts as no evidence", () => {
    const m = gateBinomial(Number.NaN, Number.NaN, SAMPLE_GATES.judgeVsConsensus);
    expect(m.state).toBe("insufficient");
    expect(m.estimate).toBeNull();
    expect(m.n).toBe(0);
    expect(wilsonInterval(3, Number.NaN)).toEqual([0, 1]);
  });
  it("leaves valid counts unchanged", () => {
    const m = gateBinomial(40, 50, SAMPLE_GATES.judgeVsConsensus);
    expect(m.estimate).toBe(80);
    expect(m.state).toBe("reportable");
  });
});
