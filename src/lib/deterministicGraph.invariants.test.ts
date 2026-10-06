// Invariant tests for buildDeterministicArgumentGraph() against the CANONICAL
// opportunity/rebuttal semantics.
//
// The deterministic graph is a judge-avoidance candidate, so if it disagreed
// with the canonical rules the structural route would be scoring a different
// debate than the ensemble. Every assertion below reuses the shared canonical
// helpers (opportunity.ts) rather than restating the rules, so there is exactly
// one definition of rebuttal/opportunity/support in the app.

import { describe, it, expect } from "vitest";

import { buildDeterministicArgumentGraph } from "./argumentEvaluation";
import {
  OPPORTUNITY_KINDS,
  RESPONSE_KINDS,
  isValidRebuttalResponse,
  isValidRebuttalTarget,
} from "./opportunity";
import type { ArgumentRole, ClassifiedArgument } from "./argumentTaxonomy";

function arg(
  id: string,
  owner: "a" | "b" | "ai",
  round: number,
  labels: ArgumentRole[],
  text = "Some substantive argumentative text about the motion.",
): ClassifiedArgument {
  return {
    id,
    text,
    owner,
    round,
    classification: {
      index: 0,
      text,
      labels,
      scores: {},
      primaryRole: labels[0] ?? "other",
      confidence: 0.95,
      status: "high_confidence",
      source: "classifier.dev",
    },
  };
}

const graphOf = (args: ClassifiedArgument[]) => buildDeterministicArgumentGraph(args);

describe("owner assignment", () => {
  it("every node keeps the owner of the argument that produced it", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim", "reasoning"], "I argue this because of the impact on cities."),
      arg("b1", "b", 2, ["rebuttal"], "That is wrong because the opposite holds."),
    ]);
    for (const node of graph.nodes) {
      const source = node.id.startsWith("a1") ? "a" : "b";
      expect(node.owner).toBe(source);
    }
  });
});

describe("rebuttal targeting obeys the canonical rule", () => {
  it("a round-2 rebuttal targets the opponent's round-1 claim, never its own side", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("b1", "b", 2, ["rebuttal"]),
    ]);
    const rebuttal = graph.nodes.find((n) => n.kind === "rebuttal")!;
    expect((rebuttal.targets ?? []).length).toBe(1);
    const target = graph.nodes.find((n) => n.id === (rebuttal.targets ?? [])[0])!;
    expect(target.owner).toBe("a");
    // The canonical rule, reused rather than restated.
    expect(isValidRebuttalTarget(graph, target.id, "b", 2)).toBe(true);
  });

  it("a first-round rebuttal has no prior target and creates no rebuts edge", () => {
    const graph = graphOf([arg("a1", "a", 1, ["rebuttal"])]);
    expect(graph.nodes.find((n) => n.kind === "rebuttal")!.targets).toEqual([]);
    expect(graph.edges.filter((e) => e.relation === "rebuts")).toHaveLength(0);
  });

  it("never targets a same-round or future argument", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("b1", "b", 1, ["rebuttal"]),
    ]);
    const rebuttal = graph.nodes.find((n) => n.kind === "rebuttal")!;
    for (const targetId of rebuttal.targets ?? []) {
      const target = graph.nodes.find((n) => n.id === targetId)!;
      expect(target.round).toBeLessThan(rebuttal.round);
      expect(isValidRebuttalTarget(graph, targetId, "b", rebuttal.round)).toBe(true);
    }
  });

  it("every rebuts edge satisfies the canonical response rule end-to-end", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("b1", "b", 2, ["rebuttal", "evidence"], "Counter-evidence: see https://example.org/study"),
      arg("a2", "a", 3, ["rebuttal"]),
      arg("b2", "b", 4, ["counterexample", "reasoning"], "But consider the impact on rural areas."),
    ]);
    for (const edge of graph.edges.filter((e) => e.relation === "rebuts")) {
      const from = graph.nodes.find((n) => n.id === edge.from)!;
      expect(RESPONSE_KINDS.has(from.kind)).toBe(true);
      expect(isValidRebuttalResponse(graph, edge.from, edge.to, edge.relation, from.owner)).toBe(true);
    }
  });

  it("rebuttal targets are always canonical opportunity kinds", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("a2", "a", 1, ["evidence"], "Cited: https://example.org/a"),
      arg("b1", "b", 2, ["rebuttal"]),
    ]);
    for (const node of graph.nodes.filter((n) => n.kind === "rebuttal")) {
      for (const targetId of node.targets ?? []) {
        const target = graph.nodes.find((n) => n.id === targetId)!;
        expect(OPPORTUNITY_KINDS.has(target.kind)).toBe(true);
      }
    }
  });
});

describe("evidence support edges", () => {
  it("evidence supports the claim in the same argument when one exists", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim", "evidence"], "Cited: https://example.org/a"),
    ]);
    const evidence = graph.nodes.find((n) => n.kind === "evidence")!;
    const support = graph.edges.filter((e) => e.from === evidence.id && e.relation === "supports");
    expect(support).toHaveLength(1);
    const target = graph.nodes.find((n) => n.id === support[0].to)!;
    expect(target.kind).toBe("claim");
    expect(target.owner).toBe("a");
  });

  it("evidence with no local claim attaches to that side's own earlier claim", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("a2", "a", 2, ["evidence"], "Cited: https://example.org/b"),
    ]);
    const evidence = graph.nodes.find((n) => n.id.startsWith("a2") && n.kind === "evidence")!;
    const support = graph.edges.find((e) => e.from === evidence.id && e.relation === "supports")!;
    const target = graph.nodes.find((n) => n.id === support.to)!;
    expect(target.owner).toBe("a");
    expect(target.round).toBeLessThan(evidence.round);
  });

  it("evidence never supports the opponent's claim", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("b1", "b", 2, ["evidence"], "Cited: https://example.org/c"),
    ]);
    for (const edge of graph.edges.filter((e) => e.relation === "supports")) {
      const from = graph.nodes.find((n) => n.id === edge.from)!;
      const to = graph.nodes.find((n) => n.id === edge.to)!;
      expect(from.owner).toBe(to.owner);
    }
  });

  it("drops an evidence source that fails validation instead of citing it", () => {
    const graph = graphOf([arg("a1", "a", 1, ["claim", "evidence"], "Cited: javascript:alert(1)")]);
    const evidence = graph.nodes.find((n) => n.kind === "evidence")!;
    expect(evidence.citations ?? []).toHaveLength(0);
  });
});

