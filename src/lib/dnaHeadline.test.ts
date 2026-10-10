import { describe, expect, it } from "vitest";
import { buildDnaHeadline } from "./dnaHeadline";
import type { ArgumentDnaModel } from "./argumentDna";

function model(overrides: Partial<ArgumentDnaModel> = {}): ArgumentDnaModel {
  return {
    snapshots: [],
    points: [],
    totalDebates: 4,
    analysedDebates: 4,
    profile: {
      dimensions: [
        { key: "claim-clarity", label: "Engagement", score: 80, lowConfidence: false, sampleSize: 4 },
        { key: "evidence", label: "Evidence", score: 45, lowConfidence: false, sampleSize: 4 },
        { key: "rebuttal", label: "Rebuttal", score: 70, lowConfidence: false, sampleSize: 4 },
      ] as never,
      debatesAnalysed: 4,
      minDebates: 3,
      overallScore: 65,
    },
    periods: [],
    insights: [],
    ledger: { trajectories: {} as never, improvements: ["rebuttalCoverage"], regressions: [], minimumForClaims: 10 },
    comparison: { first: null, latest: null, dimensions: [] },
    structuralRoles: {} as never,
    ...overrides,
  };
}

describe("buildDnaHeadline", () => {
  it("names the strongest behaviour and the current weakness qualitatively", () => {
    const headline = buildDnaHeadline(model(), "Rebuttal");
    expect(headline.strongest?.label).toBe("Engagement");
    expect(headline.strongest?.statement).toMatch(/answering each move your opponent makes/);
    expect(headline.weakness?.label).toBe("Evidence");
    expect(headline.weakness?.statement).toMatch(/grounding major claims/);
    expect(headline.focus).toBe("Rebuttal");
  });

  it("never invents personality claims", () => {
    const headline = buildDnaHeadline(model());
    for (const line of [headline.becoming, headline.strongest?.statement, headline.weakness?.statement]) {
      expect((line ?? "").toLowerCase()).not.toMatch(/genius|expert|master|natural-born|personality|visionary/);
    }
    expect(headline.becoming).toMatch(/strongest at/);
    expect(headline.becoming).toMatch(/still working on/);
  });

  it("reports the sample size and flags limited evidence", () => {
    const small = buildDnaHeadline(model({ analysedDebates: 2, totalDebates: 2 }));
    expect(small.limitedEvidence).toBe(true);
    expect(small.evidenceLine).toMatch(/early read/i);

    const solid = buildDnaHeadline(model());
    expect(solid.limitedEvidence).toBe(false);
    expect(solid.evidenceLine).toMatch(/4 analysed debates/);
  });

  it("names the most improved observable skill only when the ledger says so", () => {
    const improved = buildDnaHeadline(model());
    expect(improved.mostImproved?.label).toBe("rebuttal coverage");

    const none = buildDnaHeadline(model({ ledger: { trajectories: {} as never, improvements: [], regressions: [], minimumForClaims: 10 } }));
    expect(none.mostImproved).toBeNull();
  });

  it("handles an empty history without fabricating a read", () => {
    const empty = buildDnaHeadline(
      model({
        snapshots: [],
        totalDebates: 0,
        analysedDebates: 0,
        profile: { dimensions: [] as never, debatesAnalysed: 0, minDebates: 3, overallScore: null },
        ledger: { trajectories: {} as never, improvements: [], regressions: [], minimumForClaims: 10 },
      }),
    );
    expect(empty.strongest).toBeNull();
    expect(empty.weakness).toBeNull();
    expect(empty.becoming).toMatch(/Complete a few debates/);
    expect(empty.limitedEvidence).toBe(true);
  });
});
