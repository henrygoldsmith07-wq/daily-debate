import { describe, expect, it } from "vitest";
import type { ArgEdge, ArgGraph, ArgNode, Owner } from "./argGraph";
import {
  eligibleOpponentMoves,
  engagementOpportunitiesFor,
  isValidRebuttalResponse,
  isValidRebuttalTarget,
  rebuttalCoverageFor,
  unansweredOpportunitiesBy,
  userAnsweredIds,
} from "./opportunity";

const node = (id: string, kind: ArgNode["kind"], owner: Owner, round: number, targets?: string[]): ArgNode => ({
  id,
  kind,
  owner,
  round,
  text: id,
  ...(targets ? { targets } : {}),
});
const graph = (nodes: ArgNode[], edges: ArgEdge[] = []) => ({ nodes, edges }) as unknown as ArgGraph;

describe("opportunity: canonical rebuttal semantics", () => {
  const nodes = [
    node("o1", "claim", "ai", 1),
    node("o2", "counterclaim", "ai", 2),
    node("o3", "claim", "ai", 3), // last opponent move after the user's final turn: not an opportunity
    node("u1", "rebuttal", "a", 2, ["o1"]),
    node("u2", "claim", "a", 2),
    node("u3", "claim", "a", 3), // user's final turn: o2 (round 2) is answerable, o3 (round 3) is not
  ];

  it("excludes opponent moves with no later user turn from eligibility", () => {
    expect(eligibleOpponentMoves(graph(nodes), "a").map((n) => n.id)).toEqual(["o1", "o2"]);
  });

  it("reports coverage with exact answered/unmatched trails", () => {
    const r = rebuttalCoverageFor(graph(nodes), "a");
    expect(r.opportunities).toBe(2);
    expect(r.value).toBe(0.5);
    expect(r.answeredIds).toEqual(["o1"]);
    expect(r.unmatchedIds).toEqual(["o2"]);
    expect(unansweredOpportunitiesBy(graph(nodes), "a").map((n) => n.id)).toEqual(["o2"]);
  });

  it("returns null (unmeasurable), never 0, when nothing was answerable", () => {
    const r = rebuttalCoverageFor(graph([node("o1", "claim", "ai", 1)]), "a");
    expect(r).toEqual({ value: null, opportunities: 0, eligibleIds: [], answeredIds: [], unmatchedIds: [] });
  });

  it("rejects dangling, self, same-round, future and non-opportunity targets", () => {
    const g = graph([...nodes, node("ev", "evidence", "ai", 1), node("imp", "impact", "ai", 1)]);
    expect(isValidRebuttalTarget(g, "missing", "a", 5)).toBe(false);
    expect(isValidRebuttalTarget(g, "u2", "a", 5)).toBe(false);
    expect(isValidRebuttalTarget(g, "o2", "a", 2)).toBe(false);
    expect(isValidRebuttalTarget(g, "o3", "a", 2)).toBe(false);
    expect(isValidRebuttalTarget(g, "ev", "a", 5)).toBe(false);
    expect(isValidRebuttalTarget(g, "imp", "a", 5)).toBe(false);
    expect(isValidRebuttalTarget(g, "o1", "a", 2)).toBe(true);
  });

  it("scores nothing for malformed edges", () => {
    const g = graph(
      [...nodes, node("uev", "evidence", "a", 3)],
      [
        { from: "uev", to: "o2", relation: "counters" }, // evidence cannot answer
        { from: "u2", to: "o2", relation: "supports" }, // wrong relation
        { from: "o1", to: "o2", relation: "rebuts" }, // not the measured side's node
        { from: "ghost", to: "o2", relation: "rebuts" }, // dangling
      ],
    );
    expect(userAnsweredIds(g, "a")).toEqual(new Set(["o1"]));
    expect(isValidRebuttalResponse(g, "u2", "o2", "rebuts", "a")).toBe(false); // same round
  });

  it("counts a valid rebuts edge from a later user claim", () => {
    const g = graph(nodes, [{ from: "u3", to: "o2", relation: "rebuts" }]);
    expect(rebuttalCoverageFor(g, "a").value).toBe(1);
  });

  it("measures the opponent symmetrically (the user's unanswered move is the opponent's opportunity, not the user's miss)", () => {
    const g = graph([node("u1", "claim", "a", 1), node("o1", "claim", "ai", 2)]);
    expect(eligibleOpponentMoves(g, "a")).toEqual([]);
    expect(eligibleOpponentMoves(g, "ai").map((n) => n.id)).toEqual(["u1"]);
  });

  it("engagement scope adds impact moves that rebuttal coverage excludes", () => {
    const g = graph([node("o1", "impact", "ai", 1), node("u1", "claim", "a", 2)]);
    expect(eligibleOpponentMoves(g, "a")).toEqual([]);
    expect(engagementOpportunitiesFor(g, "a").map((n) => n.id)).toEqual(["o1"]);
  });
});
