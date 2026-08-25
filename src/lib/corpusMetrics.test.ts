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
  });
});
