import { describe, it, expect } from "vitest";
import {
  isCorpusAdmin,
  lengthBucketFor,
  abilityBandFor,
  anonymiseTranscript,
  validateRating,
  completeScores,
  oppositeStance,
  aggregateSystemComparison,
  populationProgress,
  POPULATION_TARGET_ITEMS,
} from "./corpus";

describe("corpus admin gating", () => {
  it("matches case-insensitively and trims the allowlist", () => {
    const list = " Admin@Example.com , second@x.io ";
    expect(isCorpusAdmin("admin@example.com", list)).toBe(true);
    expect(isCorpusAdmin("second@x.io", list)).toBe(true);
    expect(isCorpusAdmin("other@x.io", list)).toBe(false);
  });

  it("is closed when unset", () => {
    expect(isCorpusAdmin("admin@example.com", undefined)).toBe(false);
    expect(isCorpusAdmin(null, "a@b.c")).toBe(false);
  });
});

describe("stratification", () => {
  it("buckets length by word count", () => {
    expect(lengthBucketFor("one two three")).toBe("short");
    expect(lengthBucketFor(new Array(200).fill("word").join(" "))).toBe("medium");
    expect(lengthBucketFor(new Array(400).fill("word").join(" "))).toBe("long");
  });

  it("bands ability by profile level", () => {
    expect(abilityBandFor(1)).toBe("novice");
    expect(abilityBandFor(null)).toBe("novice");
    expect(abilityBandFor(5)).toBe("intermediate");
    expect(abilityBandFor(12)).toBe("advanced");
  });
});

describe("blind anonymisation", () => {
  it("strips player/AI identity into neutral Side A/B labels", () => {
    const out = anonymiseTranscript([
      { side: "a", round: 1, text: "Solar is cheapest per Lazard." },
      { side: "b", round: 1, text: "Intermittency costs." },
      { side: "a", round: 2, text: "NREL data says otherwise." },
      { side: "b", round: 2, text: "Storage costs fall." },
    ]);
    expect(out).not.toMatch(/ai|user|opponent/i);
    expect(out).toContain("Side A (round 1): Solar is cheapest per Lazard.");
    expect(out).toContain("Side B (round 2): Storage costs fall.");
  });
});

describe("rating validation", () => {
  const good = {
    scores_a: { evidenceQuality: 4, reasoning: 3, relevance: 5, rebuttalQuality: 2, logicalValidity: 4, sourceQuality: 5 },
    scores_b: { evidenceQuality: 2 },
    winner: "a",
    confidence: 0.8,
    rationale: "A grounded its claims.",
  };

  it("accepts a well-formed verdict (partial dimension sets allowed)", () => {
    expect(validateRating(good)).toEqual([]);
  });

  it("rejects malformed payloads", () => {
    expect(validateRating({ ...good, winner: "side-a" })).toContain("winner must be a|b|tie");
    expect(validateRating({ ...good, scores_a: { evidenceQuality: 11 } })).toHaveLength(1);
    expect(validateRating({ ...good, confidence: 2 })).toContain("confidence must be between 0 and 1");
    expect(validateRating({ ...good, rationale: "x".repeat(1001) })).toHaveLength(1);
    expect(validateRating(null)).toEqual(["body must be an object"]);
  });
});

describe("completeScores", () => {
  it("fills missing dimensions with the fallback", () => {
    const filled = completeScores({ reasoning: 4 });
    for (const dim of Object.keys(filled)) {
      expect(dim === "reasoning" ? filled[dim as keyof typeof filled] : filled[dim as keyof typeof filled]).toBeDefined();
    }
    expect(filled.reasoning).toBe(4);
  });
});

describe("system-vs-human comparison", () => {
  it("flips stances correctly", () => {
    expect(oppositeStance("for")).toBe("against");
    expect(oppositeStance("against")).toBe("for");
  });

  it("aggregates agreement honestly, including disagreements", () => {
    const pairs = [
      { judgeWinner: "a" as const, consensusWinner: "a" as const },
      { judgeWinner: "b" as const, consensusWinner: "b" as const },
      { judgeWinner: "a" as const, consensusWinner: "b" as const },
      { judgeWinner: "tie" as const, consensusWinner: "tie" as const },
    ];
    expect(aggregateSystemComparison(pairs)).toEqual({ judged: 4, agree: 3, disagreement: 1, agreementRate: 0.75 });
  });

  it("reports null rate when nothing was judged", () => {
    expect(aggregateSystemComparison([])).toEqual({ judged: 0, agree: 0, disagreement: 0, agreementRate: null });
  });
});

describe("population progress", () => {
  const item = (id: string, length: string, ability: string, subject: string | null) => ({
    id,
    length_bucket: length,
    ability_band: ability,
    subject_category: subject,
  });

  it("counts fully-rated items against the >=2-raters requirement", () => {
    const items = [item("a", "short", "novice", "Tech"), item("b", "long", "advanced", "Ethics")];
    const counts = new Map([
      ["a", 2],
      ["b", 1],
    ]);
    const p = populationProgress(items, counts);
    expect(p.totalItems).toBe(2);
    expect(p.fullyRatedItems).toBe(1);
    expect(p.remainingToTarget).toBe(POPULATION_TARGET_ITEMS - 2);
  });

  it("flags stratum cells below the minimum so recruitment has targets", () => {
    const items = Array.from({ length: 40 }, (_, i) => item(`s${i}`, "short", "novice", "Tech"));
    items.push(item("lonely", "long", "advanced", null));
    const p = populationProgress(items, new Map());
    expect(p.byLength).toEqual({ short: 40, long: 1 });
    expect(p.cellsNeedingCoverage).toContain("length:long");
    expect(p.cellsNeedingCoverage).toContain("ability:intermediate");
    expect(p.cellsNeedingCoverage).toContain("ability:advanced");
    expect(p.cellsNeedingCoverage).not.toContain("length:short");
    // Null subjects land in an explicit "unknown" bucket, never silently dropped.
    expect(p.bySubject.unknown).toBe(1);
  });

  it("handles an empty corpus without throwing — every cell needs coverage", () => {
    const p = populationProgress([], new Map());
    expect(p.totalItems).toBe(0);
    expect(p.fullyRatedItems).toBe(0);
    expect(p.cellsNeedingCoverage).toEqual([
      "length:short",
      "length:medium",
      "length:long",
      "ability:novice",
      "ability:intermediate",
      "ability:advanced",
    ]);
  });
});
