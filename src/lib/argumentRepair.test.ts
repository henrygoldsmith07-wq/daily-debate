import { describe, expect, it } from "vitest";
import { emptyGraph, type ArgGraph } from "./argGraph";
import { pickRepairTarget, repairForArgumentRole, repairPathForRole, scoreRepair } from "./argumentRepair";

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
  it("maps classifier roles to specialised repair paths", () => {
    expect(repairPathForRole("evidence")).toBe("evidence-verification");
    expect(repairPathForRole("rebuttal")).toBe("rebuttal-compare");
    expect(repairPathForRole("question")).toBe("question-clarification");
    expect(repairPathForRole("off-topic")).toBe("off-topic-lightweight");
  });

  it("uses earlier-opportunity facts when routing a rebuttal repair", () => {
    const target = repairForArgumentRole(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
        { id: "b1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
        { id: "a2", kind: "claim", owner: "a", text: "The policy also reduces cost.", round: 2 },
      ],
    }), "rebuttal");
    expect(target?.kind).toBe("rebuttal");
    expect(target?.sourceNodeId).toBe("b1");
  });

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

  it("selects an unanswered eligible opposing move when the user's graph is otherwise clean", () => {
    // ai1 (round 1) is an ELIGIBLE opportunity: the user has a later node
    // (a2, round 2) and never validly answered it.
    const target = pickRepairTarget(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
        { id: "ai1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
        { id: "a2", kind: "claim", owner: "a", text: "The policy also reduces cost.", round: 2 },
      ],
    }));
    expect(target?.kind).toBe("rebuttal");
    expect(target?.sourceNodeId).toBe("ai1");
  });

  it("does not offer a rebuttal repair when the opposing move was never answerable", () => {
    // No later user node exists after ai1, so there is no rebuttal
    // opportunity at all: the repair falls through to other kinds instead
    // of blaming the user for something they had no turn to answer.
    const target = pickRepairTarget(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
        { id: "ai1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
      ],
    }));
    expect(target?.kind).not.toBe("rebuttal");
  });

  it("an invalid answer (self-target) does not hide the unanswered opposing move", () => {
    // The user's rebuttal targets their own claim: the canonical rule
    // ignores it, so ai1 stays an unanswered eligible opportunity.
    const target = pickRepairTarget(graph({
      nodes: [
        { id: "a1", kind: "claim", owner: "a", text: "The policy improves access.", round: 1 },
        { id: "ai1", kind: "counterclaim", owner: "ai", text: "The policy creates a costly trade-off.", round: 1 },
        { id: "r1", kind: "rebuttal", owner: "a", text: "Bad self-targeting answer.", round: 2, targets: ["a1"] },
      ],
    }));
    expect(target?.kind).toBe("rebuttal");
    expect(target?.sourceNodeId).toBe("ai1");
  });

  it.each([
    "The policy helps because access improves. Therefore it deserves consideration for the families currently excluded from services.",
    "  THE POLICY HELPS BECAUSE ACCESS IMPROVES! Therefore it deserves consideration for the families currently excluded from services?  ",
  ])("does not credit copying the original move: %s", (rewrite) => {
    const target = {
      kind: "logic" as const, label: "Logic", title: "Repair", prompt: "",
      sourceText: "The policy helps because access improves. Therefore it deserves consideration for the families currently excluded from services.",
    };
    expect(scoreRepair(target, rewrite).score).toBe(0);
    expect(scoreRepair(target, rewrite).signals.join(" ")).toMatch(/change|revise/i);
  });

  it("gives actionable signals when a repair is missing its key move", () => {
    const target = { kind: "impact" as const, label: "Impact", title: "Name what changes", prompt: "", sourceText: "The policy changes access." };
    const result = scoreRepair(target, "The policy changes access.");
    expect(result.score).toBeLessThan(60);
    expect(result.signals.some((signal) => signal.includes("compare which impact"))).toBe(true);
  });
});
