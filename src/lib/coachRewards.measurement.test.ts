import { describe, expect, it } from "vitest";
import {
  compareWeakestDimension,
  computeCoachRewards,
  measureDimension,
  IMPROVEMENT_MIN_DELTA,
  type RewardContext,
} from "./coachRewards";
import { eligibleOpponentMoves, userAnsweredIds } from "./opportunity";
import { assessArgumentGraph } from "./observableAssessment";
import type { ArgGraph } from "./argGraph";
import { emptyGraph } from "./argGraph";

/**
 * ADVERSARIAL MEASUREMENT TESTS for "Improved your weakest skill".
 *
 * The reward must track ability (opportunity-normalised rates), never debate
 * length, opponent behaviour, or query artefacts. Every scenario below varies
 * exactly one factor while holding ability fixed.
 */

interface DebateSpec {
  claims?: number;
  supported?: number[]; // 1-based indices of supported claims
  opponentMoves?: number;
  opponentRound?: number;
  answered?: number[]; // 1-based indices of answered opponent moves
  userMaxRound?: number;
  fallacies?: number; // fallacy tags on the first N own claims
  impacts?: number;
}

function debateGraph(spec: DebateSpec = {}): ArgGraph {
  const {
    claims = 2,
    supported = [1, 2],
    opponentMoves = 1,
    opponentRound = 1,
    answered = [1],
    userMaxRound = 3,
    fallacies = 0,
    impacts = 1,
  } = spec;
  const g: ArgGraph = { ...emptyGraph(), nodes: [], edges: [] };
  for (let i = 1; i <= claims; i++) {
    g.nodes.push({ id: `c${i}`, kind: "claim", owner: "a", text: `User claim ${i}.`, round: 1 });
    if (supported.includes(i)) {
      g.nodes.push({
        id: `e${i}`, kind: "evidence", owner: "a", text: `Evidence ${i}.`, round: 1,
        evidenceStrength: "cited", citations: [{ sourceName: "NREL", homepage: "https://www.nrel.gov" }],
      });
      g.edges.push({ from: `e${i}`, to: `c${i}`, relation: "supports" });
    }
  }
  // Mirror what graph enrichment produces in production: unsupported ids are
  // exactly the user's claims without a support edge.
  g.evidenceStats.unsupportedClaimIds = Array.from(
    { length: claims },
    (_, k) => `c${k + 1}`,
  ).filter((_, k) => !supported.includes(k + 1));
  for (let i = 1; i <= opponentMoves; i++) {
    g.nodes.push({ id: `o${i}`, kind: "claim", owner: "ai", text: `Opponent claim ${i}.`, round: opponentRound });
  }
  answered.forEach((idx, k) => {
    g.nodes.push({
      id: `r${k + 1}`, kind: "rebuttal", owner: "a",
      text: `User rebuttal ${k + 1}.`, round: Math.min(userMaxRound, opponentRound + 1),
      targets: [`o${idx}`],
    });
  });
  for (let i = 1; i <= impacts; i++) {
    g.nodes.push({ id: `i${i}`, kind: "impact", owner: "a", text: `User impact ${i}.`, round: userMaxRound });
  }
  // Deterministic own-fallacy tags on the first N own claims.
  for (let i = 1; i <= Math.min(fallacies, claims); i++) {
    g.fallacies.push({ nodeId: `c${i}`, fallacy: "strawman", note: "x" });
  }
  return g;
}

/** Perfect-on-everything debate except evidence at the given unsupported rate. */
function evidenceAt(rate: number, claims = 4): ArgGraph {
  const unsupported = Math.round(rate * claims);
  const supported = Array.from({ length: claims - unsupported }, (_, i) => i + 1);
  return debateGraph({ claims, supported, opponentMoves: 1, answered: [1], fallacies: 0, impacts: 1 });
}

function ctx(current: ArgGraph, priors: ArgGraph[] = []): RewardContext {
  const assess = (graph: ArgGraph) =>
    assessArgumentGraph(graph, { sideA: "a", sideB: "ai", extractionSource: "deterministic" });
  return {
    assessment: assess(current),
    priorAssessments: priors.map(assess),
    previouslyDebatedCategories: ["Policy"],
    currentCategory: "Policy",
  };
}

