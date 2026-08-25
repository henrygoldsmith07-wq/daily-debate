import { describe, it, expect } from "vitest";
import { computeCoachRewards, totalBonusXP, REWARD_XP } from "./coachRewards";
import type { RewardContext } from "./coachRewards";
import { assessArgumentGraph } from "./observableAssessment";
import type { ArgGraph } from "./argGraph";
import { emptyGraph } from "./argGraph";

function makeGraph(opts: {
  grounded?: boolean;
  rebuttalsCovered?: boolean;
} = {}): ArgGraph {
  const nodes: ArgGraph["nodes"] = [
    { id: "c1", kind: "claim", owner: "a", text: "Main claim.", round: 1 },
    { id: "o1", kind: "counterclaim", owner: "b", text: "Opposing claim.", round: 1 },
    { id: "o2", kind: "impact", owner: "b", text: "Opposing impact.", round: 1 },
  ];
  const edges: ArgGraph["edges"] = [];
  if (opts.grounded) {
    nodes.push({ id: "e1", kind: "evidence", owner: "a", text: "Lazard data.", round: 2, evidenceStrength: "cited", citations: [{ sourceName: "Lazard", homepage: "https://www.lazard.com" }] });
    edges.push({ from: "e1", to: "c1", relation: "supports" });
  }
  if (opts.rebuttalsCovered) {
    nodes.push({ id: "r1", kind: "rebuttal", owner: "a", text: "Rebuttal to claim.", round: 2, targets: ["o1"] });
    edges.push({ from: "r1", to: "o1", relation: "rebuts" });
    nodes.push({ id: "r2", kind: "rebuttal", owner: "a", text: "Rebuttal to impact.", round: 2, targets: ["o2"] });
    edges.push({ from: "r2", to: "o2", relation: "rebuts" });
  }
  return { ...emptyGraph(), nodes, edges };
}

function makeContext(graph: ArgGraph, priorGraphs: ArgGraph[] = [], categories: string[] = [], currentCategory = "Policy"): RewardContext {
  return {
    assessment: assessArgumentGraph(graph, { sideA: "a", sideB: "ai", extractionSource: "deterministic" }),
    priorAssessments: priorGraphs.map((g) => assessArgumentGraph(g, { sideA: "a", sideB: "b", extractionSource: "deterministic" })),
    previouslyDebatedCategories: categories,
    currentCategory,
  };
}

describe("computeCoachRewards", () => {
  it("always awards completion bonus", () => {
    const events = computeCoachRewards(makeContext(makeGraph({})));
    expect(events.some((e) => e.kind === "complete-debate")).toBe(true);
    expect(totalBonusXP(events)).toBeGreaterThanOrEqual(REWARD_XP["complete-debate"]);
  });

  it("awards ground-a-claim when claim has real citation + support edge", () => {
    const ctx = makeContext(makeGraph({ grounded: true }));
    const events = computeCoachRewards(ctx);
    expect(events.some((e) => e.kind === "ground-a-claim")).toBe(true);
  });

  it("does not award ground-a-claim without citation", () => {
    const ctx = makeContext(makeGraph({}));
    const events = computeCoachRewards(ctx);
    expect(events.some((e) => e.kind === "ground-a-claim")).toBe(false);
  });

  it("awards answer-every-rebuttal when coverage is full", () => {
    const ctx = makeContext(makeGraph({ rebuttalsCovered: true }));
    const events = computeCoachRewards(ctx);
    expect(events.some((e) => e.kind === "answer-every-rebuttal")).toBe(true);
  });

  it("awards unfamiliar-topic bonus for new category", () => {
    const ctx = makeContext(makeGraph({}), [], ["Technology"]);
    const events = computeCoachRewards({ ...ctx, currentCategory: "Medicine" });
    expect(events.some((e) => e.kind === "unfamiliar-topic")).toBe(true);
  });

  it("does not award unfamiliar-topic for repeated category", () => {
    const ctx = makeContext(makeGraph({}), [], ["Policy"]);
    const events = computeCoachRewards(ctx);
    expect(events.some((e) => e.kind === "unfamiliar-topic")).toBe(false);
  });
});

describe("totalBonusXP", () => {
  it("sums all event XP values", () => {
    const fakeEvents = [
      { kind: "complete-debate" as const, xp: 50, label: "test" },
      { kind: "ground-a-claim" as const, xp: 15, label: "test" },
    ];
    expect(totalBonusXP(fakeEvents)).toBe(65);
  });

  it("returns zero on empty list", () => {
    expect(totalBonusXP([])).toBe(0);
  });
});
