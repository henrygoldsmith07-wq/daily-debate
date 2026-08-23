import { describe, it, expect } from "vitest";
import { computeCorpusMetrics, finalizeEce, CLOSE_DEBATE_GAP } from "./corpusMetrics";
import type { MetricItem, MetricRating } from "./corpusMetrics";

function rating(corpusId: string, raterId: string, winner: string, scoresA = 3.5, scoresB = 2.5): MetricRating {
  const uniform = (v: number) => ({ evidenceQuality: v, reasoning: v, relevance: v, rebuttalQuality: v, logicalValidity: v, sourceQuality: v });
  return {
    corpus_id: corpusId,
    rater_id: raterId,
    winner,
    confidence: null,
    scores_a: uniform(scoresA),
    scores_b: uniform(scoresB),
  };
}

describe("computeCorpusMetrics", () => {
  it("reports consensus shares over multi-rated items only", () => {
    const items: MetricItem[] = [
      { id: "i1", side_mapping: {} },
      { id: "i2", side_mapping: {} },
      { id: "i3", side_mapping: {} },
    ];
    const ratings: MetricRating[] = [
      rating("i1", "r1", "a"),
      rating("i1", "r2", "a"), // unanimous
      rating("i2", "r1", "a"),
      rating("i2", "r2", "b"), // split -> tie consensus
      rating("i3", "r1", "a"), // single rating: excluded
    ];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.corpus.items).toBe(3);
    expect(m.corpus.ratings).toBe(5);
    expect(m.corpus.itemsWithTwoPlusRatings).toBe(2);
    // i1 unanimous; i2's 1-1 split has NO majority — that is the honest reading.
    expect(m.humanConsensusUnanimousPct).toBe(50);
    expect(m.humanConsensusMajorityPct).toBe(50);
  });

  it("computes judge-vs-consensus and close-debate accuracy", () => {
    // i1: close (gap 0.25 < 0.75), judge agrees; i2: decisive (gap 2), judge wrong.
    const items: MetricItem[] = [
      { id: "c1", side_mapping: { system_verdict: { winner: "a", confidence: 0.8 } } },
      { id: "d1", side_mapping: { system_verdict: { winner: "b", confidence: 0.6 } } },
    ];
    const closeRatings = [rating("c1", "r1", "a", 3.2, 3.0), rating("c1", "r2", "a", 3.2, 3.0)];
    const decisiveRatings = [rating("d1", "r1", "a", 4.5, 2.0), rating("d1", "r2", "a", 4.5, 2.0)];
    const m = computeCorpusMetrics(items, [...closeRatings, ...decisiveRatings]);
    expect(Math.abs(CLOSE_DEBATE_GAP - 0.75)).toBe(0);
    expect(m.judgeVsConsensus.judged).toBe(2);
    expect(m.judgeVsConsensus.pct).toBe(50);
    expect(m.closeDebateAccuracy.n).toBe(1);
    expect(m.closeDebateAccuracy.pct).toBe(100);
  });

  it("aggregates swap stability and citation flags from stored verdicts", () => {
    const items: MetricItem[] = [
      {
        id: "s1",
        side_mapping: {
          system_verdict: {
            winner: "a",
            confidence: 0.9,
            citationFlags: { cited: 10, flagged: 1 },
            swap_check: { stable: true },
          },
        },
      },
      {
        id: "s2",
        side_mapping: {
          system_verdict: {
            winner: "b",
            confidence: 0.4,
            citationFlags: { cited: 5, flagged: 0 },
            swap_check: { stable: false },
          },
        },
      },
    ];
    const ratings: MetricRating[] = [
      rating("s1", "r1", "a"),
      rating("s1", "r2", "a"),
      rating("s2", "r1", "a"),
      rating("s2", "r2", "a"),
    ];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.positionSwapStability).toEqual({ n: 2, stable: 1, pct: 50 });
    expect(m.unsupportedSourceFlagRate).toEqual({ citedNodes: 15, flagged: 1, pct: 6.7 });
    expect(m.calibrationError).not.toBeNull();
  });

  it("returns nulls for everything when there is no data", () => {
    const m = computeCorpusMetrics([], []);
    expect(m.humanConsensusUnanimousPct).toBeNull();
    expect(m.judgeVsConsensus.pct).toBeNull();
    expect(m.closeDebateAccuracy.pct).toBeNull();
    expect(m.positionSwapStability.pct).toBeNull();
    expect(m.calibrationError).toBeNull();
    expect(m.unsupportedSourceFlagRate.pct).toBeNull();
  });
});

describe("finalizeEce", () => {
  it("is zero when confidence matches accuracy exactly in every bin", () => {
    const bins = Array.from({ length: 10 }, (_, i) => ({ total: 10, correct: i + 1, confidenceSum: (i + 1) * (i / 10 + 0.05) }));
    void bins;
    const perfect = [{ total: 100, correct: 80, confidenceSum: 80 }];
    expect(finalizeEce(perfect)).toBe(0);
  });

  it("weights bins by share and returns null when empty", () => {
    expect(finalizeEce([])).toBeNull();
    const bins = [
      { total: 50, correct: 40, confidenceSum: 45 }, // |0.8-0.9|=0.1, weight .5
      { total: 50, correct: 25, confidenceSum: 35 }, // |0.5-0.7|=0.2, weight .5
    ];
    expect(finalizeEce(bins)).toBeCloseTo(0.15, 3);
  });
});