describe("measureDimension readings", () => {
  it("evidence: unsupported rate over eligible own claims", () => {
    expect(measureDimension(debateGraph({ claims: 4, supported: [1, 2] }), "evidence")).toEqual({
      value: 0.5,
      opportunities: 4,
    });
  });

  it("evidence: zero claims is unmeasurable, not perfect", () => {
    expect(measureDimension(debateGraph({ claims: 0, opponentMoves: 0 }), "evidence")).toEqual({
      value: null,
      opportunities: 0,
    });
  });

  it("rebuttal: miss rate over eligible opponent moves only", () => {
    // o1 (round 1) is eligible; o2 (round 3, no later user turn) is not.
    const g = debateGraph({ opponentMoves: 0 });
    g.nodes.push(
      { id: "o1", kind: "claim", owner: "ai", text: "Early.", round: 1 },
      { id: "o2", kind: "claim", owner: "ai", text: "Late.", round: 3 },
      { id: "r1", kind: "rebuttal", owner: "a", text: "Answer.", round: 2, targets: ["o1"] },
    );
    expect(eligibleOpponentMoves(g, "a").map((n) => n.id)).toEqual(["o1"]);
    expect(measureDimension(g, "rebuttal")).toEqual({ value: 1, opportunities: 1 });
  });

  it("rebuttal: no eligible moves is unmeasurable, not perfect", () => {
    expect(measureDimension(debateGraph({ opponentMoves: 0 }), "rebuttal")).toEqual({
      value: null,
      opportunities: 0,
    });
  });

  it("logic: fallacy rate over ALL own nodes (the detector's exact scope)", () => {
    // 1 fallacy across 2 claims + 2 evidence + 1 rebuttal + 1 impact = 1/6.
    // Every node type the detector can tag counts as an opportunity, so a
    // counted fallacy always has its move in the denominator.
    expect(measureDimension(debateGraph({ claims: 2, fallacies: 1, impacts: 1 }), "logic")).toEqual({
      value: 1 - 1 / 6,
      opportunities: 6,
    });
  });

  it("logic: empty user side is unmeasurable, not perfect", () => {
    const g = debateGraph({ claims: 0, opponentMoves: 1, answered: [], impacts: 0 });
    g.nodes = g.nodes.filter((n) => n.owner !== "a");
    expect(measureDimension(g, "logic")).toEqual({ value: null, opportunities: 0 });
  });

  it("impact: presence gated on having claims to weigh", () => {
    expect(measureDimension(debateGraph({ impacts: 1 }), "impact")).toEqual({ value: 1, opportunities: 2 });
    expect(measureDimension(debateGraph({ impacts: 0 }), "impact")).toEqual({ value: 0, opportunities: 2 });
    expect(measureDimension(debateGraph({ claims: 0, impacts: 0, opponentMoves: 0 }), "impact")).toEqual({
      value: null,
      opportunities: 0,
    });
  });

  it("userAnsweredIds recognises rebuttal targets and rebuts/counters edges", () => {
    const g = debateGraph({ opponentMoves: 2, answered: [1] });
    g.edges.push({ from: "r1", to: "o1", relation: "rebuts" });
    expect(userAnsweredIds(g, "a").has("o1")).toBe(true);
    expect(userAnsweredIds(g, "a").has("o2")).toBe(false);
  });
});

describe("compareWeakestDimension selection", () => {
  it("picks the lowest prior mean among eligible dimensions", () => {
    // Priors: evidence 0.5, everything else perfect.
    const priors = [evidenceAt(0.5), evidenceAt(0.5)];
    const current = evidenceAt(0.2, 5);
    const comparison = compareWeakestDimension(current, priors)!;
    expect(comparison.dimension).toBe("evidence");
    expect(comparison.priorMean).toBeCloseTo(0.5);
    expect(comparison.priorDebates).toBe(2);
    expect(comparison.current).toBeCloseTo(0.8);
    expect(comparison.improved).toBe(true);
  });

  it("requires at least two measured priors (sparse history awards nothing)", () => {
    expect(compareWeakestDimension(evidenceAt(0), [evidenceAt(0.5)])).toBeNull();
    expect(compareWeakestDimension(evidenceAt(0), [])).toBeNull();
  });

  it("requires a meaningful margin, not any epsilon", () => {
    const priors = [evidenceAt(0.5), evidenceAt(0.5)];
    // Delta 0.02: below the meaningful threshold.
    const current = evidenceAt(0.48);
    const comparison = compareWeakestDimension(current, priors)!;
    expect(comparison.improved).toBe(false);
    expect(comparison.delta).toBeLessThan(IMPROVEMENT_MIN_DELTA);
  });

  it("withholds the claim when the current debate is unmeasurable on the weakest dimension", () => {
    const priors = [evidenceAt(0.5), evidenceAt(0.5)];
    // No claims at all: evidence unmeasurable; everything else perfect at 1.0.
    const current = debateGraph({ claims: 0, opponentMoves: 0, impacts: 0 });
    const comparison = compareWeakestDimension(current, priors);
    // Rebuttal/logic/impact are eligible with prior mean 1.0 and current 1.0
    // at best — never an improvement over the 0.5 evidence mean, which is
    // correctly skipped as unmeasurable.
    expect(comparison === null || comparison.improved === false).toBe(true);
  });

  it("breaks ties deterministically by fixed dimension order", () => {
    // Evidence and rebuttal both at prior mean 0.5; logic/impact perfect.
    const tiedPrior = (): ArgGraph =>
      debateGraph({ claims: 4, supported: [1, 2], opponentMoves: 2, answered: [1], fallacies: 0, impacts: 1 });
    const priors = [tiedPrior(), tiedPrior()];
    const first = compareWeakestDimension(evidenceAt(0.2), priors)!;
    const second = compareWeakestDimension(evidenceAt(0.2), priors)!;
    expect(first.dimension).toBe(second.dimension);
    expect(first.dimension).toBe("evidence"); // first in IMPROVEMENT_DIMENSIONS
  });

  it("is deterministic across repeated calls", () => {
    const priors = [evidenceAt(0.6), evidenceAt(0.4), evidenceAt(0.5)];
    const current = evidenceAt(0.1);
    expect(compareWeakestDimension(current, priors)).toEqual(compareWeakestDimension(current, priors));
  });
});

