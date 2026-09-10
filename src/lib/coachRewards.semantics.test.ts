import { describe, expect, it } from "vitest";
import {
  computeCoachRewards,
  type RewardContext,
} from "./coachRewards";
import { fallaciesOwnedBy, unansweredBy, unsupportedOwnedBy } from "./opportunity";
import { nodesOwnedBy, opponentClaimNodes } from "./argGraph";
import { assessArgumentGraph } from "./observableAssessment";
import type { ArgGraph, Owner } from "./argGraph";
import { emptyGraph } from "./argGraph";

/**
 * ADVERSARIAL REWARD SEMANTICS.
 *
 * Every reward must refer only to the human user's own behaviour. Each test
 * below mutates ONLY opponent-owned graph material and asserts the user's
 * reward set is unchanged — or builds owner-swapped pairs where only the
 * side differs. Opponents are exercised as BOTH "ai" (solo) and "b"
 * (PvP-shaped) to prove the two formats share one semantics.
 */

function assess(graph: ArgGraph) {
  return assessArgumentGraph(graph, {
    sideA: "a",
    sideB: "ai",
    extractionSource: "deterministic",
    labelA: "You",
    labelB: "AI opponent",
  });
}

function ctx(graph: ArgGraph, priors: ArgGraph[] = []): RewardContext {
  return {
    assessment: assess(graph),
    priorAssessments: priors.map(assess),
    previouslyDebatedCategories: ["Policy"],
    currentCategory: "Policy",
  };
}

/** A clean solo debate: grounded user claim, answered AI claims, user impact. */
function goodSolo(opponent: Owner = "ai"): ArgGraph {
  return {
    ...emptyGraph(),
    nodes: [
      { id: "c1", kind: "claim", owner: "a", text: "User claim.", round: 1 },
      { id: "e1", kind: "evidence", owner: "a", text: "NREL data.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
      { id: "o1", kind: "claim", owner: opponent, text: "Opponent claim one.", round: 1 },
      { id: "o2", kind: "claim", owner: opponent, text: "Opponent claim two.", round: 2 },
      { id: "r1", kind: "rebuttal", owner: "a", text: "User rebuttal one.", round: 2, targets: ["o1"] },
      { id: "r2", kind: "rebuttal", owner: "a", text: "User rebuttal two.", round: 3, targets: ["o2"] },
      { id: "i1", kind: "impact", owner: "a", text: "User impact.", round: 3 },
    ],
    edges: [{ from: "e1", to: "c1", relation: "supports" }],
  };
}

/** A weak prior: unsupported user claims, a user fallacy, an unanswered AI claim, no impact. */
function badPrior(): ArgGraph {
  return {
    ...emptyGraph(),
    nodes: [
      { id: "p1", kind: "claim", owner: "a", text: "User prior claim one.", round: 1 },
      { id: "p2", kind: "claim", owner: "a", text: "User prior claim two.", round: 2 },
      { id: "q1", kind: "claim", owner: "ai", text: "Prior opponent claim.", round: 1 },
    ],
    dropped: [{ nodeId: "q1", text: "Prior opponent claim.", owner: "ai", round: 1 }],
    fallacies: [{ nodeId: "p1", fallacy: "strawman", note: "x" }],
    evidenceStats: {
      total: 0,
      byOwner: { a: 0, b: 0, ai: 0 },
      byStrength: { anecdotal: 0, general: 0, cited: 0, strong: 0 },
      unsupportedClaimIds: ["p1", "p2"],
    },
  };
}

function kindsOf(graph: ArgGraph, priors: ArgGraph[] = []): string[] {
  return computeCoachRewards(ctx(graph, priors)).map((e) => e.kind).sort();
}

describe("opponent-only mutations are reward-neutral", () => {
  it("opponent fallacies, evidence and grounded claims change nothing", () => {
    const clean = goodSolo("ai");
    const noisy: ArgGraph = {
      ...clean,
      nodes: [
        ...clean.nodes,
        // Opponent fallacy, opponent grounded claim, opponent evidence.
        { id: "of1", kind: "claim", owner: "ai", text: "Opponent fallacy claim.", round: 3 },
        { id: "oe1", kind: "evidence", owner: "ai", text: "Opponent evidence.", round: 3, evidenceStrength: "cited", citations: [{ sourceName: "Reuters", homepage: "https://www.reuters.com" }] },
        { id: "or1", kind: "rebuttal", owner: "a", text: "User answers the fallacy too.", round: 4, targets: ["of1"] },
      ],
      edges: [
        ...clean.edges,
        { from: "oe1", to: "of1", relation: "supports" },
      ],
      fallacies: [{ nodeId: "of1", fallacy: "ad_hominem", note: "x" }],
    };
    expect(kindsOf(noisy, [badPrior()])).toEqual(kindsOf(clean, [badPrior()]));
  });

  it("opponent grounded claims cannot grant the user ground-a-claim", () => {
    const opponentOnly: ArgGraph = {
      ...emptyGraph(),
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "Bare user claim.", round: 1 },
        { id: "o1", kind: "claim", owner: "ai", text: "Grounded opponent claim.", round: 1 },
        { id: "oe1", kind: "evidence", owner: "ai", text: "Opponent evidence.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Reuters", homepage: "https://www.reuters.com" }] },
        { id: "r1", kind: "rebuttal", owner: "a", text: "User answer.", round: 2, targets: ["o1"] },
      ],
      edges: [{ from: "oe1", to: "o1", relation: "supports" }],
    };
    expect(kindsOf(opponentOnly)).not.toContain("ground-a-claim");
  });

  it("AI ignoring user claims does not count against the user", () => {
    const ignored: ArgGraph = {
      ...goodSolo("ai"),
      // The AI never answered the user's grounded claim: the AI's miss.
      dropped: [{ nodeId: "c1", text: "User claim.", owner: "a", round: 1 }],
    };
    expect(kindsOf(ignored, [badPrior()])).toEqual(kindsOf(goodSolo("ai"), [badPrior()]));
  });
});

