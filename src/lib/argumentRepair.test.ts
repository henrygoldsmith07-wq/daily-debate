import { describe, expect, it } from "vitest";
import { emptyGraph, type ArgGraph } from "./argGraph";
import { pickRepairTarget, scoreRepair } from "./argumentRepair";

function graph(overrides: Partial<ArgGraph>): ArgGraph {
  return {
    ...emptyGraph(),
    nodes: [
      { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
      { id: "ai1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
    ],
    ...overrides,
  };
}

describe("argument repair targets", () => {
  it("prioritises an unsupported claim and scores a named source", () => {
    const target = pickRepairTarget(graph({ evidenceStats: { ...emptyGraph().evidenceStats, unsupportedClaimIds: ["a1"] } }));
    expect(target?.kind).toBe("evidence");
    expect(target?.sourceNodeId).toBe("a1");
    const result = scoreRepair(target!, "According to Pew Research Center data, the policy improves access because the gap narrows for low-income students.");
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.signals).toContain("names evidence or a source");
  });

  it("finds a user's fallacy before offering a generic rewrite", () => {
    const target = pickRepairTarget(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "Everyone knows this policy works, so it must be adopted.", round: 1 },
        { id: "ai1", kind: "counterclaim", owner: "ai", text: "There are implementation costs.", round: 1 },
      ],
      fallacies: [{ nodeId: "a1", fallacy: "appeal_to_authority", note: "shortcut" }],
    }));
    expect(target?.kind).toBe("logic");
    expect(target?.label).toContain("appeal to authority");
  });

  it("selects an unanswered opposing move when the user's graph is otherwise clean", () => {
    const target = pickRepairTarget(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
        { id: "ai1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
      ],
    }));
    expect(target?.kind).toBe("rebuttal");
    expect(target?.sourceNodeId).toBe("ai1");
  });

  it("gives actionable signals when a repair is missing its key move", () => {
    const target = { kind: "impact" as const, label: "Impact", title: "Name what changes", prompt: "", sourceText: "The policy changes access." };
    const result = scoreRepair(target, "The policy changes access.");
    expect(result.score).toBeLessThan(60);
    expect(result.signals.some((signal) => signal.includes("compare which impact"))).toBe(true);
  });
});