describe("length invariance (same ability, different lengths)", () => {
  const priors = [evidenceAt(0.6, 5), evidenceAt(0.6, 5)];

  it("short and long debates with equal rates reach the same verdict", () => {
    const short = evidenceAt(0.4, 2); // 2 claims, ~1 unsupported
    const long = evidenceAt(0.4, 10); // 10 claims, ~4 unsupported
    const shortResult = compareWeakestDimension(short, priors)!;
    const longResult = compareWeakestDimension(long, priors)!;
    expect(shortResult.dimension).toBe(longResult.dimension);
    expect(shortResult.improved).toBe(longResult.improved);
    expect(shortResult.improved).toBe(true);
  });

  it("fewer opportunities but a worse prior rate still earns the reward", () => {
    // Long, weak priors (rate 0.2) vs a short current at 0.5.
    const weakPriors = [evidenceAt(0.8, 10), evidenceAt(0.8, 10)];
    const short = evidenceAt(0.5, 2);
    expect(compareWeakestDimension(short, weakPriors)!.improved).toBe(true);
  });

  it("more opportunities with a better rate earns the reward", () => {
    const weakPriors = [evidenceAt(0.8, 4), evidenceAt(0.8, 4)];
    const long = evidenceAt(0.5, 12);
    expect(compareWeakestDimension(long, weakPriors)!.improved).toBe(true);
  });
});

describe("sprint vs full debates", () => {
  it("a 3-round sprint and a 12-round full debate with equal rates behave identically", () => {
    const priors = [evidenceAt(0.6, 5), evidenceAt(0.6, 5)];
    const sprint = debateGraph({ claims: 2, supported: [1], opponentMoves: 1, answered: [1], userMaxRound: 3, fallacies: 0, impacts: 1 });
    const full = debateGraph({ claims: 8, supported: [1, 2, 3, 4], opponentMoves: 4, answered: [1, 2, 3, 4], userMaxRound: 12, fallacies: 0, impacts: 1 });
    const sprintResult = compareWeakestDimension(sprint, priors)!;
    const fullResult = compareWeakestDimension(full, priors)!;
    expect(sprintResult.dimension).toBe(fullResult.dimension);
    expect(sprintResult.improved).toBe(fullResult.improved);
    expect(sprintResult.improved).toBe(true);
  });
});

describe("computeCoachRewards integration", () => {
  it("exposes dimension and detail metadata on improve-weakest-skill", () => {
    const events = computeCoachRewards(ctx(evidenceAt(0.2), [evidenceAt(0.6), evidenceAt(0.6)]));
    const improvement = events.find((e) => e.kind === "improve-weakest-skill");
    expect(improvement).toBeDefined();
    expect(improvement!.dimension).toBe("evidence");
    expect(improvement!.detail).toMatch(/Evidence/);
    expect(improvement!.detail).toMatch(/→/);
    expect(improvement!.xp).toBeGreaterThan(0);
  });

  it("withholds the reward on sparse history", () => {
    const events = computeCoachRewards(ctx(evidenceAt(0), [evidenceAt(0.6)]));
    expect(events.some((e) => e.kind === "improve-weakest-skill")).toBe(false);
  });

  it("opponent-only mutations leave the reward set identical", () => {
    const clean = goodSoloForRewards("ai");
    const noisy: ArgGraph = {
      ...clean,
      nodes: [
        ...clean.nodes,
        { id: "of1", kind: "claim", owner: "ai", text: "Opponent fallacy claim.", round: 3 },
        { id: "oe1", kind: "evidence", owner: "ai", text: "Opponent evidence.", round: 3, evidenceStrength: "cited", citations: [{ sourceName: "Reuters", homepage: "https://www.reuters.com" }] },
        { id: "or1", kind: "rebuttal", owner: "a", text: "User answers it.", round: 4, targets: ["of1"] },
      ],
      edges: [...clean.edges, { from: "oe1", to: "of1", relation: "supports" }],
      fallacies: [{ nodeId: "of1", fallacy: "ad_hominem", note: "opponent" }],
      dropped: [{ nodeId: "c1", text: "User claim.", owner: "a", round: 1 }],
    };
    const base = computeCoachRewards(ctx(clean, [badPriorForRewards()])).map((e) => e.kind).sort();
    const mutated = computeCoachRewards(ctx(noisy, [badPriorForRewards()])).map((e) => e.kind).sort();
    expect(mutated).toEqual(base);
  });
});

/** Shared clean solo debate for the integration tests. */
function goodSoloForRewards(opponent: "ai" | "b"): ArgGraph {
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

function badPriorForRewards(): ArgGraph {
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