describe("counterexamples, concessions and impacts", () => {
  it("a counterexample becomes a counterclaim kind", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("b1", "b", 2, ["counterexample"]),
    ]);
    expect(graph.nodes.some((n) => n.kind === "counterclaim" && n.owner === "b")).toBe(true);
  });

  it("a concession is recorded against the target, by the conceding side", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("b1", "b", 2, ["concession", "rebuttal"]),
    ]);
    expect(graph.concessions.length).toBeGreaterThan(0);
    for (const c of graph.concessions) {
      expect(c.by).toBe("b");
      const target = graph.nodes.find((n) => n.id === c.nodeId)!;
      expect(target.owner).toBe("a");
    }
  });

  it("an impact node is attached to its own claim, never the opponent's", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim", "reasoning"], "This matters because of the long-term impact on growth."),
      arg("b1", "b", 2, ["claim"]),
    ]);
    const impact = graph.nodes.find((n) => n.kind === "impact")!;
    const edge = graph.edges.find((e) => e.to === impact.id && e.relation === "impacts")!;
    const source = graph.nodes.find((n) => n.id === edge.from)!;
    expect(source.owner).toBe(impact.owner);
    expect(source.kind).toBe("claim");
  });
});

describe("dropped and repeated arguments", () => {
  it("a non-substantive argument produces no claim node and is dropped", () => {
    const graph = graphOf([arg("a1", "a", 1, ["other"], "hmm")]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("repeated identical claims stay separate nodes (no silent merging)", () => {
    const text = "Cities should eliminate minimum parking requirements.";
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"], text),
      arg("a2", "a", 2, ["claim"], text),
    ]);
    expect(graph.nodes.filter((n) => n.kind === "claim")).toHaveLength(2);
  });

  it("a mixed-role argument yields one node per labelled role, without duplicating the claim", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("b1", "b", 2, ["rebuttal", "evidence", "concession"], "Cited: https://example.org/d"),
    ]);
    // The responder's own position appears exactly once, however many roles
    // the classifier stacked onto the same argument.
    expect(graph.nodes.filter((n) => n.id.startsWith("b1") && n.kind === "claim")).toHaveLength(1);
    expect(graph.nodes.filter((n) => n.id.startsWith("b1") && n.kind === "rebuttal")).toHaveLength(1);
    expect(graph.nodes.filter((n) => n.id.startsWith("b1") && n.kind === "evidence")).toHaveLength(1);
    // Node ids stay unique: a stacked role never collides with another.
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cross-round references", () => {
  it("round ordering is preserved on every node", () => {
    const submitted = [
      arg("a1", "a", 1, ["claim"]),
      arg("b1", "b", 2, ["rebuttal"]),
      arg("a2", "a", 3, ["rebuttal"]),
    ];
    const graph = graphOf(submitted);
    const roundById = new Map(submitted.map((s) => [s.id, s.round]));
    expect(graph.nodes.length).toBeGreaterThan(0);
    for (const node of graph.nodes) {
      // Node ids are `<argumentId>-<role>`; every node inherits its
      // argument's round, so cross-round references can never be faked.
      const source = submitted.find((s) => node.id.startsWith(`${s.id}-`))!;
      expect(source).toBeDefined();
      expect(node.round).toBe(roundById.get(source.id));
    }
  });

  it("a later rebuttal targets the most recent canonical opportunity, not an arbitrary node", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("b1", "b", 2, ["rebuttal"]),
    ]);
    const rebuttal = graph.nodes.find((n) => n.kind === "rebuttal")!;
    const target = graph.nodes.find((n) => n.id === (rebuttal.targets ?? [])[0])!;
    expect(target.round).toBeLessThan(rebuttal.round);
    expect(target.owner).not.toBe(rebuttal.owner);
  });
});

describe("graph well-formedness", () => {
  it("no edge references a node id that does not exist", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim", "reasoning", "evidence"], "Cited: https://example.org/e and the impact is large."),
      arg("b1", "b", 2, ["rebuttal", "concession"]),
      arg("a2", "a", 3, ["counterexample"]),
    ]);
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
    for (const c of graph.concessions) expect(ids.has(c.nodeId)).toBe(true);
  });

  it("produces no rebuttal that self-targets its own side", () => {
    const graph = graphOf([
      arg("a1", "a", 1, ["claim"]),
      arg("a2", "a", 2, ["rebuttal"]),
      arg("a3", "a", 3, ["rebuttal"]),
    ]);
    for (const node of graph.nodes.filter((n) => n.kind === "rebuttal")) {
      for (const targetId of node.targets ?? []) {
        const target = graph.nodes.find((n) => n.id === targetId)!;
        expect(target.owner).not.toBe(node.owner);
      }
    }
  });
});
