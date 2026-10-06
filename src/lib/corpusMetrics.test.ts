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
      // i3: completed 1-1-1 split → unresolved and ready for moderator review
      rating("i3", "r1", "a"), rating("i3", "r2", "b"), rating("i3", "r3", "tie"),
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
    // 30 unanimous two-rater items → κ = 1, but the Stage-1 volume is not
    // reached and only 2 distinct raters contributed.
    const small = Array.from({ length: 30 }, (_, i) => item(`i${i}`));
    const smallRatings = small.flatMap((it) => [rating(it.id, "r1", "a"), rating(it.id, "r2", "a")]);
    const m1 = computeCorpusMetrics(small, smallRatings);
    expect(m1.humanValidation.consensusReadyItems).toBe(30);
    expect(m1.humanValidation.groundTruth.ready).toBe(false);
    expect(m1.humanValidation.groundTruth.reasons.join(" ")).toMatch(/independent raters/);

    // Stage-1 volume spread over 6 adjacent-pair raters: consensus ≥100,
    // raters ≥5, unanimous pairs → κ clears the pilot gate too.
    const sixRaters = Array.from({ length: 100 }, (_, i) => item(`j${i}`));
    const sixRatings = sixRaters.flatMap((it, idx) => {
      const ra = `r${idx % 6}`;
      const rb = `r${(idx + 1) % 6}`;
      return [rating(it.id, ra, "a"), rating(it.id, rb, "a")];
    });
    const m2 = computeCorpusMetrics(sixRaters, sixRatings);
    expect(m2.humanValidation.consensusReadyItems).toBeGreaterThanOrEqual(100);
    expect(m2.humanValidation.groundTruth.ready).toBe(true);

    // 30 consensus items remain below the staged pilot volume even before the
    // distinct-rater gate is considered.
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

describe("corpus lifecycle facts", () => {
  it("counts adjudicated items, corrected ratings and presentation balance", () => {
    const items: MetricItem[] = [
      { id: "i1", side_mapping: {}, status: "rated" },
      { id: "i2", side_mapping: { consensus_winner: "a", basis: "moderator override" }, status: "adjudicated" },
      { id: "i3", side_mapping: {}, status: "open" },
    ];
    const r = (corpus_id: string, rater_id: string, extra: Partial<MetricRating>): MetricRating => ({
      corpus_id, rater_id, winner: "a", confidence: null, scores_a: {}, scores_b: {}, ...extra,
    });
    const ratings: MetricRating[] = [
      r("i1", "x1", { presented_first: "a" }),
      r("i1", "x2", { presented_first: "a", corrections: [{ at: "t", actor: "adm", reason: "x", before: {}, after: {} }] }),
      r("i2", "x3", { presented_first: "a" }),
      r("i2", "x4", { presented_first: "b", corrections: [] }),
      r("i2", "x6", { presented_first: "b" }),
      r("i3", "x5", {}), // pre-migration row without presented_first
    ];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.corpus.adjudicatedItems).toBe(1);
    expect(m.corpus.correctedRatings).toBe(1); // empty corrections does not count
    expect(m.corpus.presentation).toEqual({ firstA: 3, firstB: 2, unknown: 1, balance: 0.667 });
  });

  it("stays backward compatible when callers omit the new fields", () => {
    const items = [item("i1"), item("i2")];
    const ratings = [rating("i1", "r1", "a"), rating("i1", "r2", "b"), rating("i2", "r3", "a")];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.corpus.adjudicatedItems).toBe(0);
    expect(m.corpus.correctedRatings).toBe(0);
    expect(m.corpus.presentation.balance).toBeNull();
    expect(m.corpus.presentation.unknown).toBe(3);
  });

  it("perfect presentation balance is 1", () => {
    const items = [item("i1")];
    const ratings: MetricRating[] = [
      { ...rating("i1", "r1", "a"), presented_first: "a" },
      { ...rating("i1", "r2", "b"), presented_first: "b" },
    ];
    expect(computeCorpusMetrics(items, ratings).corpus.presentation.balance).toBe(1);
  });
});