describe("solo AI opponent is a real rebuttal opponent", () => {
  it("unanswered AI claims fail rebuttal coverage", () => {
    const g = goodSolo("ai");
    // Remove the user's answer to o2.
    g.nodes = g.nodes.filter((n) => n.id !== "r2");
    g.dropped = [{ nodeId: "o2", text: "Opponent claim two.", owner: "ai", round: 2 }];
    expect(kindsOf(g)).not.toContain("answer-every-rebuttal");
  });

  it("answered AI claims pass rebuttal coverage", () => {
    expect(kindsOf(goodSolo("ai"))).toContain("answer-every-rebuttal");
  });
});

describe("solo and PvP opponent shapes share one semantics", () => {
  for (const opponent of ["ai", "b"] as const) {
    it(`opponent "${opponent}": answered moves pass, unanswered moves fail`, () => {
      expect(kindsOf(goodSolo(opponent))).toContain("answer-every-rebuttal");
      const g = goodSolo(opponent);
      g.nodes = g.nodes.filter((n) => n.id !== "r2");
      g.dropped = [{ nodeId: "o2", text: "Opponent claim two.", owner: opponent, round: 2 }];
      expect(kindsOf(g)).not.toContain("answer-every-rebuttal");
    });

    it(`opponent "${opponent}": grounded opponent claim grants the user nothing`, () => {
      const g: ArgGraph = {
        ...emptyGraph(),
        nodes: [
          { id: "c1", kind: "claim", owner: "a", text: "Bare user claim.", round: 1 },
          { id: "o1", kind: "claim", owner: opponent, text: "Grounded opponent claim.", round: 1 },
          { id: "oe1", kind: "evidence", owner: opponent, text: "Opponent evidence.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "Reuters", homepage: "https://www.reuters.com" }] },
          { id: "r1", kind: "rebuttal", owner: "a", text: "User answer.", round: 2, targets: ["o1"] },
        ],
        edges: [{ from: "oe1", to: "o1", relation: "supports" }],
      };
      expect(kindsOf(g)).not.toContain("ground-a-claim");
    });
  }
});

describe("side-scoping helpers", () => {
  const g = goodSolo("ai");

  it("nodesOwnedBy selects one side only", () => {
    expect(nodesOwnedBy(g, "a").every((n) => n.owner === "a")).toBe(true);
    expect(nodesOwnedBy(g, "a").length).toBeGreaterThan(0);
  });

  it("opponentClaimNodes returns non-user claims and counterclaims", () => {
    const moves = opponentClaimNodes(g, "a");
    expect(moves.length).toBe(2);
    expect(moves.every((n) => n.owner !== "a" && ["claim", "counterclaim"].includes(n.kind))).toBe(true);
  });

  it("fallaciesOwnedBy ignores opponent fallacies", () => {
    const withFallacies: ArgGraph = {
      ...g,
      fallacies: [
        { nodeId: "c1", fallacy: "strawman", note: "user" },
        { nodeId: "o1", fallacy: "ad_hominem", note: "opponent" },
      ],
    };
    expect(fallaciesOwnedBy(withFallacies, "a").map((f) => f.nodeId)).toEqual(["c1"]);
  });

  it("unsupportedOwnedBy ignores opponent unsupported ids", () => {
    const withUnsupported: ArgGraph = {
      ...g,
      evidenceStats: { ...g.evidenceStats, unsupportedClaimIds: ["c1", "o1"] },
    };
    expect(unsupportedOwnedBy(withUnsupported, "a")).toEqual(["c1"]);
  });

  it("unansweredBy returns opponent-owned drops only", () => {
    const withDrops: ArgGraph = {
      ...g,
      dropped: [
        { nodeId: "o1", text: "x", owner: "ai", round: 1 },
        { nodeId: "c1", text: "y", owner: "a", round: 1 },
      ],
    };
    expect(unansweredBy(withDrops, "a").map((d) => d.nodeId)).toEqual(["o1"]);
  });
});

describe("improvement rewards track user behaviour, not graph state", () => {
  it("fewer user fallacies than the prior mean earns the improvement reward", () => {
    // Two priors with a user fallacy each (logic 0.5), everything else
    // perfect; current is clean. Weakest = logic, and it improved.
    const priorWithFallacy = (): ArgGraph => ({
      ...goodSolo("ai"),
      fallacies: [{ nodeId: "c1", fallacy: "strawman", note: "user" }],
    });
    expect(kindsOf(goodSolo("ai"), [priorWithFallacy(), priorWithFallacy()])).toContain(
      "improve-weakest-skill",
    );
  });

  it("opponent-only differences never flip the improvement reward", () => {
    const withOpponentNoise: ArgGraph = {
      ...goodSolo("ai"),
      nodes: [
        ...goodSolo("ai").nodes,
        { id: "ox", kind: "claim", owner: "ai", text: "Extra opponent claim.", round: 4 },
        { id: "rx", kind: "rebuttal", owner: "a", text: "User answers it.", round: 4, targets: ["ox"] },
      ],
      fallacies: [{ nodeId: "ox", fallacy: "slippery_slope", note: "opponent" }],
    };
    expect(kindsOf(withOpponentNoise, [badPrior()])).toEqual(kindsOf(goodSolo("ai"), [badPrior()]));
  });

  it("a user impact move (not a graph comparison object) drives impact improvement", () => {
    // Two rich no-impact priors: grounded claims, no fallacies, answered
    // moves — every dimension perfect except impact at 0, with enough
    // cumulative opportunities (≥4) for every dimension to be eligible.
    const richNoImpact = (): ArgGraph => ({
      ...emptyGraph(),
      nodes: [
        { id: "c1", kind: "claim", owner: "a", text: "User claim one.", round: 1 },
        { id: "e1", kind: "evidence", owner: "a", text: "NREL data.", round: 1, evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }] },
        { id: "c2", kind: "claim", owner: "a", text: "User claim two.", round: 2 },
        { id: "e2", kind: "evidence", owner: "a", text: "Pew data.", round: 2, evidenceStrength: "cited", citations: [{ sourceName: "Pew", homepage: "https://www.pewresearch.org" }] },
        { id: "o1", kind: "claim", owner: "ai", text: "Opponent claim one.", round: 1 },
        { id: "o2", kind: "claim", owner: "ai", text: "Opponent claim two.", round: 2 },
        { id: "r1", kind: "rebuttal", owner: "a", text: "User rebuttal one.", round: 2, targets: ["o1"] },
        { id: "r2", kind: "rebuttal", owner: "a", text: "User rebuttal two.", round: 3, targets: ["o2"] },
      ],
      edges: [
        { from: "e1", to: "c1", relation: "supports" },
        { from: "e2", to: "c2", relation: "supports" },
      ],
    });
    // Same shape for the current debate plus the impact move, so every other
    // rate equals the priors — only the impact move can drive improvement.
    const current: ArgGraph = {
      ...richNoImpact(),
      nodes: [
        ...richNoImpact().nodes,
        { id: "i1", kind: "impact", owner: "a", text: "User impact.", round: 3 },
      ],
    };
    // weaken() keeps the comparison honest: strip impactComparison objects so
    // the graph-level flag cannot decide anything either way.
    const weaken = (graph: ArgGraph): ArgGraph => ({ ...graph, impactComparison: null });
    expect(kindsOf(weaken(current), [weaken(richNoImpact()), weaken(richNoImpact())])).toContain(
      "improve-weakest-skill",
    );

    // Remove the user's impact move too: now nothing differs, so no reward.
    const noImpact = weaken({ ...current, nodes: current.nodes.filter((n) => n.kind !== "impact") });
    expect(
      kindsOf(noImpact, [weaken(richNoImpact()), weaken(richNoImpact())]),
    ).not.toContain("improve-weakest-skill");
  });
});
