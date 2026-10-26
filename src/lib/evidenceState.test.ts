import { describe, expect, it } from "vitest";
import { gateBinomial, SAMPLE_GATES, wilsonInterval } from "./evidenceState";

describe("gateBinomial", () => {
  const gate = SAMPLE_GATES.judgeVsConsensus;
  it("withholds the estimate below the early threshold", () => {
    const m = gateBinomial(9, 9, gate);
    expect(m).toMatchObject({ estimate: null, ciLower: null, ciUpper: null, n: 9, state: "insufficient" });
  });
  it("marks early and reportable at the exact boundaries", () => {
    expect(gateBinomial(5, 10, gate).state).toBe("early");
    expect(gateBinomial(25, 49, gate).state).toBe("early");
    expect(gateBinomial(25, 50, gate).state).toBe("reportable");
  });
  it("never publishes above 100% or below 0% for out-of-range counts", () => {
    const over = gateBinomial(80, 50, gate);
    expect(over.estimate).toBe(100);
    expect(over.ciUpper).toBeLessThanOrEqual(100);
    const under = gateBinomial(-5, 50, gate);
    expect(under.estimate).toBe(0);
    expect(under.ciLower).toBeGreaterThanOrEqual(0);
  });
  it("treats NaN counts as insufficient evidence", () => {
    expect(gateBinomial(Number.NaN, 60, gate)).toMatchObject({ estimate: null, state: "insufficient" });
    expect(gateBinomial(3, Number.NaN, gate).state).toBe("insufficient");
  });
  it("keeps a nonzero-width interval at the extremes", () => {
    const [lo, hi] = wilsonInterval(50, 50);
    expect(hi).toBe(1);
    expect(lo).toBeLessThan(1);
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });
});