describe("judge-vs-human slices (item 13)", () => {
  const judged = (
    id: string,
    strata: Partial<MetricItem>,
    svWinner: "a" | "b" | "tie",
  ): MetricItem => ({ id, side_mapping: { system_verdict: { winner: svWinner } }, status: "rated", ...strata });

  it("slices agreement by difficulty/ability/length/subject and categorises errors", () => {
    const items: MetricItem[] = [
      judged("d1", { dynamics_tier: "close", ability_band: "novice", length_bucket: "short", subject_category: "health" }, "a"),
      judged("d2", { dynamics_tier: "close", ability_band: "novice", length_bucket: "short", subject_category: "health" }, "b"),
      judged("d3", { dynamics_tier: "decisive", ability_band: "advanced", length_bucket: "long", subject_category: "tech" }, "tie"),
    ];
    const ratings: MetricRating[] = [
      ...[
        ["d1", "a"],
        ["d2", "a"],
        ["d3", "a"],
      ].flatMap(([id, w]) => [
        { corpus_id: id, rater_id: "x1", winner: w, confidence: null, scores_a: {}, scores_b: {} },
        { corpus_id: id, rater_id: "x2", winner: w, confidence: null, scores_a: {}, scores_b: {} },
      ]),
    ];
    const m = computeCorpusMetrics(items, ratings);
    // d1 agree (a==a), d2 flip (b vs human a), d3 judge tie vs human winner.
    expect(m.judgeVsHuman.slices.byDifficulty.close).toEqual({ n: 2, agree: 1, rate: 0.5 });
    expect(m.judgeVsHuman.slices.byDifficulty.decisive).toEqual({ n: 1, agree: 0, rate: 0 });
    expect(m.judgeVsHuman.slices.bySubject.health.rate).toBe(0.5);
    expect(m.judgeVsHuman.slices.byLength.long.n).toBe(1);
    expect(m.judgeVsHuman.slices.byAbility.novice).toEqual({ n: 2, agree: 1, rate: 0.5 });
    expect(m.judgeVsHuman.errorCategories).toEqual({ judgeTieVsHumanWinner: 1, sideFlip: 1 });
  });

  it("excludes split-consensus items from slices (only strict majorities count)", () => {
    const items: MetricItem[] = [judged("s1", { dynamics_tier: "close" }, "a")];
    const ratings: MetricRating[] = [
      { corpus_id: "s1", rater_id: "x1", winner: "a", confidence: null, scores_a: {}, scores_b: {} },
      { corpus_id: "s1", rater_id: "x2", winner: "b", confidence: null, scores_a: {}, scores_b: {} },
    ];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.judgeVsHuman.slices.byDifficulty.close).toBeUndefined();
    expect(m.judgeVsHuman.errorCategories.judgeTieVsHumanWinner + m.judgeVsHuman.errorCategories.sideFlip).toBe(0);
  });

  it("uses an explicit adjudicated winner instead of recomputing the rater majority", () => {
    const items: MetricItem[] = [
      {
        id: "adj-1",
        status: "adjudicated",
        side_mapping: {
          consensus_winner: "b",
          basis: "moderator override",
          system_verdict: { winner: "b", confidence: 0.8 },
        },
        dynamics_tier: "close",
      },
    ];
    const ratings: MetricRating[] = [
      rating("adj-1", "r1", "a"),
      rating("adj-1", "r2", "a"),
      rating("adj-1", "r3", "b"),
    ];
    const m = computeCorpusMetrics(items, ratings);
    expect(m.corpus.adjudicatedItems).toBe(1);
    expect(m.judgeVsConsensus.n).toBe(1);
    expect(m.judgeVsConsensus.agree).toBe(1);
    expect(m.judgeVsHuman.slices.byDifficulty.close).toEqual({ n: 1, agree: 1, rate: 1 });
  });

  it("includes three-rater items in pairwise winner kappa", () => {
    const items = Array.from({ length: 6 }, (_, i) => item(`kappa-${i}`));
    const ratings = items.flatMap((it) => [
      rating(it.id, "r1", "a"),
      rating(it.id, "r2", "a"),
      rating(it.id, "r3", "a"),
    ]);
    const m = computeCorpusMetrics(items, ratings);
    expect(m.humanValidation.meanWinnerKappa).toBe(1);
  });
});

describe("humanGroundTruthReady thresholds", () => {
  it("flags each unmet bar explicitly (never a silent false)", async () => {
    const { humanGroundTruthReady } = await import("./corpus");
    const ready = humanGroundTruthReady({ consensusReadyItems: 100, raters: 5, meanWinnerKappa: 0.62 });
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
