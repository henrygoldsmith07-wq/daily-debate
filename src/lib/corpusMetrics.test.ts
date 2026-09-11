import { describe, it, expect } from "vitest";
import { computeCorpusMetrics } from "./corpusMetrics";
import type { MetricItem, MetricRating } from "./corpusMetrics";

function rating(corpusId: string, raterId: string, winner: string): MetricRating {
  const uniform = { evidenceQuality: 3.5, reasoning: 3.5, relevance: 3.5, rebuttalQuality: 3.5, logicalValidity: 3.5, sourceQuality: 3.5 };
  return { corpus_id: corpusId, rater_id: raterId, winner, confidence: null, scores_a: uniform, scores_b: uniform };
}

function item(id: string, sv?: Record<string, unknown>): MetricItem {
  return { id, side_mapping: sv ? { system_verdict: sv } : {} };
}

describe("computeCorpusMetrics with sample gates", () => {
  it("returns insufficient state for tiny samples", () => {
    const items = [item("i1", { winner: "a", confidence: 0.9 })];
    const ratings = [rating("i1", "r1", "a"), rating("i1", "r2", "a")];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.judgeVsConsensus.state).toBe("insufficient");
    expect(m.judgeVsConsensus.estimate).toBeNull();
    expect(m.judgeVsConsensus.n).toBe(1);
  });

  it("returns early state above minimum but below reportable", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item(`i${i}`, { winner: "a", confidence: 0.8 })
    );
    const ratings = items.flatMap((it) => [rating(it.id, "r1", "a"), rating(it.id, "r2", "a")]);
    const m = computeCorpusMetrics(items, ratings);
    expect(m.judgeVsConsensus.state).toBe("early");
    expect(m.judgeVsConsensus.estimate).not.toBeNull();
  });

  it("computes consensus agreement over multi-rated items only", () => {
    const items = [item("i1"), item("i2"), item("i3")];
    const ratings = [
      rating("i1", "r1", "a"), rating("i1", "r2", "a"),
      rating("i2", "r1", "a"), rating("i2", "r2", "b"),
      rating("i3", "r1", "a"),
    ];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.corpus.itemsWithTwoPlusRatings).toBe(2);
    expect(m.humanConsensusUnanimous.n).toBe(2);
  });

  it("tracks citation flags across judged debates", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      item(`c${i}`, { winner: "a", confidence: 0.8, citationFlags: { cited: 5, flagged: i % 3 === 0 ? 1 : 0 } })
    );
    const ratings = items.flatMap((it) => [rating(it.id, "r1", "a"), rating(it.id, "r2", "a")]);
    const m = computeCorpusMetrics(items, ratings);
    expect(m.citationFlagRate.n).toBeGreaterThan(0);
    if (m.citationFlagRate.state !== "insufficient") {
      expect(m.citationFlagRate.estimate).not.toBeNull();
    }
  });

  it("handles empty corpus without crashing", () => {
    const m = computeCorpusMetrics([], []);
    expect(m.corpus.items).toBe(0);
    expect(m.judgeVsConsensus.state).toBe("insufficient");
    expect(m.calibrationError).toBeNull();
    expect(m.humanValidation.consensusReadyItems).toBe(0);
    expect(m.humanValidation.groundTruth.ready).toBe(false);
  });

  it("splits items into consensus-ready vs unresolved disagreements", () => {
    const items = [item("i1"), item("i2"), item("i3"), item("i4")];
    const ratings = [
      // i1: unanimous a → consensus
      rating("i1", "r1", "a"), rating("i1", "r2", "a"), rating("i1", "r3", "a"),
      // i2: 2-1 majority a → consensus (strict majority, decisive)
      rating("i2", "r1", "a"), rating("i2", "r2", "a"), rating("i2", "r3", "b"),
      // i3: 1-1 split → unresolved
      rating("i3", "r1", "a"), rating("i3", "r2", "b"),
      // i4: single rater → not counted at all
      rating("i4", "r1", "a"),
    ];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.humanValidation.consensusReadyItems).toBe(2);
    expect(m.humanValidation.unresolvedDisagreements).toBe(1);
  });

  it("measures rater disagreement as score-gap dispersion", () => {
    const gap = (a: number, b: number) => ({
      scores_a: { evidenceQuality: a, reasoning: a, relevance: a, rebuttalQuality: a, logicalValidity: a, sourceQuality: a },
      scores_b: { evidenceQuality: b, reasoning: b, relevance: b, rebuttalQuality: b, logicalValidity: b, sourceQuality: b },
    });
    const items = [item("i1"), item("i2")];
    const ratings: MetricRating[] = [
      // i1: raters agree the gap is +2 → dispersion 0
      { corpus_id: "i1", rater_id: "r1", winner: "a", confidence: 0.9, ...gap(5, 3) },
      { corpus_id: "i1", rater_id: "r2", winner: "a", confidence: 0.7, ...gap(4, 2) },
      // i2: raters disagree wildly (gap +3 vs -3) → large dispersion
      { corpus_id: "i2", rater_id: "r1", winner: "a", confidence: 0.8, ...gap(5, 2) },
      { corpus_id: "i2", rater_id: "r2", winner: "b", confidence: 0.6, ...gap(2, 5) },
    ];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.humanValidation.meanScoreGapDispersion).not.toBeNull();
    expect(m.humanValidation.meanScoreGapDispersion!).toBeGreaterThan(0);
    // mean confidence (0.9+0.7+0.8+0.6)/4 = 0.75
    expect(m.humanValidation.meanRaterConfidence).toBeCloseTo(0.75, 2);
  });

  it("withholds ground-truth eligibility until rater count, consensus volume and κ clear the bars", () => {
    // 30 unanimous two-rater items → κ = 1, consensus-ready = 30, but only
    // 2 distinct raters → the rater-count bar keeps it NOT ready.
    const small = Array.from({ length: 30 }, (_, i) => item(`i${i}`));
    const smallRatings = small.flatMap((it) => [rating(it.id, "r1", "a"), rating(it.id, "r2", "a")]);
    const m1 = computeCorpusMetrics(small, smallRatings);
    expect(m1.humanValidation.consensusReadyItems).toBe(30);
    expect(m1.humanValidation.groundTruth.ready).toBe(false);
    expect(m1.humanValidation.groundTruth.reasons.join(" ")).toMatch(/independent raters/);

    // Same volume spread over 6 adjacent-pair raters: consensus ≥30, raters
    // ≥5, unanimous pairs → κ clears the bar too. This one IS ready.
    const sixRaters = Array.from({ length: 30 }, (_, i) => item(`j${i}`));
    const sixRatings = sixRaters.flatMap((it, idx) => {
      const ra = `r${idx % 6}`;
      const rb = `r${(idx + 1) % 6}`;
      return [rating(it.id, ra, "a"), rating(it.id, rb, "a")];
    });
    const m2 = computeCorpusMetrics(sixRaters, sixRatings);
    expect(m2.humanValidation.consensusReadyItems).toBeGreaterThanOrEqual(30);
    expect(m2.humanValidation.groundTruth.ready).toBe(true);

    // 30 consensus items, 5 raters, pairs with ≥5 shared unanimous items → κ=1.
    const many = Array.from({ length: 30 }, (_, i) => item(`k${i}`));
    const manyRatings = many.flatMap((it, idx) => [
      rating(it.id, `pairA`, "a"),
      rating(it.id, `pairB`, idx % 9 === 0 ? "b" : "a"), // one disagreement keeps κ high but < 1
    ]);
    const m3 = computeCorpusMetrics(many, manyRatings);
    // raters: pairA, pairB = only 2 → still gated on rater count.
    expect(m3.humanValidation.groundTruth.ready).toBe(false);
    expect(m3.humanValidation.groundTruth.reasons.join(" ")).toMatch(/raters/);
  });
});

