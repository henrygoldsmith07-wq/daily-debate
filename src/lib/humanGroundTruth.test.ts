import { describe, expect, it } from "vitest";
import { hasUsableHumanGroundTruth, resolveHumanGroundTruth } from "./humanGroundTruth";

const ratings = (...winners: string[]) => winners.map((winner, i) => ({ rater_id: `r${i + 1}`, winner }));

describe("resolveHumanGroundTruth", () => {
  it("distinguishes unrated, insufficient and unresolved states", () => {
    expect(resolveHumanGroundTruth({}, []).state).toBe("unrated");
    expect(resolveHumanGroundTruth({}, ratings("a")).state).toBe("insufficient");
    expect(resolveHumanGroundTruth({}, ratings("a", "b")).state).toBe("unresolved");
    expect(resolveHumanGroundTruth({}, ratings("tie", "tie", "a")).state).toBe("unresolved");
  });

  it("accepts strict two- or three-rater consensus", () => {
    expect(resolveHumanGroundTruth({}, ratings("a", "a"))).toMatchObject({ state: "consensus", winner: "a" });
    expect(resolveHumanGroundTruth({}, ratings("b", "b", "a"))).toMatchObject({ state: "consensus", winner: "b" });
  });

  it("uses explicit adjudication instead of recomputing the rating majority", () => {
    const resolved = resolveHumanGroundTruth(
      { status: "adjudicated", side_mapping: { consensus_winner: "b", basis: "moderator override" } },
      ratings("a", "a", "b"),
    );
    expect(resolved).toMatchObject({ state: "adjudicated", winner: "b" });
    expect(hasUsableHumanGroundTruth(resolved)).toBe(true);
  });

  it("does not trust an under-target legacy adjudication", () => {
    const resolved = resolveHumanGroundTruth(
      { status: "adjudicated", side_mapping: { consensus_winner: "b" } },
      ratings("a", "b"),
    );
    expect(resolved).toMatchObject({ state: "stale_adjudication", winner: null, ratings: 2 });
  });

  it("withholds stale adjudication even if the current ratings happen to agree", () => {
    const resolved = resolveHumanGroundTruth(
      { status: "rated", side_mapping: { consensus_winner: "a", adjudication_stale: true } },
      ratings("b", "b", "b"),
    );
    expect(resolved).toMatchObject({ state: "stale_adjudication", winner: null });
    expect(hasUsableHumanGroundTruth(resolved)).toBe(false);
  });
});
