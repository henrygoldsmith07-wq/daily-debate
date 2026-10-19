import { describe, expect, it } from "vitest";
import type { ArgGraph, ArgNode } from "./argGraph";
import { detectRepetition, fallacyHints, rebuttalCoverage } from "./argHeuristics";

const node = (id: string, over: Partial<ArgNode> = {}): ArgNode =>
  ({ id, kind: "claim", owner: "a", text: "x", round: 1, ...over }) as ArgNode;
const graph = (nodes: ArgNode[]) => ({ nodes, edges: [] }) as unknown as ArgGraph;

describe("detectRepetition", () => {
  it("flags near-identical claims by the same owner only", () => {
    const nodes = [
      node("a", { text: "Cities should ban cars downtown to cut pollution" }),
      node("b", { text: "Cities should ban cars downtown to cut pollution!" }),
      node("c", { owner: "b", text: "Cities should ban cars downtown to cut pollution" }),
    ];
    const out = detectRepetition(nodes);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ a: "a", b: "b", score: 1 });
  });

  it("ignores different claims and non claim/evidence nodes", () => {
    expect(detectRepetition([node("a", { text: "alpha beta" }), node("b", { text: "gamma delta" })])).toEqual([]);
    expect(detectRepetition([node("a", { kind: "rebuttal" }), node("b", { kind: "rebuttal" })])).toEqual([]);
  });
});

describe("rebuttalCoverage", () => {
  it("is 1 when there are no rebuttals", () => {
    expect(rebuttalCoverage(graph([node("a")]))).toBe(1);
  });

  it("is 1 when every rebuttal targets an existing node", () => {
    expect(rebuttalCoverage(graph([node("a"), node("r1", { kind: "rebuttal", targets: ["a"] })]))).toBe(1);
  });

  it("counts a rebuttal with no targets as uncovered", () => {
    expect(rebuttalCoverage(graph([node("r", { kind: "rebuttal" })]))).toBe(0);
  });
});

describe("fallacyHints", () => {
  it("returns auditable matches", () => {
    expect(fallacyHints("Either we ban it or we lose everything")).toEqual([
      { fallacy: "false_dilemma", match: "Either" },
    ]);
    expect(fallacyHints("People like you are the problem").map((h) => h.fallacy)).toContain("ad_hominem");
  });

  it("returns nothing for neutral text", () => {
    expect(fallacyHints("The study found costs fell by 12 percent.")).toEqual([]);
  });
});
