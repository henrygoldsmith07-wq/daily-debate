import { describe, expect, it } from "vitest";
import { coverageCounts, nextItemFor, orderForCoverage, type SampleCandidate } from "./corpusSampling";

function cand(id: string, ratingCount: number, createdAt = "2026-06-01T00:00:00Z", contributorId: string | null = null): SampleCandidate {
  return { id, ratingCount, createdAt, contributorId };
}

const none = { ratedIds: new Set<string>(), raterId: "u1" };

describe("orderForCoverage", () => {
  it("prioritises items with the fewest ratings", () => {
    const ordered = orderForCoverage([cand("a", 3), cand("b", 0), cand("c", 1)], none);
    expect(ordered.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties deterministically by age, then id", () => {
    const ordered = orderForCoverage(
      [cand("z", 1, "2026-06-02T00:00:00Z"), cand("a", 1, "2026-06-01T00:00:00Z"), cand("m", 1, "2026-06-01T00:00:00Z")],
      none,
    );
    expect(ordered.map((c) => c.id)).toEqual(["a", "m", "z"]);
  });

  it("excludes already-rated and self-contributed items", () => {
    const ordered = orderForCoverage(
      [cand("a", 0), cand("b", 0, "2026-06-01T00:00:00Z", "u1"), cand("c", 0)],
      { ratedIds: new Set(["a"]), raterId: "u1" },
    );
    expect(ordered.map((c) => c.id)).toEqual(["c"]);
  });

  it("pushes items toward the 2-rating bar fastest", () => {
    // Coverage logic: an item at 1 rating beats one already at 2.
    const next = nextItemFor([cand("covered", 2), cand("thin", 1)], none);
    expect(next?.id).toBe("thin");
  });

  it("returns null when nothing is eligible", () => {
    expect(nextItemFor([cand("a", 0)], { ratedIds: new Set(["a"]), raterId: "u1" })).toBeNull();
  });
});

describe("coverageCounts", () => {
  it("counts items at each rating depth", () => {
    const counts = coverageCounts([cand("a", 0), cand("b", 1), cand("c", 2), cand("d", 3)]);
    expect(counts[2]).toBe(2);
    expect(counts[3]).toBe(1);
  });
});