describe("humanGroundTruthReady thresholds", () => {
  it("flags each unmet bar explicitly (never a silent false)", async () => {
    const { humanGroundTruthReady } = await import("./corpus");
    const ready = humanGroundTruthReady({ consensusReadyItems: 30, raters: 5, meanWinnerKappa: 0.62 });
    expect(ready.ready).toBe(true);
    expect(ready.reasons).toEqual([]);
    const notReady = humanGroundTruthReady({ consensusReadyItems: 5, raters: 2, meanWinnerKappa: null });
    expect(notReady.ready).toBe(false);
    expect(notReady.reasons.length).toBe(3);
  });
});

describe("presentation assignment determinism", () => {
  it("is stable per (rater,item) and balanced even for adversarial id patterns", async () => {
    const { assignPresentationSide } = await import("./corpus");
    expect(assignPresentationSide("r1", "i1")).toBe(assignPresentationSide("r1", "i1"));
    // user-i / item-i identical patterns once returned 'b' 500/500; the
    // avalanche finalizer must keep this near even.
    let bFirst = 0;
    for (let i = 0; i < 500; i++) if (assignPresentationSide(`user-${i}`, `item-${i}`) === "b") bFirst++;
    expect(bFirst).toBeGreaterThan(125);
    expect(bFirst).toBeLessThan(375);
  });
});
